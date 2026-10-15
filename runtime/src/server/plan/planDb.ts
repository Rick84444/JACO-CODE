import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'node:module';
import { Plan } from './planTree.js';

const DB_DIR = path.join(process.cwd(), '.jaco', 'queue');
const DB_PATH = path.join(DB_DIR, 'jobs.db');
const JSON_BACKUP_PATH = path.join(DB_DIR, 'plans_db.json');

// Absolute createRequire base works in both source ESM and the bundled CJS runtime.
// Do not use import.meta.url here: esbuild intentionally empties import.meta in CJS output.
const req = createRequire(path.join(process.cwd(), 'package.json'));

function openPlanDatabase(dbPath: string): any {
  try {
    const { DatabaseSync } = req('node:sqlite') as { DatabaseSync: new (filename: string) => any };
    const instance = new DatabaseSync(dbPath);
    instance.exec('PRAGMA journal_mode=WAL;');
    return instance;
  } catch {
    const Database = req('better-sqlite3');
    const instance = new Database(dbPath);
    instance.pragma('journal_mode = WAL');
    return instance;
  }
}

let sqliteDb: any = null;
let useSqlite = false;
let isInitAttempted = false;

function initDb(): void {
  if (isInitAttempted) return;
  isInitAttempted = true;
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    sqliteDb = openPlanDatabase(DB_PATH);
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
    useSqlite = true;
  } catch {
    useSqlite = false;
  }
}

const plansMap = new Map<string, Plan>();

function ensureJsonStorage(): void {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (fs.existsSync(JSON_BACKUP_PATH)) {
    try {
      const raw = fs.readFileSync(JSON_BACKUP_PATH, 'utf-8');
      if (raw.trim()) {
        const list: Plan[] = JSON.parse(raw);
        for (const p of list) {
          plansMap.set(p.id, p);
        }
      }
    } catch (err) {
      console.error('[PlanDb] JSON init error:', err);
    }
  }
}

function persistJson(): void {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    const list = Array.from(plansMap.values());
    fs.writeFileSync(JSON_BACKUP_PATH, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('[PlanDb] JSON persist error:', err);
  }
}

export function savePlan(plan: Plan): void {
  initDb();
  if (useSqlite && sqliteDb) {
    sqliteDb
      .prepare(
        `INSERT INTO plans (id, data, updatedAt) VALUES (@id, @data, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET data = @data, updatedAt = @updatedAt`
      )
      .run({ id: plan.id, data: JSON.stringify(plan), updatedAt: plan.updatedAt });
  } else {
    ensureJsonStorage();
    plansMap.set(plan.id, plan);
    persistJson();
  }
}

export function loadPlan(id: string): Plan | null {
  initDb();
  if (useSqlite && sqliteDb) {
    const row = sqliteDb.prepare(`SELECT data FROM plans WHERE id = ?`).get(id) as any;
    return row ? JSON.parse(row.data) : null;
  } else {
    ensureJsonStorage();
    return plansMap.get(id) || null;
  }
}

export function listActivePlans(): Plan[] {
  initDb();
  if (useSqlite && sqliteDb) {
    const rows = sqliteDb.prepare(`SELECT data FROM plans`).all() as any[];
    return rows.map((r) => JSON.parse(r.data)).filter((p: Plan) => p.status === 'active');
  } else {
    ensureJsonStorage();
    return Array.from(plansMap.values()).filter((p: Plan) => p.status === 'active');
  }
}

export function createPlan(goalDescription: string): Plan {
  const plan: Plan = {
    id: crypto.randomUUID(),
    goalDescription,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
    subgoals: [],
    consecutiveFailures: 0,
  };
  savePlan(plan);
  return plan;
}

