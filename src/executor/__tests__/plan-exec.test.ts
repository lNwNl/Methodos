import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createProject, insertNode, setProjectLastPlanAt } from '../../db/operations';
import { shouldTriggerPlan } from '../plan-exec';

vi.mock('../../config', () => ({
  config: {
    planMinIntervalMs: 5000,
  },
}));

function createTestDb() {
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
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );
  `);
  return sqlite;
}

describe('shouldTriggerPlan', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it('should trigger when last_plan_at is null (first time)', () => {
    const now = new Date().toISOString();
    const projectId = createProject(db, 'test', 'mock', 'mock:v1', now);

    expect(shouldTriggerPlan(db, projectId)).toBe(true);
  });

  it('should not trigger when project is not active', () => {
    const now = new Date().toISOString();
    const projectId = createProject(db, 'test', 'mock', 'mock:v1', now);
    db.prepare("UPDATE projects SET status = 'completed' WHERE id = ?").run(projectId);

    expect(shouldTriggerPlan(db, projectId)).toBe(false);
  });

  it('should not trigger when project does not exist', () => {
    expect(shouldTriggerPlan(db, 999)).toBe(false);
  });

  it('should trigger when new nodes exist and min interval passed', () => {
    const t1 = '2026-05-14T00:00:00.000Z';
    const t2 = '2026-05-14T00:01:00.000Z';
    vi.setSystemTime(new Date('2026-05-14T00:00:10.000Z'));

    const projectId = createProject(db, 'test', 'mock', 'mock:v1', t1);
    setProjectLastPlanAt(db, projectId, t1);
    insertNode(db, projectId, null, 'new finding', 'agent', null, t2);

    expect(shouldTriggerPlan(db, projectId, t1)).toBe(true);
  });

  it('should not trigger when min interval not passed', () => {
    const t1 = '2026-05-14T00:00:00.000Z';
    const t2 = '2026-05-14T00:01:00.000Z';
    vi.setSystemTime(new Date('2026-05-14T00:00:02.000Z'));

    const projectId = createProject(db, 'test', 'mock', 'mock:v1', t1);
    setProjectLastPlanAt(db, projectId, t1);
    insertNode(db, projectId, null, 'new finding', 'agent', null, t2);

    expect(shouldTriggerPlan(db, projectId, t1)).toBe(false);
  });

  it('should not trigger when no new nodes exist', () => {
    const t1 = '2026-05-14T00:00:00.000Z';
    vi.setSystemTime(new Date('2026-05-14T00:00:10.000Z'));

    const projectId = createProject(db, 'test', 'mock', 'mock:v1', t1);
    setProjectLastPlanAt(db, projectId, t1);

    expect(shouldTriggerPlan(db, projectId, t1)).toBe(false);
  });

  it('should trigger when lastPlanExecutedAt is not provided and new nodes exist', () => {
    const t1 = '2026-05-14T00:00:00.000Z';
    const t2 = '2026-05-14T00:01:00.000Z';

    const projectId = createProject(db, 'test', 'mock', 'mock:v1', t1);
    setProjectLastPlanAt(db, projectId, t1);
    insertNode(db, projectId, null, 'new finding', 'agent', null, t2);

    expect(shouldTriggerPlan(db, projectId)).toBe(true);
  });
});
