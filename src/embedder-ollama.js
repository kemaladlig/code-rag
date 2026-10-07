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
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const { embeddings } = await res.json();
  return embeddings.map(normalize);
}
