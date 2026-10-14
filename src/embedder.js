// Embedding backends behind one registry, selected by CODE_RAG_EMBED_BACKEND:
//   ollama  -> Ollama's /api/embed
//   openai  -> any OpenAI-compatible /v1/embeddings (llama.cpp llama-server,
//              vLLM, ...), the GPU route to EmbeddingGemma 2 on Windows.
// Both return L2-normalized vectors and reject non-finite output.
//
// EmbeddingGemma 2's model card warns that float16 inference can return NaN or
// silently degraded vectors rather than raising; a non-finite embedding would
// poison every cosine score, so fail loudly instead.
import { EMBED_BACKEND, EMBED_MODEL, OLLAMA_URL, OPENAI_URL } from './config.js';

function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

function clean(v) {
  const out = normalize(v);
  if (!out.every(Number.isFinite)) {
    throw Object.assign(
      new Error(
        `non-finite embedding from model "${EMBED_MODEL}" — possible float16 ` +
          'precision issue; use bf16/fp32 or a non-fp16 quant.'
      ),
      { code: 'EMBED_NONFINITE' }
    );
  }
  return out;
}

async function postJson(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Transport failure: the server is not there at all.
    const cause = err?.cause?.code ?? err?.message ?? err;
    throw Object.assign(new Error(`${EMBED_BACKEND} unreachable at ${url} (${cause})`), {
      code: 'EMBED_UNREACHABLE',
    });
  }
  if (!res.ok) {
    // Reached the server, but it refused — e.g. "unknown model architecture" or
    // "requires MLX". Keep the server's own message; it names the real cause.
    throw Object.assign(new Error(`${EMBED_BACKEND} ${res.status}: ${(await res.text()).trim()}`), {
      code: 'EMBED_HTTP',
    });
  }
  return res.json();
}

async function embedOllama(texts) {
  const { embeddings } = await postJson(`${OLLAMA_URL}/api/embed`, {
    model: EMBED_MODEL,
    input: texts,
  });
  return embeddings.map(clean);
}

async function embedOpenAI(texts) {
  const { data } = await postJson(OPENAI_URL, {
    model: EMBED_MODEL,
    input: texts,
    encoding_format: 'float',
  });
  return data.map((d) => clean(d.embedding));
}

const BACKENDS = { ollama: embedOllama, openai: embedOpenAI };

export async function embedTexts(texts) {
  if (texts.length === 0) return [];
  const fn = BACKENDS[EMBED_BACKEND];
  if (!fn) {
    throw Object.assign(
      new Error(
        `unknown CODE_RAG_EMBED_BACKEND "${EMBED_BACKEND}" ` +
          `(expected: ${Object.keys(BACKENDS).join(', ')})`
      ),
      { code: 'EMBED_BACKEND_UNKNOWN' }
    );
  }
  return fn(texts);
}
