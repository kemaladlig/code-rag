// CLI: index / search / status. Run from tools/code-rag: node src/cli.js ...
import { CODE_ROOTS, DB_PATH, INDEX_ROOTS, OLLAMA_MODEL } from './config.js';
import { build, searchQuery, status } from './indexer.js';

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
    console.log(`Indexing [${INDEX_ROOTS.join(', ')}] with ${OLLAMA_MODEL} (ollama) ...`);
    const report = await build({
      full: !!flags['--full'],
      onProgress: flags['-q'] || flags['--quiet'] ? () => {} : (m) => console.log(m),
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `Done in ${secs}s | indexed=${report.indexed} skipped=${report.skipped} ` +
        `removed=${report.removed} chunks=${report.chunks} files=${report.totalFiles}`
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
    const results = await searchQuery(query, flags.k || 8, scope);
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
    console.log(`db=${DB_PATH}`);
    return;
  }

  console.log('usage: node src/cli.js <index|search|status>');
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
