import Database from 'better-sqlite3';

export function createTestDb(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(`
    CREATE TABLE projects (
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
      plan_started_at TEXT,
      plan_completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE nodes (
      project_id INTEGER NOT NULL,
      id INTEGER NOT NULL,
      title TEXT,
      description TEXT NOT NULL,
      created_by TEXT NOT NULL,
      edge_id INTEGER,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );
    CREATE TABLE edges (
      project_id INTEGER NOT NULL,
      id INTEGER NOT NULL,
      from_node_ids TEXT NOT NULL DEFAULT '[]',
      to_node_ids TEXT NOT NULL DEFAULT '[]',
      claimed_at TEXT,
      title TEXT,
      direction_description TEXT NOT NULL,
      failure_count INTEGER NOT NULL DEFAULT 0,
      priority REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );
  `);
  return sqlite;
}
