import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../src/store.js';

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-rag-store-'));
  return store.open(path.join(dir, 'index.db'));
}

const chunk = (vec, text = 'code') => ({
  lang: 'js',
  symbol: 's',
  start: 1,
  end: 2,
  chunkHash: text,
  vec,
  text,
});

test('search ranks by cosine and honours scope filters', () => {
  const db = freshDb();
  store.replaceFile(db, 'src/a.js', 'h1', [chunk([1, 0])]);
  store.replaceFile(db, 'docs/b.md', 'h2', [chunk([0, 1])]);

  const all = store.search(db, [1, 0], 5, null);
  assert.equal(all.length, 2);
  assert.equal(all[0].relpath, 'src/a.js');

  assert.deepEqual(
    store.search(db, [1, 0], 5, 'src').map((r) => r.relpath),
    ['src/a.js']
  );
  assert.deepEqual(
    store.search(db, [1, 0], 5, { exclude: ['docs'] }).map((r) => r.relpath),
    ['src/a.js']
  );
});

test('fileHash and deleteFile track file state', () => {
  const db = freshDb();
  store.replaceFile(db, 'src/a.js', 'hash-A', [chunk([1, 0])]);
  assert.equal(store.fileHash(db, 'src/a.js'), 'hash-A');
  store.deleteFile(db, 'src/a.js');
  assert.equal(store.fileHash(db, 'src/a.js'), null);
  assert.equal(store.search(db, [1, 0], 5, null).length, 0);
});

test('meta round-trips and file-hash skip matches on re-index', () => {
  const db = freshDb();
  store.setMeta(db, 'model', 'embeddinggemma');
  store.setMeta(db, 'model', 'embeddinggemma-2');
  assert.equal(store.getMeta(db, 'model'), 'embeddinggemma-2');
  assert.equal(store.getMeta(db, 'nope'), null);
});

test('status reports file and chunk counts', () => {
  const db = freshDb();
  store.replaceFile(db, 'src/a.js', 'h1', [chunk([1, 0]), chunk([0, 1], 'other')]);
  assert.deepEqual(
    { files: store.status(db).files, chunks: store.status(db).chunks },
    { files: 1, chunks: 2 }
  );
});
