import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { config } from '../config';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let dbInstance: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (dbInstance) return dbInstance;

  const dir = dirname(config.databasePath);
  mkdirSync(dir, { recursive: true });

  const sqlite = new Database(config.databasePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  dbInstance = drizzle(sqlite, { schema });
  return dbInstance;
}

export function getRawDb(): Database.Database {
  const db = getDb();
  return (db as any).$client as Database.Database;
}

export function initDb() {
  const sqlite = getRawDb();

  sqlite.exec(`
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
      description TEXT NOT NULL,
      created_by TEXT NOT NULL,
      edge_id INTEGER,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );

    CREATE TABLE IF NOT EXISTS edges (
      project_id INTEGER NOT NULL,
      id INTEGER NOT NULL,
      from_node_ids TEXT NOT NULL DEFAULT '[]',
      to_node_ids TEXT NOT NULL DEFAULT '[]',
      claimed_at TEXT,
      direction_description TEXT NOT NULL,
      failure_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );
  `);

  return getDb();
}
