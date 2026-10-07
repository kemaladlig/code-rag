// EmbeddingGemma (v1) via Ollama. Kept warm by the Ollama server, so queries are
// fast; on this machine Ollama/GGML uses the GPU where ONNX DirectML did not.
import { OLLAMA_MODEL, OLLAMA_URL } from './config.js';

function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

export async function embedTexts(texts) {
  if (texts.length === 0) return [];
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, input: texts }),
    });
  } catch (err) {
    const cause = err?.cause?.code ?? err?.message ?? err;
    throw Object.assign(new Error(`Ollama unreachable at ${OLLAMA_URL} (${cause})`), {
      code: 'OLLAMA_UNAVAILABLE',
    });
  }
  if (!res.ok) {
    throw Object.assign(new Error(`Ollama ${res.status}: ${await res.text()}`), {
      code: 'OLLAMA_UNAVAILABLE',
    });
  }
  const { embeddings } = await res.json();
  return embeddings.map(normalize);
}
