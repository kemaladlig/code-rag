import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkFile, langOf } from '../src/chunker.js';

test('langOf maps extensions to a chunking strategy', () => {
  assert.equal(langOf('a.md'), 'md');
  assert.equal(langOf('a.js'), 'js');
  assert.equal(langOf('a.ts'), 'js');
  assert.equal(langOf('a.mjs'), 'js');
  assert.equal(langOf('a.css'), 'other');
});

test('js: two top-level functions become two chunks with symbols and ranges', () => {
  const src = [
    'export function alpha() {',
    '  const x = 1;',
    '  const y = 2;',
    '  return x + y;',
    '}',
    '',
    'export function beta() {',
    '  const a = 1;',
    '  const b = 2;',
    '  const c = 3;',
    '  return a + b + c;',
    '}',
  ].join('\n');
  const chunks = chunkFile(src, 'x.js');
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].symbol, 'alpha');
  assert.equal(chunks[1].symbol, 'beta');
  assert.deepEqual([chunks[0].start, chunks[0].end], [1, 6]);
  assert.deepEqual([chunks[1].start, chunks[1].end], [7, 12]);
});

test('md: consecutive headings become separate chunks named after the heading', () => {
  const src = [
    '# Title',
    'l1',
    'l2',
    'l3',
    'l4',
    '## Section A',
    'a1',
    'a2',
    'a3',
    'a4',
    '## Section B',
    'b1',
    'b2',
    'b3',
    'b4',
  ].join('\n');
  const chunks = chunkFile(src, 'doc.md');
  assert.deepEqual(
    chunks.map((c) => c.symbol),
    ['Title', 'Section A', 'Section B']
  );
});

test('other languages use overlapping windows', () => {
  const src = Array.from({ length: 100 }, (_, i) => `.c${i} {}`).join('\n');
  const chunks = chunkFile(src, 'x.css');
  assert.equal(chunks.length, 4);
  assert.deepEqual([chunks[0].start, chunks[0].end], [1, 40]);
  // consecutive windows overlap by WINDOW_OVERLAP lines
  assert.ok(chunks[1].start < chunks[0].end);
});

test('a short trailing section is merged into the previous chunk', () => {
  const src = [
    'export function solo() {',
    '  return 1;',
    '}',
    '',
    'export function tail() {',
    '  return 2;',
    '}',
  ].join('\n');
  const chunks = chunkFile(src, 'x.js');
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].symbol, 'solo');
  assert.equal(chunks[0].end, 7);
});

test('empty / whitespace-only input yields no chunks', () => {
  assert.deepEqual(chunkFile('', 'x.js'), []);
  assert.deepEqual(chunkFile('\n\n  \n', 'x.md'), []);
});
