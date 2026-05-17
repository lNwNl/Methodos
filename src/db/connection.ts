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

export function closeDb() {
  if (dbInstance) {
    const sqlite = (dbInstance as any).$client as Database.Database;
    sqlite.close();
    dbInstance = null;
  }
}

export function initDb() {
  const sqlite = getRawDb();

  // Safety: ensure settings table exists even if db:push hasn't been run
  sqlite.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`);

  const existing = sqlite.prepare('SELECT COUNT(*) as count FROM settings').get() as { count: number };
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
    const insert = sqlite.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
    const txn = sqlite.transaction(() => {
      for (const [k, v] of Object.entries(defaults)) {
        insert.run(k, v, now);
      }
    });
    txn();
  }

  return getDb();
}
