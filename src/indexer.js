// Walk the configured roots, chunk, embed, store. Hash-based incremental.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  DOC_TEXT,
  EXCLUDE_DIRS,
  INCLUDE_SUFFIXES,
  INDEX_ROOTS,
  QUERY_TEXT,
  REPO_ROOT,
  looksLikeProject,
} from './config.js';
import { chunkFile, langOf } from './chunker.js';
import { embedTexts } from './embedder-ollama.js';
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
  return { indexed, skipped, removed, chunks: chunkTotal, totalFiles: files.length };
}

export async function searchQuery(query, k = 8, pathPrefix = null) {
  const db = store.open();
  const [qvec] = await embedTexts([QUERY_TEXT(query)]);
  return store.search(db, qvec, k, pathPrefix);
}

export function status() {
  return store.status(store.open());
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
