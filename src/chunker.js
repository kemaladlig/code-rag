// Code-aware chunking: top-level declarations (JS/TS), headings (md),
// overlapping windows (anything else). Each chunk keeps symbol + line range.
import { MAX_CHUNK_LINES, MIN_CHUNK_LINES, WINDOW_OVERLAP } from './config.js';

const CODE_DECL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/;
const MD_HEADING = /^#{1,6}\s+(.*\S)/;

export function langOf(relpath) {
  if (relpath.endsWith('.md')) return 'md';
  if (/\.(js|mjs|cjs|ts)$/.test(relpath)) return 'js';
  return 'other';
}

function splitByBoundaries(lines, re) {
  let starts = [];
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) starts.push(i);
  if (starts.length === 0 || starts[0] !== 0) starts = [0, ...starts];
  starts.push(lines.length);
  const spans = [];
  for (let i = 0; i < starts.length - 1; i++) spans.push([starts[i], starts[i + 1]]);
  return spans;
}

function splitOversized([a, b]) {
  const out = [];
  const step = MAX_CHUNK_LINES;
  while (b - a > step) {
    out.push([a, a + step]);
    a += step - WINDOW_OVERLAP;
  }
  out.push([a, b]);
  return out;
}

function symbolFor(lines, start, lang) {
  for (let i = start; i < lines.length; i++) {
    const m = lang === 'md' ? MD_HEADING.exec(lines[i]) : CODE_DECL.exec(lines[i]);
    if (m) return m[1].trim();
    if (lines[i].trim()) return '';
  }
  return '';
}

export function chunkFile(text, relpath) {
  const lang = langOf(relpath);
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];

  let spans;
  if (lang === 'md') {
    spans = splitByBoundaries(lines, MD_HEADING);
  } else if (lang === 'js') {
    spans = splitByBoundaries(lines, CODE_DECL);
  } else {
    spans = [];
    const step = MAX_CHUNK_LINES - WINDOW_OVERLAP;
    for (let i = 0; i < lines.length; i += step) {
      spans.push([i, Math.min(i + MAX_CHUNK_LINES, lines.length)]);
    }
  }

  const chunks = [];
  for (const span of spans) {
    for (const [a, b] of splitOversized(span)) {
      if (b - a < MIN_CHUNK_LINES && chunks.length) {
        chunks[chunks.length - 1].end = b;
        chunks[chunks.length - 1].text += '\n' + lines.slice(a, b).join('\n');
        continue;
      }
      const body = lines.slice(a, b).join('\n');
      if (!body.trim()) continue;
      chunks.push({ symbol: symbolFor(lines, a, lang), start: a + 1, end: b, text: body });
    }
  }
  return chunks;
}
