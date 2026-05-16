import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { renderSnapshot } from './render';
import { createProject, insertEdges, writeActResult } from '../db/operations';

function createTestDb() {
  const sqlite = new Database(':memory:');
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
      priority REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );
  `);
  return sqlite;
}

describe('renderSnapshot', () => {
  let db: Database.Database;
  let projectId: number;
  const now = '2026-05-14T00:00:00.000Z';

  beforeEach(() => {
    db = createTestDb();
    projectId = createProject(db, 'test', 'mock', 'mock:v1', now);
  });

  it('renders a simple snapshot with one node', () => {
    const snap = renderSnapshot(db, projectId, { snapshotMaxNodes: 100, snapshotMaxEdges: 200 });
    expect(snap.nodes).toHaveLength(1);
    expect(snap.nodes[0].id).toBe(1);
    expect(snap.nodes[0].description).toBe('test');
    expect(snap.nodes[0].created_by).toBe('human');
    expect(snap.edges).toHaveLength(0);
  });

  it('includes completed edges and their nodes', () => {
    insertEdges(db, projectId, [{ from_node_ids: [1], direction_description: 'scan' }], now);
    writeActResult(db, projectId, 1, null, 'Port 80 open', 'agent', '2026-05-14T00:01:00.000Z');

    const snap = renderSnapshot(db, projectId, { snapshotMaxNodes: 100, snapshotMaxEdges: 200 });
    expect(snap.nodes).toHaveLength(2);
    expect(snap.edges).toHaveLength(1);
    expect(snap.edges[0].direction_description).toBe('scan');
    expect(snap.edges[0].to_node_ids).toEqual([2]);
  });

  it('filters out unresulted edges in act mode', () => {
    insertEdges(db, projectId, [{ from_node_ids: [1], direction_description: 'scan' }], now);
    writeActResult(db, projectId, 1, null, 'Port 80 open', 'agent', '2026-05-14T00:01:00.000Z');
    insertEdges(db, projectId, [{ from_node_ids: [2], direction_description: 'sql injection' }], '2026-05-14T00:02:00.000Z');
    insertEdges(db, projectId, [{ from_node_ids: [2], direction_description: 'dir enum' }], '2026-05-14T00:03:00.000Z');

    const snap = renderSnapshot(db, projectId, { snapshotMaxNodes: 100, snapshotMaxEdges: 200 }, 'act');
    expect(snap.edges).toHaveLength(1);
    expect(snap.edges[0].direction_description).toBe('scan');
  });

  it('preserves human nodes during truncation', () => {
    const times = Array.from({ length: 10 }, (_, i) =>
      `2026-05-14T00:0${i}:00.000Z`
    );

    for (let i = 0; i < 10; i++) {
      insertEdges(db, projectId, [{ from_node_ids: [i + 1], direction_description: `step ${i}` }], times[i]);
      writeActResult(db, projectId, i + 1, null, `result ${i}`, 'agent', times[i]);
    }

    const snap = renderSnapshot(db, projectId, { snapshotMaxNodes: 5, snapshotMaxEdges: 200 });

    const humanNode = snap.nodes.find(n => n.created_by === 'human');
    expect(humanNode).toBeDefined();

    expect(snap.nodes.length).toBeLessThanOrEqual(6);
  });

  it('includes all edges in plan mode', () => {
    insertEdges(db, projectId, [{ from_node_ids: [1], direction_description: 'scan' }], now);
    writeActResult(db, projectId, 1, null, 'Port 80 open', 'agent', '2026-05-14T00:01:00.000Z');
    insertEdges(db, projectId, [{ from_node_ids: [2], direction_description: 'sql injection' }], '2026-05-14T00:02:00.000Z');
    insertEdges(db, projectId, [{ from_node_ids: [2], direction_description: 'dir enum' }], '2026-05-14T00:03:00.000Z');

    const snap = renderSnapshot(db, projectId, { snapshotMaxNodes: 100, snapshotMaxEdges: 200 }, 'plan');
    expect(snap.edges).toHaveLength(3);
  });

  it('includes only completed edges in act mode without claimed edge', () => {
    insertEdges(db, projectId, [{ from_node_ids: [1], direction_description: 'scan' }], now);
    writeActResult(db, projectId, 1, null, 'Port 80 open', 'agent', '2026-05-14T00:01:00.000Z');
    insertEdges(db, projectId, [{ from_node_ids: [2], direction_description: 'sql injection' }], '2026-05-14T00:02:00.000Z');
    insertEdges(db, projectId, [{ from_node_ids: [2], direction_description: 'dir enum' }], '2026-05-14T00:03:00.000Z');

    const snap = renderSnapshot(db, projectId, { snapshotMaxNodes: 100, snapshotMaxEdges: 200 }, 'act');
    expect(snap.edges).toHaveLength(1);
    expect(snap.edges[0].direction_description).toBe('scan');
  });

  it('includes completed edges plus claimed edge in act mode', () => {
    insertEdges(db, projectId, [{ from_node_ids: [1], direction_description: 'scan' }], now);
    writeActResult(db, projectId, 1, null, 'Port 80 open', 'agent', '2026-05-14T00:01:00.000Z');
    const [edgeId] = insertEdges(db, projectId, [{ from_node_ids: [2], direction_description: 'sql injection' }], '2026-05-14T00:02:00.000Z');
    insertEdges(db, projectId, [{ from_node_ids: [2], direction_description: 'dir enum' }], '2026-05-14T00:03:00.000Z');

    const snap = renderSnapshot(db, projectId, { snapshotMaxNodes: 100, snapshotMaxEdges: 200 }, 'act', edgeId);
    expect(snap.edges).toHaveLength(2);
    expect(snap.edges.some(e => e.direction_description === 'scan')).toBe(true);
    expect(snap.edges.some(e => e.direction_description === 'sql injection')).toBe(true);
  });

  it('preserves source nodes for claimed edge in act mode during truncation', () => {
    insertEdges(db, projectId, [{ from_node_ids: [1], direction_description: 'scan' }], now);
    writeActResult(db, projectId, 1, null, 'Port 80 open', 'agent', '2026-05-14T00:01:00.000Z');
    const [edgeId] = insertEdges(db, projectId, [{ from_node_ids: [2], direction_description: 'sql injection' }], '2026-05-14T00:02:00.000Z');

    const snap = renderSnapshot(db, projectId, { snapshotMaxNodes: 2, snapshotMaxEdges: 200 }, 'act', edgeId);
    const nodeIds = snap.nodes.map(n => n.id);
    expect(nodeIds).toContain(2);
  });
});
