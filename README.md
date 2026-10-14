# Code RAG (local semantic code search)

[![CI](https://github.com/kemaladlig/code-rag/actions/workflows/ci.yml/badge.svg)](https://github.com/kemaladlig/code-rag/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node: >=22.5](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen.svg)](https://nodejs.org)
[![dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

Local semantic search over a repository, exposed to any MCP client (OpenCode,
VS Code, Cursor, Windsurf, Claude Code, Codex, Gemini CLI/Antigravity) through a
small MCP server so an agent can locate code by meaning before reading files.
Runs entirely in Node with no npm dependencies; embeddings come from Ollama or
any OpenAI-compatible endpoint (e.g. a llama.cpp `llama-server`).

The same tool install serves **every project**: it derives the repo root from
MCP roots / the working directory, keeps one self-ignored index per repo, and is
registered globally so no per-project wiring is needed.

## Stack

- **Embeddings:** EmbeddingGemma via a pluggable backend (`CODE_RAG_EMBED_BACKEND`):
  **ollama** (default, GGML/GPU) or any OpenAI-compatible **openai**
  `/v1/embeddings` — e.g. a standalone llama.cpp `llama-server`, which is how
  EmbeddingGemma **2** runs on GPU. No npm deps.
- **Store:** Node's built-in `node:sqlite`; float32 blobs; brute-force cosine.
  Pilot-sized only — swap for `sqlite-vec` if an index grows large.
- **Chunking:** top-level declarations (JS/TS), headings (md), overlapping
  windows (other). Metadata = relpath + symbol + line range.

### Embedding model & backend (why the default is v1 via Ollama)

The **default** is v1 (`embeddinggemma`) through Ollama: it needs nothing beyond
Ollama itself, so the tool works out of the box across every client. EmbeddingGemma
**2** is **faster to index here and never lets docs outrank code**, but on a larger
eval it did **not** beat v1 on top-1 recall — the 16-question set that once
suggested otherwise was too small (see the measured table below). So v1 stays the
default and v2 is opt-in. v2 has no Ollama route on Windows yet — re-checked
Oct 2026:

- **ONNX/Transformers.js:** at v2's launch the only route; DirectML did **not**
  accelerate it, so it indexed on CPU at ~0.7 chunks/s (~20 min). Removed.
- **Ollama, official `embeddinggemma-2`:** refuses on Windows — *"this model
  requires MLX support, but the MLX runtime is not available"*. MLX is
  Apple-Silicon only.
- **Ollama, community GGUF** (`johnwaynelucas/embeddinggemma-2:gguf`): the
  bundled llama.cpp rejects it — *unknown model architecture: `gemma-embedding2`*
  (Ollama 0.40.3).
- **Standalone llama.cpp `llama-server`:** ✅ works on GPU. Architecture support
  ggml-org/llama.cpp#30054; serves OpenAI-compatible `/v1/embeddings`. Recipe in
  "EmbeddingGemma 2 via llama-server" below.

v2 also ships a `task: code retrieval` query prefix; measured here it scored
*worse* on code-only ranking than the generic `task: search result`, so the
default is unchanged (`CODE_RAG_QUERY_PREFIX` retries it).

Vectors from different models are **not** comparable (both v1 and v2 are 768d, so
a dimension check alone would not catch a swap). The index records its provenance
(`meta` table: model **and** backend): switching either forces a full rebuild, and
a query against a stale index fails with a clear "reindex required" message
instead of returning meaningless scores. The guard keys on the model name and
backend only — it cannot see the quantization, so swapping a GGUF for a different
quant under the same `--alias` needs an explicit `code-rag index --full`.

## Chosen configuration (measured)

40-line chunks, `scope=code`, on two of the author's repos — a ~70k-LOC game app
(`src/` layout) and a smaller `apps/`+`packages/` monorepo — against 75
hand-written `query → file` cases (40 + 35). One Windows machine (GTX 1650),
Oct 2026:

| Embedding (code-only)  | brutal-party  | gods-of-rift  | index (bp / gor) |
| ---------------------- | ------------- | ------------- | ---------------- |
| v1 (Ollama)            | **55% / 70%** | **71% / 91%** | 442 s / 305 s    |
| v2 Q4_K_XL (llama.cpp) | 45% / 60%     | 66% / 91%     | 328 s / 217 s    |
| v2 Q8_0 (llama.cpp)    | 45% / 63%     | 69% / 91%     | 395 s / —        |

Cells are recall@1 / recall@5. MRR: brutal-party v1 **0.610** > Q8 0.514 ≈ Q4
0.515; gods-of-rift Q8 **0.786** ≥ v1 0.773 > Q4 0.764. Doc-hijack (a design doc
outranking code): v1 1 per repo, v2 **0**.

Read it honestly: **v2 is not the better retriever here.** On the larger repo it
is ~10 points behind v1 on top-1 and never catches up; on the monorepo it is
within a case or two (and Q8 leads on MRR). An earlier 16-question run suggested
the opposite — that was too small a set, and it was not a quantization artifact
(Q8 ≈ Q4). What v2 *does* buy is speed (~25–35% faster to index) and a clean zero
on doc-hijack, so it stays a supported opt-in, not the default.

_This is a single-machine pilot: the case sets and the working trees both move, so
absolute recall drifts. Reproduce it with the bundled runner (below)._

### Evaluating retrieval

`evals/run.mjs` scores the index against a case file (`query` → expected file
path) and reports recall@1, recall@5, MRR and doc-hijack rate:

```bash
node evals/run.mjs evals/cases.json          # rank across the whole index
node evals/run.mjs evals/cases.json --code   # rank within code scope only
```

Copy `evals/cases.example.json` and replace the queries with your own; there is no
repo-specific data baked in.

## Install

Three things, all cross-platform (Linux / macOS / Windows):

1. **[Ollama](https://ollama.com)** for embeddings + GPU, then pull the model:
   ```bash
   ollama pull embeddinggemma
   ```
2. **Node 22.5+** — the tool uses the built-in `node:sqlite`. Node 23.4+ (and
   24) needs nothing extra; on Node 22–23.3 run with `--experimental-sqlite`
   (e.g. `NODE_OPTIONS=--experimental-sqlite`).
3. **This tool** — run it without installing, or install it globally:
   ```bash
   npx -y semantic-code-rag status     # no install
   npm i -g semantic-code-rag          # or install once
   ```

No other dependencies. Node prints an `ExperimentalWarning` for `node:sqlite` on
some versions; it is harmless.

If the backend is unreachable, `search_code` / `reindex` return a clear note
(marked as an error) instead of a raw failure; fall back to grep/read until it is
back — the existing index stays valid. A server that answers but can't load the
model (e.g. wrong architecture) surfaces its own message.

### EmbeddingGemma 2 via llama-server (v2, GPU, Windows)

v2 needs a standalone llama.cpp build (Ollama can't serve it on Windows — see
above). Build or download `llama-server` with [EmbeddingGemma 2
support](https://github.com/ggml-org/llama.cpp/pull/30054), grab a GGUF such as
[`unsloth/embeddinggemma-2-GGUF`](https://huggingface.co/unsloth/embeddinggemma-2-GGUF)
(text UD-Q4_K_XL ≈ 170 MB), then serve it (GPU offload via `-ngl 99`):

```bash
llama-server \
  --model embeddinggemma-2-UD-Q4_K_XL.gguf --alias embeddinggemma2 \
  --embeddings --pooling mean \
  --ctx-size 8192 --batch-size 8192 --ubatch-size 8192 \
  --host 127.0.0.1 --port 8081 -ngl 99
```

Point the tool at it and rebuild (the guard detects the model/backend change and
rebuilds from scratch automatically):

```bash
export CODE_RAG_EMBED_BACKEND=openai
export CODE_RAG_OPENAI_URL=http://127.0.0.1:8081/v1/embeddings
export CODE_RAG_MODEL=embeddinggemma2
code-rag index --full
```

The MCP server needs the same three variables — set them in its client config
`env` block (see "MCP clients" below), not just your shell.

Text stays on GPU and the model context is 8192, so `ctx`/`batch`/`ubatch` must be
raised together (the default 2048 is too small for a batch of 40-line chunks).
Do **not** serve an FP16 quant: EmbeddingGemma 2 can return NaN in FP16 (the
embedder rejects non-finite vectors loudly if it happens).

Pick the quant deliberately. In our eval Q8_0 and Q4_K_XL scored the same on
retrieval, so on a small GPU Q4 costs nothing in quality. BF16 is the model
card's recommendation, but on this machine (GTX 1650 / Vulkan) it was ~4× slower
to index than Q4 — roughly 20 min vs 5.5 min for the same 3864 chunks.

### MCP clients

Register the server once per client. Most clients (VS Code, Cursor, Windsurf,
Claude Code/Desktop, Codex, Gemini CLI/Antigravity) take a command + args — no
global install needed:

```jsonc
{
  "mcpServers": {
    "code-rag": {
      "command": "npx",
      "args": ["-y", "-p", "semantic-code-rag", "code-rag-mcp"]
    }
  }
}
```

If you ran `npm i -g semantic-code-rag`, use the bin directly instead:
`"command": "code-rag-mcp"`.

OpenCode (`~/.config/opencode/opencode.jsonc`) uses a slightly different shape:

```jsonc
{
  "mcp": {
    "servers": {
      "code-rag": {
        "type": "local",
        "command": ["npx", "-y", "-p", "semantic-code-rag", "code-rag-mcp"]
      }
    }
  }
}
```

Add an `"env"` map to either snippet to run the server against a non-default
backend (e.g. `CODE_RAG_EMBED_BACKEND`, `CODE_RAG_OPENAI_URL`, `CODE_RAG_MODEL`).

The server indexes whichever project the session is in. OpenCode launches it with
the workspace as `cwd`; other clients may not, so it also asks for the workspace
via MCP **roots/list** (when the client advertises the `roots` capability) and
rebinds if `cwd` was wrong. A new project is indexed in the background on first
use — see "First use" below.

## Repo root & index scope

- **Repo root:** MCP `roots/list` → `workspaceFolders`/`rootUri` from
  `initialize` → `cwd`. `CODE_RAG_REPO` overrides all.
- **Index scope (`INDEX_ROOTS`):** `CODE_RAG_ROOTS` wins; otherwise a
  conventional `src/` layout (`src` + `docs` when present). Any project
  **without** `src/` — monorepos with `apps/` + `packages/`, docs-only repos —
  is indexed whole (a `.` root, minus `EXCLUDE_DIRS`).
- **`scope=code` (`CODE_ROOTS`):** `CODE_RAG_CODE_ROOTS` wins; otherwise the
  index roots minus `docs`. When that is empty (whole-repo index) it means "the
  whole index except `docs/`", so `code` stays meaningful in a monorepo.

## Usage (CLI)

Run from the repo root you want to index (the repo root is the working
directory; `CODE_RAG_REPO` overrides it). Assumes the global `code-rag` bin — or
prefix any line with `npx -y -p semantic-code-rag code-rag`:

```bash
code-rag index          # build/refresh (incremental)
code-rag index --full   # force rebuild
code-rag search "round timer reset" -k 5
code-rag search "network envelope" --path src/core
code-rag search "settings" --scope code   # code|docs|all
code-rag status
code-rag doctor   # check node, backend reachability, index freshness
```

### Environment

| Variable                | Default              | Meaning                                        |
| ----------------------- | -------------------- | ---------------------------------------------- |
| `CODE_RAG_REPO`         | `cwd`                | Repo root to index/query (CLI outside the repo) |
| `CODE_RAG_ROOTS`        | `src` (+`docs`) if `src/` exists, else `.` | Comma-separated index scope |
| `CODE_RAG_CODE_ROOTS`   | index roots minus `docs`; empty = all-but-docs | Comma-separated roots for `scope=code` |
| `CODE_RAG_DB`           | `<repo>/.code-rag/index.db` | Index path (relative to repo root)      |
| `CODE_RAG_EMBED_BACKEND` | `ollama`            | `ollama` (`/api/embed`) or `openai` (`/v1/embeddings`) |
| `CODE_RAG_MODEL`        | `embeddinggemma`     | Embedding model name (backend-agnostic)         |
| `CODE_RAG_OPENAI_URL`   | `http://127.0.0.1:8080/v1/embeddings` | Endpoint for the `openai` backend |
| `CODE_RAG_OLLAMA_MODEL` | —                    | Deprecated alias for `CODE_RAG_MODEL`           |
| `CODE_RAG_QUERY_PREFIX` | `task: search result \| query: ` | Query task prefix (retry e.g. `task: code retrieval \| query: `) |
| `OLLAMA_URL`            | `http://127.0.0.1:11434` | Ollama endpoint                            |

## Usage (MCP / OpenCode)

`code-rag-mcp` speaks MCP over stdio and exposes three tools:

- `search_code(query, k?, scope?, path?)` — ranked chunks with file path + line
  range. `scope` defaults to `code` (the project's source roots); use `docs` or
  `all` when needed. `path` overrides `scope`.
- `index_status()` — file/chunk counts, backend, freshness
- `reindex(full?)` — incremental refresh

The MCP protocol for three read-only tools is small enough that a framework
(FastMCP) would only add a dependency, hence the dependency-free server.

## First use: search never blocks

When a project has no index yet — or the working tree moved on — `search_code`
and `index_status` start an incremental build **in the background** and return
immediately with whatever is already indexed. The first call in a new project
may therefore return few results: fall back to normal search/read and retry
shortly. The index is ready seconds to minutes later (embedding/GPU bound); later
calls refresh incrementally and are cheap. `reindex` is the only synchronous
entry point, for when you must wait for the index to be current. Only
directories that look like a project (`.git`, `src/`, or `docs/`) are
auto-indexed, so a stray working directory is never crawled.

## Design

- **Vectors:** 768-dim, L2-normalized.
- **Index provenance:** the `meta` table stores the embedding model **and**
  backend; a swap of either forces a full rebuild and a stale-index query fails
  loudly (see above).
  Non-finite embeddings (the float16 NaN trap in EmbeddingGemma 2's card) are
  rejected rather than stored.
- **Task prefix:** asymmetric per model card — queries get
  `task: search result | query: {q}`, documents `title: {file} | text: {code}`.
- **Long sequences dominate cost**, hence 40-line chunks and a doc-size cap
  (`MAX_DOC_CHARS`).
- **One index per repo** at `<repo>/.code-rag/index.db`, kept out of git by a
  `*` `.gitignore` written inside the directory.

Scope, model and geometry live in `src/config.js`.

## Troubleshooting

- **`ExperimentalWarning: SQLite …`** — `node:sqlite` is still marked
  experimental; the warning is harmless.
- **"embedding backend … unreachable"** — start Ollama (`ollama serve` or the
  desktop app), or your `llama-server` for the `openai` backend. The existing
  index stays valid while it is down.
- **"index was built with … reindex required"** — the model or backend changed;
  run `code-rag index --full`. The background build does this automatically on
  the next call, and search resumes once it finishes.
- **First search in a new repo returns few/no results** — the index is building
  in the background; fall back to grep/read and retry shortly.

## Development

Zero runtime dependencies, so there is nothing to install:

```bash
node --test                                  # unit tests (chunker, store, embedder, provenance)
node evals/run.mjs evals/cases.example.json  # retrieval eval (needs a backend + index)
```

CI runs the tests on Linux, macOS and Windows across Node 22 and 24
(`.github/workflows/ci.yml`).

## License

MIT — see [LICENSE](LICENSE).
