import fs from 'node:fs';
import path from 'node:path';

// Repo root. OpenCode launches a local MCP server with the workspace as its
// cwd, so inside the server `process.cwd()` is the project being worked on;
// the CLI uses wherever it is invoked. CODE_RAG_REPO overrides both. A client
// that advertises MCP roots can move it at runtime via setRepoRoot (see
// mcp.js), so the tool is correct even when launched in the wrong directory.
export let REPO_ROOT = process.env.CODE_RAG_REPO
  ? path.resolve(process.env.CODE_RAG_REPO)
  : process.cwd();

const splitList = (v) =>
  String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// Index scope. CODE_RAG_ROOTS="src,docs" wins; otherwise a conventional src/
// layout (plus docs/ when present) is preferred, and any project without src/
// — monorepos with apps//packages/, docs-only repos, … — is indexed whole.
function resolveRoots(root) {
  const fromEnv = process.env.CODE_RAG_ROOTS;
  if (fromEnv) return splitList(fromEnv);
  if (!fs.existsSync(path.join(root, 'src'))) return ['.'];
  const roots = ['src'];
  if (fs.existsSync(path.join(root, 'docs'))) roots.push('docs');
  return roots;
}
export let INDEX_ROOTS = resolveRoots(REPO_ROOT);

// Where "code scope" searches. CODE_RAG_CODE_ROOTS="apps,packages" wins;
// otherwise it is the index roots minus docs and "." — an empty result means
// "all code" (the whole index except docs), which is what scope=code falls back
// to so a monorepo without src/ still gets a meaningful default.
function resolveCodeRoots() {
  const fromEnv = process.env.CODE_RAG_CODE_ROOTS;
  if (fromEnv) return splitList(fromEnv);
  return INDEX_ROOTS.filter((r) => r !== 'docs' && r !== '.');
}
export let CODE_ROOTS = resolveCodeRoots();

export const INCLUDE_SUFFIXES = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.md',
  '.html',
]);

export const EXCLUDE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'art-source',
  'vibe_images',
  'test-results',
  '.venv',
  '__pycache__',
  '.cache',
  '.code-rag',
  '.expo',
  '.next',
  '.turbo',
  '.output',
  'coverage',
  'android',
  'ios',
]);

// Embedding backend. "ollama" talks to Ollama's /api/embed; "openai" talks to
// any OpenAI-compatible /v1/embeddings endpoint — e.g. a standalone llama.cpp
// llama-server, which is the only GPU route to EmbeddingGemma 2 on Windows.
export const EMBED_BACKEND = process.env.CODE_RAG_EMBED_BACKEND || 'ollama';

// EmbeddingGemma v1 (300M) served by Ollama is the default: Ollama's GGML
// engine reaches the GPU (~10x faster indexing than the ONNX/CPU path). See
// README for why v2 is not the default on this machine yet.
export const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');

// Full endpoint URL for the "openai" backend (llama-server default shown).
export const OPENAI_URL =
  process.env.CODE_RAG_OPENAI_URL || 'http://127.0.0.1:8080/v1/embeddings';

// Backend-agnostic model name. CODE_RAG_MODEL wins; the older, Ollama-specific
// CODE_RAG_OLLAMA_MODEL still works; default is the EmbeddingGemma tag.
export const EMBED_MODEL =
  process.env.CODE_RAG_MODEL || process.env.CODE_RAG_OLLAMA_MODEL || 'embeddinggemma';

// Asymmetric task prefix (model card): queries carry the task prefix, documents
// the title/text form. The card offers a code-specific prompt ("task: code
// retrieval") beside the generic document-search one; override to A/B them
// without reindexing, since only queries are affected.
export const QUERY_PREFIX =
  process.env.CODE_RAG_QUERY_PREFIX || 'task: search result | query: ';
// Long sequences dominate embedding cost; cap the code part (0 = no cap).
export const MAX_DOC_CHARS = Number(process.env.CODE_RAG_MAX_DOC_CHARS ?? 1600);

export const QUERY_TEXT = (q) => QUERY_PREFIX + q;
export const DOC_TEXT = (title, code) =>
  `title: ${title} | text: ${MAX_DOC_CHARS ? code.slice(0, MAX_DOC_CHARS) : code}`;

// One index per repo, kept beside the project and self-ignored (see store.js),
// so a single tool install serves every project. CODE_RAG_DB overrides the
// path, resolved relative to the repo root.
export let DB_PATH = process.env.CODE_RAG_DB
  ? path.resolve(REPO_ROOT, process.env.CODE_RAG_DB)
  : path.join(REPO_ROOT, '.code-rag', 'index.db');

// Chunk geometry. 40 lines keeps sequences short (the dominant cost) and is the
// configuration the retrieval eval was tuned on.
export const MAX_CHUNK_LINES = Number(process.env.CODE_RAG_MAX_CHUNK_LINES ?? 40);
export const MIN_CHUNK_LINES = 5;
export const WINDOW_OVERLAP = Number(process.env.CODE_RAG_WINDOW_OVERLAP ?? 12);

// A directory is worth auto-indexing when it has a repo marker or a conventional
// source/docs root. Guards the background build from crawling a non-project cwd
// (e.g. the home directory) if a tool launches the server in the wrong place.
export function looksLikeProject(root = REPO_ROOT) {
  return ['.git', 'src', 'docs'].some((name) => fs.existsSync(path.join(root, name)));
}

// Rebind the repository root at runtime (MCP roots/list). Recomputes scope and
// index path; returns true when the root actually changed. The ESM live
// bindings above mean importers (indexer, store, mcp) see the new values.
export function setRepoRoot(root) {
  if (!root) return false;
  const abs = path.resolve(root);
  if (abs === REPO_ROOT) return false;
  REPO_ROOT = abs;
  INDEX_ROOTS = resolveRoots(REPO_ROOT);
  CODE_ROOTS = resolveCodeRoots();
  DB_PATH = process.env.CODE_RAG_DB
    ? path.resolve(REPO_ROOT, process.env.CODE_RAG_DB)
    : path.join(REPO_ROOT, '.code-rag', 'index.db');
  return true;
}
