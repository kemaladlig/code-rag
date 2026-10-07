// SQLite store via Node's built-in node:sqlite. Vectors are stored as float32
// blobs and searched by brute-force cosine (pilot-sized index only).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './config.js';

export function open(file = DB_PATH) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  // Keep the index out of version control without editing the repo's own
  // .gitignore: a `*` ignore inside the directory ignores its whole contents.
  const ignore = path.join(dir, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
  const db = new DatabaseSync(file);
  // Several tool sessions may run their own MCP server against the same repo
  // index; wait briefly instead of failing when another is mid-write.
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS files (
    relpath TEXT PRIMARY KEY,
    file_hash TEXT NOT NULL,
    indexed_at REAL NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY,
    relpath TEXT NOT NULL,
    lang TEXT NOT NULL,
    symbol TEXT NOT NULL,
    start INTEGER NOT NULL,
    end INTEGER NOT NULL,
    chunk_hash TEXT NOT NULL,
    dim INTEGER NOT NULL,
    vec BLOB NOT NULL,
    text TEXT NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(relpath)');
  return db;
}

function pack(vec) {
  return new Uint8Array(new Float32Array(vec).buffer);
}

function unpack(blob) {
  const bytes = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
  return new Float32Array(bytes);
}

export function replaceFile(db, relpath, fileHash, chunks) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM chunks WHERE relpath = ?').run(relpath);
    const ins = db.prepare(
      'INSERT INTO chunks (relpath, lang, symbol, start, end, chunk_hash, dim, vec, text) VALUES (?,?,?,?,?,?,?,?,?)'
    );
    for (const c of chunks) {
      ins.run(relpath, c.lang, c.symbol, c.start, c.end, c.chunkHash, c.vec.length, pack(c.vec), c.text);
    }
    db.prepare(
      'INSERT INTO files (relpath, file_hash, indexed_at) VALUES (?,?,?) ' +
        'ON CONFLICT(relpath) DO UPDATE SET file_hash=excluded.file_hash, indexed_at=excluded.indexed_at'
    ).run(relpath, fileHash, Date.now() / 1000);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function fileHash(db, relpath) {
  const row = db.prepare('SELECT file_hash FROM files WHERE relpath = ?').get(relpath);
  return row ? row.file_hash : null;
}

export function deleteFile(db, relpath) {
  db.prepare('DELETE FROM chunks WHERE relpath = ?').run(relpath);
  db.prepare('DELETE FROM files WHERE relpath = ?').run(relpath);
}

export function search(db, queryVec, k, scope = null) {
  const q = Float32Array.from(queryVec);
  let sql = 'SELECT relpath, lang, symbol, start, end, vec, text FROM chunks';
  const params = [];
  // scope: null (all) | "src" | ["src","lib"] | { include?, exclude? }
  let include = scope;
  let exclude = null;
  if (scope && typeof scope === 'object' && !Array.isArray(scope)) {
    include = scope.include ?? null;
    exclude = scope.exclude ?? null;
  }
  // "." (whole-repo root) means "no filter"; empty strings are dropped.
  const norm = (v) =>
    (v == null ? [] : Array.isArray(v) ? v : [v])
      .map((p) => String(p).replace(/\/+$/, ''))
      .filter((p) => p && p !== '.');
  const inc = norm(include);
  const exc = norm(exclude);
  const clauses = [];
  if (inc.length) {
    clauses.push(`(${inc.map(() => '(relpath = ? OR relpath LIKE ?)').join(' OR ')})`);
    for (const p of inc) params.push(p, `${p}/%`);
  }
  if (exc.length) {
    clauses.push(`(${exc.map(() => '(relpath != ? AND relpath NOT LIKE ?)').join(' AND ')})`);
    for (const p of exc) params.push(p, `${p}/%`);
  }
  if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
  const scored = [];
  for (const row of db.prepare(sql).iterate(...params)) {
    const v = unpack(row.vec);
    let score = 0;
    for (let i = 0; i < q.length; i++) score += q[i] * v[i];
    scored.push({
      relpath: row.relpath,
      lang: row.lang,
      symbol: row.symbol,
      start: row.start,
      end: row.end,
      text: row.text,
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

export function status(db) {
  const files = db.prepare('SELECT COUNT(*) AS c FROM files').get().c;
  const chunks = db.prepare('SELECT COUNT(*) AS c FROM chunks').get().c;
  const lastIndexed = db.prepare('SELECT MAX(indexed_at) AS m FROM files').get().m;
  return { files, chunks, lastIndexed };
}
