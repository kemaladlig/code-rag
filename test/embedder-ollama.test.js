import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.CODE_RAG_EMBED_BACKEND = 'ollama';
process.env.CODE_RAG_MODEL = 'test-model';
const { embedTexts } = await import('../src/embedder.js');

let calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url, body: JSON.parse(opts.body) });
  return { ok: true, json: async () => ({ embeddings: [[3, 4]] }) };
};

test('ollama: posts to /api/embed with the model and L2-normalizes', async () => {
  calls = [];
  const v = await embedTexts(['hello']);
  assert.deepEqual(v, [[0.6, 0.8]]);
  assert.match(calls[0].url, /\/api\/embed$/);
  assert.equal(calls[0].body.model, 'test-model');
  assert.deepEqual(calls[0].body.input, ['hello']);
});

test('ollama: empty input short-circuits without a request', async () => {
  calls = [];
  assert.deepEqual(await embedTexts([]), []);
  assert.equal(calls.length, 0);
});

test('non-finite embeddings are rejected (float16 NaN guard)', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ embeddings: [[NaN, 1]] }) });
  await assert.rejects(() => embedTexts(['x']), (e) => e.code === 'EMBED_NONFINITE');
});

test('a transport failure is EMBED_UNREACHABLE', async () => {
  globalThis.fetch = async () => {
    throw new Error('connect ECONNREFUSED');
  };
  await assert.rejects(() => embedTexts(['x']), (e) => e.code === 'EMBED_UNREACHABLE');
});

test('a server-side refusal keeps the server message (EMBED_HTTP)', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => 'unknown model architecture: gemma-embedding2',
  });
  await assert.rejects(
    () => embedTexts(['x']),
    (e) => e.code === 'EMBED_HTTP' && /unknown model architecture/.test(e.message)
  );
});
