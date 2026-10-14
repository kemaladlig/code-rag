import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../src/store.js';
import { indexProvenance } from '../src/indexer.js';
import { EMBED_BACKEND, EMBED_MODEL } from '../src/config.js';

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-rag-prov-'));
  return store.open(path.join(dir, 'index.db'));
}

test('no provenance yet: not a mismatch (backward-compatible with old indexes)', () => {
  const db = freshDb();
  assert.equal(indexProvenance(db).mismatch, false);
});

test('matching model + backend is not a mismatch', () => {
  const db = freshDb();
  store.setMeta(db, 'model', EMBED_MODEL);
  store.setMeta(db, 'backend', EMBED_BACKEND);
  const p = indexProvenance(db);
  assert.equal(p.mismatch, false);
  assert.equal(p.model, EMBED_MODEL);
});

test('a different model is a mismatch even at equal dimension', () => {
  const db = freshDb();
  store.setMeta(db, 'model', 'some-other-768d-model');
  store.setMeta(db, 'backend', EMBED_BACKEND);
  assert.equal(indexProvenance(db).mismatch, true);
});

test('a different backend is a mismatch too (runtimes shift vectors)', () => {
  const db = freshDb();
  store.setMeta(db, 'model', EMBED_MODEL);
  store.setMeta(db, 'backend', 'not-the-current-backend');
  assert.equal(indexProvenance(db).mismatch, true);
});
