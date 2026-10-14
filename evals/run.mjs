#!/usr/bin/env node
// Generic retrieval eval. Reads a cases file and reports recall@1/@5 and MRR for
// the semantic index. No repo-specific data is baked in — point it at your own
// cases (see evals/cases.example.json):
//
//   node evals/run.mjs evals/cases.json          # rank across the whole index
//   node evals/run.mjs evals/cases.json --code   # rank within code scope only
//   CODE_RAG_EVAL=evals/cases.json node evals/run.mjs
//
// Run from the repo root you indexed (the index lives in <repo>/.code-rag).
import fs from 'node:fs';
import path from 'node:path';
import { searchQuery } from '../src/indexer.js';
import { CODE_ROOTS } from '../src/config.js';

const args = process.argv.slice(2);
const codeOnly = args.includes('--code');
const file =
  args.find((a) => !a.startsWith('--')) ||
  process.env.CODE_RAG_EVAL ||
  path.join(import.meta.dirname, 'cases.example.json');

const CANDIDATES = 50; // fetched before optional code filtering
const TOP = 5; // ranking depth reported

const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const cases = Array.isArray(raw) ? raw : raw.cases;
if (!Array.isArray(cases) || cases.length === 0) {
  console.error(`no cases found in ${file}`);
  process.exit(2);
}

// "code scope" mirrors the server: CODE_ROOTS, else the whole index minus docs.
const inCode = (rel) =>
  CODE_ROOTS.length
    ? CODE_ROOTS.some((r) => rel === r || rel.startsWith(`${r}/`))
    : !rel.startsWith('docs/');

let top1 = 0;
let top5 = 0;
let mrr = 0;
let hijacks = 0;

for (const { query, expect } of cases) {
  const all = await searchQuery(query, CANDIDATES);
  const ranked = (codeOnly ? all.filter((r) => inCode(r.relpath)) : all).slice(0, TOP);
  const rank = ranked.findIndex((r) => r.relpath === expect) + 1;
  if (rank === 1) top1++;
  if (rank) top5++;
  if (rank) mrr += 1 / rank;
  const allTop = all[0]?.relpath ?? '-';
  const hijack = !inCode(allTop);
  if (hijack) hijacks++;
  console.log(
    `${rank ? 'HIT ' : 'MISS'} r=${rank || '-'} | ${ranked[0]?.relpath ?? allTop}` +
      `${hijack ? ' [DOC]' : ''} | ${query} (expected ${expect})`
  );
}

const n = cases.length;
const pct = (x) => `${Math.round((x / n) * 100)}%`;
console.log(
  `\n${codeOnly ? 'code-only' : 'all'} (k=${TOP}, ${file}): ` +
    `recall@1=${top1}/${n} (${pct(top1)})  recall@5=${top5}/${n} (${pct(top5)})  ` +
    `MRR=${(mrr / n).toFixed(3)}  doc_hijacks=${hijacks}/${n}`
);
