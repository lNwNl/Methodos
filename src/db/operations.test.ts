import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  createProject,
  getProject,
  getActiveProjects,
  nextNodeId,
  nextEdgeId,
  insertNode,
  insertEdges,
  claimEdge,
  writeActResult,
  handleActFailure,
  hasUnresultedEdges,
  hasNewNodesSince,
  getSnapshotData,
} from './operations';

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

describe('operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('creates a project with first node', () => {
    const now = new Date().toISOString();
    const projectId = createProject(db, 'test project', 'mock', 'mock:v1', now);
    expect(projectId).toBe(1);

    const project = getProject(db, projectId);
    expect(project).not.toBeNull();
    expect(project!.title).toBe('test project');
    expect(project!.status).toBe('active');

    const nodes = db.prepare('SELECT * FROM nodes WHERE project_id = ?').all(projectId) as any[];
    expect(nodes).toHaveLength(1);
    expect(nodes[0].description).toBe('test project');
    expect(nodes[0].created_by).toBe('human');
  });

  it('inserts edges and claims one atomically', () => {
    const now = new Date().toISOString();
    const projectId = createProject(db, 'test', 'mock', 'mock:v1', now);

    insertEdges(db, projectId, [
      { from_node_ids: [1], direction_description: 'scan ports' },
      { from_node_ids: [1], direction_description: 'enum subdomains' },
    ], now);

    const claimed = claimEdge(db, projectId, 3, 30 * 60 * 1000, now);
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(1);
    expect(claimed!.claimed_at).not.toBeNull();

    const claimed2 = claimEdge(db, projectId, 3, 30 * 60 * 1000, now);
    expect(claimed2).not.toBeNull();
    expect(claimed2!.id).toBe(2);

    const claimed3 = claimEdge(db, projectId, 3, 30 * 60 * 1000, now);
    expect(claimed3).toBeNull();
  });

  it('writes act result atomically', () => {
    const now = new Date().toISOString();
    const projectId = createProject(db, 'test', 'mock', 'mock:v1', now);
    insertEdges(db, projectId, [
      { from_node_ids: [1], direction_description: 'scan' },
    ], now);

    writeActResult(db, projectId, 1, null, 'Found port 80 open', 'agent', now);

    const nodes = db.prepare(
      'SELECT * FROM nodes WHERE project_id = ? AND created_by = ?'
    ).all(projectId, 'agent') as any[];
    expect(nodes).toHaveLength(1);
    expect(nodes[0].description).toBe('Found port 80 open');

    const edge = db.prepare(
      'SELECT * FROM edges WHERE project_id = ? AND id = ?'
    ).get(projectId, 1) as any;
    expect(JSON.parse(edge.to_node_ids)).toEqual([2]);
  });

  it('handles act failure and creates system node at threshold', () => {
    const now = new Date().toISOString();
    const projectId = createProject(db, 'test', 'mock', 'mock:v1', now);
    insertEdges(db, projectId, [
      { from_node_ids: [1], direction_description: 'scan' },
    ], now);

    handleActFailure(db, projectId, 1, 3, now);
    let edge = db.prepare('SELECT * FROM edges WHERE project_id = ? AND id = ?').get(projectId, 1) as any;
    expect(edge.failure_count).toBe(1);
    expect(edge.claimed_at).toBeNull();
    expect(edge.to_node_ids).toBe('[]');

    handleActFailure(db, projectId, 1, 3, now);
    edge = db.prepare('SELECT * FROM edges WHERE project_id = ? AND id = ?').get(projectId, 1) as any;
    expect(edge.failure_count).toBe(2);

    handleActFailure(db, projectId, 1, 3, now);
    edge = db.prepare('SELECT * FROM edges WHERE project_id = ? AND id = ?').get(projectId, 1) as any;
    expect(edge.failure_count).toBe(3);
    const toIds = JSON.parse(edge.to_node_ids);
    expect(toIds).toHaveLength(1);

    const sysNode = db.prepare(
      'SELECT * FROM nodes WHERE project_id = ? AND id = ?'
    ).get(projectId, toIds[0]) as any;
    expect(sysNode.created_by).toBe('system');
  });

  it('detects unresulted edges', () => {
    const now = new Date().toISOString();
    const projectId = createProject(db, 'test', 'mock', 'mock:v1', now);
    expect(hasUnresultedEdges(db, projectId)).toBe(false);

    insertEdges(db, projectId, [
      { from_node_ids: [1], direction_description: 'scan' },
    ], now);
    expect(hasUnresultedEdges(db, projectId)).toBe(true);

    writeActResult(db, projectId, 1, null, 'result', 'agent', now);
    expect(hasUnresultedEdges(db, projectId)).toBe(false);
  });

  it('detects new nodes since timestamp', () => {
    const t1 = '2026-05-14T00:00:00.000Z';
    const t2 = '2026-05-14T00:01:00.000Z';

    const projectId = createProject(db, 'test', 'mock', 'mock:v1', t1);

    expect(hasNewNodesSince(db, projectId, t1)).toBe(false);

    insertNode(db, projectId, null, 'new finding', 'agent', null, t2);
    expect(hasNewNodesSince(db, projectId, t1)).toBe(true);
  });
});
