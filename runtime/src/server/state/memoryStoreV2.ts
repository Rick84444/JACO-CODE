import { createRequire } from 'node:module';
import path from 'path';
import fs from 'fs';

/**
 * Memory store.
 *
 * This module used to open the database at import time:
 *
 *     import Database from 'better-sqlite3';
 *     const db = new Database(DB_PATH);
 *
 * Both lines run on module load, and the import chain reaches here from
 * server.ts via seerService -> memoryIntegration. That made a native SQLite
 * binding a hard boot requirement for the whole runtime: if better-sqlite3 could
 * not load — no prebuilt binary for the running Node version, no compiler on the
 * host, an Android/Termux target the package publishes no prebuild for — the
 * server did not start degraded, it did not start at all, and the error named
 * SQLite rather than the subsystem that actually needed it.
 *
 * The connection is now opened lazily inside a guard. A host without a working
 * SQLite binding loses long-term memory and keeps everything else: the mission
 * runtime, hands-off, the A2A surface and the gate all boot. `memoryAvailable()`
 * reports the real state so nothing has to infer it, and every accessor degrades
 * to an empty result instead of throwing.
 *
 * The root follows the configured workspace, matching the rest of the runtime,
 * rather than whatever directory the process happened to start in.
 */

function dbDir(): string {
  const root = process.env.JACO_WORKSPACE_ROOT || process.env.JACO_RELEASE_ROOT || process.cwd();
  return path.join(root, '.jaco', 'db');
}

const runtimeRequire = createRequire(path.join(process.cwd(), 'package.json'));

let db: any = null;
let initAttempted = false;
let initError: string | null = null;
let sqliteBackend: 'node:sqlite' | 'better-sqlite3' | null = null;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function openDatabase(dbPath: string): any {
  let builtinError: unknown = null;
  try {
    const { DatabaseSync } = runtimeRequire('node:sqlite') as { DatabaseSync: new (filename: string) => any };
    const instance = new DatabaseSync(dbPath);
    instance.exec('PRAGMA journal_mode=WAL;');
    sqliteBackend = 'node:sqlite';
    return instance;
  } catch (error) {
    builtinError = error;
  }

  try {
    const Database = runtimeRequire('better-sqlite3');
    const instance = new Database(dbPath);
    instance.pragma('journal_mode = WAL');
    sqliteBackend = 'better-sqlite3';
    return instance;
  } catch (nativeError) {
    throw new Error(`node:sqlite unavailable: ${errorText(builtinError)}; better-sqlite3 unavailable: ${errorText(nativeError)}`);
  }
}

function getDb(): any {
  if (initAttempted) return db;
  initAttempted = true;
  try {
    const dir = dbDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = openDatabase(path.join(dir, 'memory.sqlite'));
    initError = null;
    return db;
  } catch (error) {
    initError = error instanceof Error ? error.message : String(error);
    console.warn(`[MemoryStore] SQLite unavailable — long-term memory is disabled for this run. Everything else continues. Reason: ${initError}`);
    db = null;
    return null;
  }
}

/** True when the durable memory store actually opened. */
export function memoryAvailable(): boolean {
  getDb();
  return db !== null;
}

/** The reason memory is unavailable, or null when it is working. */
export function memoryUnavailableReason(): string | null {
  getDb();
  return initError;
}

/** The concrete SQLite backend in use, or null when memory is unavailable. */
export function memoryBackend(): 'node:sqlite' | 'better-sqlite3' | null {
  getDb();
  return sqliteBackend;
}

export function initDb() {
  const db = getDb();
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      tags TEXT,
      embedding BLOB
    );
    CREATE TABLE IF NOT EXISTS edges (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT,
      PRIMARY KEY (source_id, target_id),
      FOREIGN KEY (source_id) REFERENCES memory_nodes(id),
      FOREIGN KEY (target_id) REFERENCES memory_nodes(id)
    );
  `);
}

export interface MemoryNode {
  id: string;
  type: 'concept' | 'fact' | 'code_snippet' | 'error_log' | 'action_result';
  content: string;
  timestamp?: string;
  tags?: string[];
  embedding?: Float32Array; // In a real vector DB this would be handled specially
}

export function insertMemoryNode(node: MemoryNode) {
  const db = getDb();
  if (!db) return;
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO memory_nodes (id, type, content, timestamp, tags, embedding)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    node.id,
    node.type,
    node.content,
    node.timestamp || new Date().toISOString(),
    node.tags ? JSON.stringify(node.tags) : null,
    node.embedding ? Buffer.from(node.embedding.buffer) : null
  );
}

export function getMemoryNode(id: string): MemoryNode | null {
  const db = getDb();
  if (!db) return null;
  const stmt = db.prepare('SELECT * FROM memory_nodes WHERE id = ?');
  const row = stmt.get(id) as any;
  if (!row) return null;
  
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    timestamp: row.timestamp,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    embedding: row.embedding ? new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4) : undefined
  };
}

export function searchMemoryNodes(query: string, limit: number = 10): MemoryNode[] {
  const db = getDb();
  if (!db) return [];
    const stmt = db.prepare(`
        SELECT * FROM memory_nodes 
        WHERE content LIKE ? OR tags LIKE ?
        ORDER BY timestamp DESC 
        LIMIT ?
    `);
    
    const searchTerm = "%" + query + "%";
    const rows = stmt.all(searchTerm, searchTerm, limit) as any[];
    
    return rows.map(row => ({
        id: row.id,
        type: row.type,
        content: row.content,
        timestamp: row.timestamp,
        tags: row.tags ? JSON.parse(row.tags) : undefined,
        embedding: row.embedding ? new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4) : undefined
    }));
}

export function linkNodes(sourceId: string, targetId: string, relation: string) {
  const db = getDb();
  if (!db) return;
    const stmt = db.prepare('INSERT OR IGNORE INTO edges (source_id, target_id, relation) VALUES (?, ?, ?)');
    stmt.run(sourceId, targetId, relation);
}

initDb();

export default getDb;
