#!/usr/bin/env node
// CLI: index / search / status / doctor. Run as `code-rag ...` (npm bin) or
// `node src/cli.js ...` from a checkout.
import {
  CODE_ROOTS,
  DB_PATH,
  EMBED_BACKEND,
  EMBED_MODEL,
  INDEX_ROOTS,
  OLLAMA_URL,
  OPENAI_URL,
  QUERY_TEXT,
  REPO_ROOT,
  looksLikeProject,
} from './config.js';
import { build, searchQuery, status } from './indexer.js';
import { embedTexts } from './embedder.js';

function parse(argv) {
  const [cmd, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--full' || a === '-q' || a === '--quiet') flags[a] = true;
    else if (a === '-k') flags.k = Number(rest[++i]);
    else if (a === '--path') flags.path = rest[++i];
    else if (a === '--scope') flags.scope = rest[++i];
    else positional.push(a);
  }
  return { cmd, flags, positional };
}

async function main() {
  const { cmd, flags, positional } = parse(process.argv.slice(2));

  if (cmd === 'index') {
    const t0 = Date.now();
    console.log(`Indexing [${INDEX_ROOTS.join(', ')}] with ${EMBED_MODEL} (${EMBED_BACKEND}) ...`);
    const report = await build({
      full: !!flags['--full'],
      onProgress: flags['-q'] || flags['--quiet'] ? () => {} : (m) => console.log(m),
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `Done in ${secs}s | indexed=${report.indexed} skipped=${report.skipped} ` +
        `removed=${report.removed} chunks=${report.chunks} files=${report.totalFiles}` +
        (report.modelChanged ? ' | model changed: full rebuild' : '')
    );
    return;
  }

  if (cmd === 'search') {
    const query = positional.join(' ');
    if (!query) throw new Error('usage: search "<query>" [-k N] [--scope code|docs|all] [--path src/core]');
    let scope = flags.path || null;
    if (!scope) {
      if (flags.scope === 'code') scope = CODE_ROOTS.length ? CODE_ROOTS : { exclude: ['docs'] };
      else if (flags.scope === 'docs') scope = ['docs'];
    }
    let results;
    try {
      results = await searchQuery(query, flags.k || 8, scope);
    } catch (err) {
      if (err?.code === 'EMBED_UNREACHABLE') {
        console.error(
          `Embedding backend "${EMBED_BACKEND}" unreachable — start it and retry ` +
            '(Ollama: `ollama serve`; llama-server: run it on its /v1/embeddings port).'
        );
        process.exitCode = 1;
        return;
      }
      if (err?.code === 'EMBED_HTTP') {
        console.error(`Embedding failed — ${err.message}`);
        process.exitCode = 1;
        return;
      }
      if (err?.code === 'INDEX_STALE') {
        console.error(`${err.message}\nRun \`node src/cli.js index --full\` to rebuild for the current model.`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }
    if (results.length === 0) {
      console.log('No results.');
      return;
    }
    results.forEach((r, i) => {
      const loc = `${r.relpath}:${r.start}-${r.end}`;
      console.log(`\n[${i + 1}] ${loc}  score=${r.score.toFixed(3)}  ${r.symbol || ''}`.trimEnd());
      const snippet = r.text.split(/\r?\n/).slice(0, 6).join('\n    ');
      console.log('    ' + snippet);
    });
    return;
  }

  if (cmd === 'status') {
    const st = status();
    const when = st.lastIndexed ? new Date(st.lastIndexed * 1000).toLocaleString() : '-';
    console.log(`files=${st.files} chunks=${st.chunks} last_indexed=${when}`);
    console.log(
      `backend=${EMBED_BACKEND} (${EMBED_MODEL})  index_model=${st.model ?? 'unknown'}` +
        (st.mismatch ? ' (MISMATCH — reindex needed)' : '')
    );
    console.log(`db=${DB_PATH}`);
    return;
  }

  if (cmd === 'doctor') {
    const [maj, min] = process.versions.node.split('.').map(Number);
    const checks = [];
    const check = (ok, msg) => checks.push([ok, msg]);

    check(maj > 22 || (maj === 22 && min >= 5), `node ${process.versions.node} (need >= 22.5 for node:sqlite)`);
    if (maj < 24 && (maj < 23 || (maj === 23 && min < 4))) {
      check(false, 'node:sqlite needs --experimental-sqlite on Node < 23.4 (or use Node 24+)');
    }

    const endpoint = EMBED_BACKEND === 'openai' ? OPENAI_URL : `${OLLAMA_URL}/api/embed`;
    check(true, `embedding backend: ${EMBED_BACKEND} (${EMBED_MODEL}) -> ${endpoint}`);

    const t0 = Date.now();
    try {
      const [v] = await embedTexts([QUERY_TEXT('ping')]);
      check(v?.length > 0, `embedding endpoint ok (${v.length}-dim, ${Date.now() - t0} ms)`);
    } catch (err) {
      check(false, `embedding endpoint: ${err.message}`);
    }

    const st = status();
    const project = looksLikeProject();
    check(
      project || st.chunks > 0,
      `repo: ${REPO_ROOT}${project ? '' : ' (no .git/src/docs — will not auto-index)'}`
    );
    check(
      st.chunks > 0,
      `index: ${st.files} files, ${st.chunks} chunks` +
        (st.mismatch ? ` — STALE: built with ${st.model ?? '?'}, run \`index --full\`` : '')
    );

    for (const [ok, msg] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
    process.exitCode = checks.some(([ok]) => !ok) ? 1 : 0;
    return;
  }

  console.log('usage: code-rag <index|search|status|doctor>');
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
