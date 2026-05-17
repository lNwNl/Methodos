import Database from 'better-sqlite3';
import { config } from '../config';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let sqliteInstance: Database.Database | null = null;

export function getRawDb(): Database.Database {
  if (sqliteInstance) return sqliteInstance;

  const dir = dirname(config.databasePath);
  mkdirSync(dir, { recursive: true });

  sqliteInstance = new Database(config.databasePath);
  sqliteInstance.pragma('journal_mode = WAL');
  sqliteInstance.pragma('foreign_keys = ON');
  return sqliteInstance;
}

export function closeDb() {
  if (sqliteInstance) {
    sqliteInstance.close();
    sqliteInstance = null;
  }
}

export function initDb() {
  const db = getRawDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      agent_type TEXT NOT NULL,
      image_tag TEXT NOT NULL,
      last_plan_at TEXT,
      plan_round INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      evidence_node_ids TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nodes (
      project_id INTEGER NOT NULL,
      id INTEGER NOT NULL,
      title TEXT,
      description TEXT NOT NULL,
      created_by TEXT NOT NULL,
      edge_id INTEGER,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );

    CREATE TABLE IF NOT EXISTS edges (
      project_id INTEGER NOT NULL,
      id INTEGER NOT NULL,
      from_node_ids TEXT NOT NULL,
      to_node_ids TEXT NOT NULL DEFAULT '[]',
      claimed_at TEXT,
      title TEXT,
      direction_description TEXT NOT NULL,
      failure_count INTEGER NOT NULL DEFAULT 0,
      priority REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      format TEXT NOT NULL DEFAULT 'md',
      file_path TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
  `);

  // Migration: add plan timing columns if missing
  try { db.exec(`ALTER TABLE projects ADD COLUMN plan_started_at TEXT`); } catch {}
  try { db.exec(`ALTER TABLE projects ADD COLUMN plan_completed_at TEXT`); } catch {}

  const existing = db.prepare('SELECT COUNT(*) as count FROM settings').get() as { count: number };
  if (existing.count === 0) {
    const now = new Date().toISOString();
    const defaults: Record<string, string> = {
      actTimeoutMs: '600000',
      planTimeoutMs: '600000',
      claimedExpiryMs: '1800000',
      tickIntervalMs: '1000',
      maxFailures: '3',
      maxActConcurrency: '3',
      snapshotMaxNodes: '100',
      snapshotMaxEdges: '200',
      planMinIntervalMs: '5000',
      priorityBoostSuccess: '120',
      priorityPenaltyFailure: '90',
      priorityDecayRateHourly: '1',
    };
    const insert = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
    const txn = db.transaction(() => {
      for (const [k, v] of Object.entries(defaults)) {
        insert.run(k, v, now);
      }
    });
    txn();
  }

  return db;
}
