// Walk the configured roots, chunk, embed, store. Hash-based incremental.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  DOC_TEXT,
  EMBED_BACKEND,
  EMBED_MODEL,
  EXCLUDE_DIRS,
  INCLUDE_SUFFIXES,
  INDEX_ROOTS,
  QUERY_TEXT,
  REPO_ROOT,
  looksLikeProject,
} from './config.js';
import { chunkFile, langOf } from './chunker.js';
import { embedTexts } from './embedder.js';
import * as store from './store.js';

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
    } else if (entry.isFile() && INCLUDE_SUFFIXES.has(path.extname(entry.name))) {
      yield path.join(dir, entry.name);
    }
  }
}

const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');

export async function build({ full = false, batch = 16, onProgress = () => {} } = {}) {
  const db = store.open();

  // Vectors are only comparable inside the space that produced them, so if the
  // configured model (or backend — different runtimes/quantizations shift the
  // vectors) differs from what built this index, every stored vector is stale
  // and file hashes are meaningless. Force a full rebuild. EmbeddingGemma v1
  // and v2 are both 768d, so a dim check is not enough; model+backend is the
  // real signal.
  const storedModel = store.getMeta(db, 'model');
  const storedBackend = store.getMeta(db, 'backend');
  const modelChanged =
    (!!storedModel && storedModel !== EMBED_MODEL) ||
    (!!storedBackend && storedBackend !== EMBED_BACKEND);
  if (modelChanged) {
    full = true;
    const from = [storedBackend, storedModel].filter(Boolean).join(':') || 'unknown';
    onProgress(`  embedding identity changed (${from} -> ${EMBED_BACKEND}:${EMBED_MODEL}); rebuilding`);
  }

  const files = [];
  for (const root of INDEX_ROOTS) {
    const base = path.join(REPO_ROOT, root);
    if (fs.existsSync(base)) files.push(...walk(base));
  }
  files.sort();

  const seen = new Set();
  let indexed = 0;
  let skipped = 0;
  let chunkTotal = 0;
  let dim = 0;

  for (const abs of files) {
    const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
    seen.add(rel);
    const raw = fs.readFileSync(abs);
    const fhash = sha1(raw);
    if (!full && store.fileHash(db, rel) === fhash) {
      skipped++;
      continue;
    }

    const chunks = chunkFile(raw.toString('utf8'), rel);
    const lang = langOf(rel);
    const records = [];
    for (let i = 0; i < chunks.length; i += batch) {
      const part = chunks.slice(i, i + batch);
      const vecs = await embedTexts(part.map((c) => DOC_TEXT(rel, c.text)));
      if (vecs[0]?.length) dim = vecs[0].length;
      part.forEach((c, j) => records.push({ ...c, lang, chunkHash: sha1(c.text), vec: vecs[j] }));
    }
    store.replaceFile(db, rel, fhash, records);
    indexed++;
    chunkTotal += records.length;
    onProgress(`  + ${rel} (${records.length} chunks)`);
  }

  // Only prune files that fall under a configured root. Without this, a build
  // run with a narrower INDEX_ROOTS (e.g. a server that has not re-read the
  // config) would treat every out-of-scope file as deleted and drop it.
  const inScope = (rel) =>
    INDEX_ROOTS.some((r) => r === '.' || rel === r || rel.startsWith(`${r}/`));
  let removed = 0;
  for (const row of db.prepare('SELECT relpath FROM files').all()) {
    if (!seen.has(row.relpath) && inScope(row.relpath)) {
      store.deleteFile(db, row.relpath);
      removed++;
    }
  }
  // Record provenance so a later model switch is detected (see above) and so
  // search can refuse to compare across embedding spaces.
  store.setMeta(db, 'model', EMBED_MODEL);
  store.setMeta(db, 'backend', EMBED_BACKEND);
  if (dim) store.setMeta(db, 'dim', dim);

  return { indexed, skipped, removed, chunks: chunkTotal, totalFiles: files.length, modelChanged };
}

// Model / dimension provenance of an existing index. `mismatch` means the
// stored vectors were produced by a different model than the one configured
// now, so they must not be searched until a rebuild completes.
export function indexProvenance(db = store.open()) {
  const model = store.getMeta(db, 'model');
  const backend = store.getMeta(db, 'backend');
  const dim = Number(store.getMeta(db, 'dim')) || 0;
  const mismatch =
    (!!model && model !== EMBED_MODEL) || (!!backend && backend !== EMBED_BACKEND);
  return { model, backend, dim, mismatch };
}

export async function searchQuery(query, k = 8, pathPrefix = null) {
  const db = store.open();
  const [qvec] = await embedTexts([QUERY_TEXT(query)]);
  const { model, backend, dim, mismatch } = indexProvenance(db);
  if (mismatch) {
    const from = [backend, model].filter(Boolean).join(':') || 'unknown';
    throw Object.assign(
      new Error(
        `index was built with "${from}", current is "${EMBED_BACKEND}:${EMBED_MODEL}" — reindex required.`
      ),
      { code: 'INDEX_STALE' }
    );
  }
  if (dim && qvec?.length && qvec.length !== dim) {
    throw Object.assign(
      new Error(`Index dimension ${dim} != query dimension ${qvec.length} — reindex required.`),
      { code: 'INDEX_STALE' }
    );
  }
  return store.search(db, qvec, k, pathPrefix);
}

export function status() {
  const db = store.open();
  const s = store.status(db);
  const { model, backend, mismatch } = indexProvenance(db);
  return { ...s, model, backend, mismatch };
}

// ── Background indexing ──────────────────────────────────────────────────────
// Search must never block on a build. ensureIndex() starts a non-blocking,
// incremental build (at most once per cooldown, and only in a real project) and
// returns immediately; callers keep serving whatever is already indexed while
// the build runs. Repeated calls run the same in-flight promise.
let building = null;
let lastKick = 0;
const KICK_COOLDOWN_MS = 5000;

export function isBuilding() {
  return building !== null;
}

export function ensureIndex({ full = false, onProgress = () => {} } = {}) {
  if (building) return building;
  if (!looksLikeProject()) return null;
  const now = Date.now();
  if (now - lastKick < KICK_COOLDOWN_MS) return null;
  lastKick = now;
  building = build({ full, onProgress })
    .catch((err) => {
      process.stderr.write(`code-rag: background index failed: ${err?.message ?? err}\n`);
      return null;
    })
    .finally(() => {
      building = null;
    });
  return building;
}
