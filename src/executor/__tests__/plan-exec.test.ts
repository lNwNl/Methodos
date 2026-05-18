import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createProject, insertEdges, insertNode, setProjectLastPlanAt, writeActResult } from '../../db/operations';
import { createTestDb } from '../../db/test-utils';
import { shouldTriggerPlan } from '../plan-exec';
import { config } from '../../config';

vi.mock('../../config', () => ({
  config: {
    planMinIntervalMs: 5000,
    planTriggerMode: 'node_created',
  },
}));

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

describe('shouldTriggerPlan (edge_drain mode)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.useFakeTimers();
    (config as any).planTriggerMode = 'edge_drain';
    return () => {
      vi.useRealTimers();
      (config as any).planTriggerMode = 'node_created';
    };
  });

  it('should not trigger when unresulted edges exist', () => {
    const t1 = '2026-05-14T00:00:00.000Z';
    vi.setSystemTime(new Date('2026-05-14T00:00:10.000Z'));

    const projectId = createProject(db, 'test', 'mock', 'mock:v1', t1);
    setProjectLastPlanAt(db, projectId, t1);
    insertEdges(db, projectId, [{ from_node_ids: [1], direction_description: 'do something' }], t1);

    expect(shouldTriggerPlan(db, projectId, t1)).toBe(false);
  });

  it('should trigger when all edges are resulted', () => {
    const t1 = '2026-05-14T00:00:00.000Z';
    vi.setSystemTime(new Date('2026-05-14T00:00:10.000Z'));

    const projectId = createProject(db, 'test', 'mock', 'mock:v1', t1);
    setProjectLastPlanAt(db, projectId, t1);
    const edgeIds = insertEdges(db, projectId, [{ from_node_ids: [1], direction_description: 'do something' }], t1);
    writeActResult(db, projectId, edgeIds[0], null, 'result', 'agent', t1);

    expect(shouldTriggerPlan(db, projectId, t1)).toBe(true);
  });

  it('should not trigger when only some edges are resulted', () => {
    const t1 = '2026-05-14T00:00:00.000Z';
    vi.setSystemTime(new Date('2026-05-14T00:00:10.000Z'));

    const projectId = createProject(db, 'test', 'mock', 'mock:v1', t1);
    setProjectLastPlanAt(db, projectId, t1);
    const edgeIds = insertEdges(db, projectId, [
      { from_node_ids: [1], direction_description: 'task A' },
      { from_node_ids: [1], direction_description: 'task B' },
    ], t1);
    writeActResult(db, projectId, edgeIds[0], null, 'result A', 'agent', t1);

    expect(shouldTriggerPlan(db, projectId, t1)).toBe(false);
  });

  it('should trigger when new nodes exist but all edges are drained', () => {
    const t1 = '2026-05-14T00:00:00.000Z';
    vi.setSystemTime(new Date('2026-05-14T00:00:10.000Z'));

    const projectId = createProject(db, 'test', 'mock', 'mock:v1', t1);
    setProjectLastPlanAt(db, projectId, t1);
    insertEdges(db, projectId, [{ from_node_ids: [1], direction_description: 'task' }], t1);
    insertNode(db, projectId, null, 'human push', 'human', null, t1);

    // Edge still unresulted → should not trigger despite new node
    expect(shouldTriggerPlan(db, projectId, t1)).toBe(false);
  });

  it('should trigger first time even with edge_drain mode', () => {
    const t1 = '2026-05-14T00:00:00.000Z';
    const projectId = createProject(db, 'test', 'mock', 'mock:v1', t1);

    // last_plan_at is null → always triggers
    expect(shouldTriggerPlan(db, projectId)).toBe(true);
  });
});
