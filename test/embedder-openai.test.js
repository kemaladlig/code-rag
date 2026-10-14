import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.CODE_RAG_EMBED_BACKEND = 'openai';
process.env.CODE_RAG_OPENAI_URL = 'http://127.0.0.1:8081/v1/embeddings';
process.env.CODE_RAG_MODEL = 'embeddinggemma2';
const { embedTexts } = await import('../src/embedder.js');

let calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url, body: JSON.parse(opts.body) });
  return { ok: true, json: async () => ({ data: [{ embedding: [0, 5] }] }) };
};

test('openai: posts to the configured URL and parses data[].embedding', async () => {
  calls = [];
  const v = await embedTexts(['hello']);
  assert.deepEqual(v, [[0, 1]]);
  assert.equal(calls[0].url, 'http://127.0.0.1:8081/v1/embeddings');
  assert.equal(calls[0].body.model, 'embeddinggemma2');
  assert.equal(calls[0].body.encoding_format, 'float');
  assert.deepEqual(calls[0].body.input, ['hello']);
});
