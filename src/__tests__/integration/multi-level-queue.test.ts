import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { shouldTriggerPlan } from '../../executor/plan-exec';
import { renderSnapshot } from '../../snapshot/render';
import { calculateEdgePriority } from '../../db/priority';
import {
  createProject,
  getProject,
  insertNode,
  insertEdges,
  claimEdge,
  writeActResult,
  updateEdgePriority,
  getEdge,
  updateProject,
  setProjectLastPlanAt,
} from '../../db/operations';
import { config } from '../../config';

function createTestDb(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
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
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return sqlite;
}

describe('Multi-level Feedback Queue Integration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  describe('Plan Trigger Logic', () => {
    it('should trigger plan when new nodes exist regardless of unresulted edges', () => {
      const originalMode = config.planTriggerMode;
      config.planTriggerMode = 'node_created';
      try {
        const now = new Date().toISOString();
        const projectId = createProject(db, 'test project', 'mock', 'mock:v1', now);

        // Set last_plan_at to a past time
        const pastTime = new Date(Date.now() - 10000).toISOString();
        setProjectLastPlanAt(db, projectId, pastTime);

        // Insert edges (creates unresulted edges)
        insertEdges(db, projectId, [
          { from_node_ids: [1], direction_description: 'scan ports' },
          { from_node_ids: [1], direction_description: 'enum subdomains' },
        ], now);

        // Verify unresulted edges exist
        const edge1 = getEdge(db, projectId, 1);
        expect(edge1).not.toBeNull();
        expect(edge1!.to_node_ids).toEqual([]);

        // Insert a new node (simulating agent work)
        const newTime = new Date(Date.now() + 1000).toISOString();
        insertNode(db, projectId, null, 'New finding from scan', 'agent', 1, newTime);

        // Should trigger plan because new nodes exist (node_created mode)
        const result = shouldTriggerPlan(db, projectId);
        expect(result).toBe(true);
      } finally {
        config.planTriggerMode = originalMode;
      }
    });

    it('should not trigger plan when no new nodes exist', () => {
      const now = new Date().toISOString();
      const projectId = createProject(db, 'test project', 'mock', 'mock:v1', now);

      // Set last_plan_at to current time
      setProjectLastPlanAt(db, projectId, now);

      // Insert edges but no new nodes after last_plan_at
      insertEdges(db, projectId, [
        { from_node_ids: [1], direction_description: 'scan ports' },
      ], now);

      // Should not trigger plan because no new nodes since last_plan_at
      const result = shouldTriggerPlan(db, projectId);
      expect(result).toBe(false);
    });

    it('should trigger plan for new project without last_plan_at', () => {
      const now = new Date().toISOString();
      const projectId = createProject(db, 'test project', 'mock', 'mock:v1', now);

      // New project has no last_plan_at
      const project = getProject(db, projectId);
      expect(project!.last_plan_at).toBeNull();

      // Should trigger plan
      const result = shouldTriggerPlan(db, projectId);
      expect(result).toBe(true);
    });

    it('should not trigger plan for inactive project', () => {
      const now = new Date().toISOString();
      const projectId = createProject(db, 'test project', 'mock', 'mock:v1', now);

      // Mark project as completed
      updateProject(db, projectId, { status: 'completed' }, now);

      // Should not trigger plan
      const result = shouldTriggerPlan(db, projectId);
      expect(result).toBe(false);
    });

    it('should respect planMinIntervalMs cooldown', () => {
      const now = new Date().toISOString();
      const projectId = createProject(db, 'test project', 'mock', 'mock:v1', now);

      // Set last_plan_at to now
      setProjectLastPlanAt(db, projectId, now);

      // Add new node
      const newTime = new Date(Date.now() + 100).toISOString();
      insertNode(db, projectId, null, 'New finding', 'agent', null, newTime);

      // Should not trigger if within cooldown period
      const lastExecTime = new Date().toISOString();
      const result = shouldTriggerPlan(db, projectId, lastExecTime);
      expect(result).toBe(false);
    });
  });

  describe('Snapshot Rendering', () => {
    it('should include all edges in plan snapshot', () => {
      const now = new Date().toISOString();
      const projectId = createProject(db, 'test project', 'mock', 'mock:v1', now);

      // Insert multiple edges with different states
      insertEdges(db, projectId, [
        { from_node_ids: [1], direction_description: 'edge 1' },
        { from_node_ids: [1], direction_description: 'edge 2' },
        { from_node_ids: [1], direction_description: 'edge 3' },
      ], now);

      // Complete one edge
      writeActResult(db, projectId, 1, null, 'result 1', 'agent', now);

      // Claim one edge
      claimEdge(db, projectId, 3, 30 * 60 * 1000, now);

      // Render plan snapshot
      const snapshot = renderSnapshot(db, projectId, {
        snapshotMaxNodes: 100,
        snapshotMaxEdges: 200,
      }, 'plan');

      // Plan snapshot should include ALL edges (completed, claimed, and pending)
      expect(snapshot.edges).toHaveLength(3);
      expect(snapshot.edges.map(e => e.id)).toContain(1); // completed
      expect(snapshot.edges.map(e => e.id)).toContain(2); // claimed
      expect(snapshot.edges.map(e => e.id)).toContain(3); // pending
    });

    it('should include only relevant edges in act snapshot', () => {
      const now = new Date().toISOString();
      const projectId = createProject(db, 'test project', 'mock', 'mock:v1', now);

      // Insert edges
      insertEdges(db, projectId, [
        { from_node_ids: [1], direction_description: 'edge 1' },
        { from_node_ids: [1], direction_description: 'edge 2' },
        { from_node_ids: [1], direction_description: 'edge 3' },
      ], now);

      // Complete edge 1
      writeActResult(db, projectId, 1, null, 'result 1', 'agent', now);

      // Render act snapshot (without claiming an edge)
      const snapshot = renderSnapshot(db, projectId, {
        snapshotMaxNodes: 100,
        snapshotMaxEdges: 200,
      }, 'act');

      // Act snapshot should only include completed edges
      expect(snapshot.edges).toHaveLength(1);
      expect(snapshot.edges[0].id).toBe(1);
    });

    it('should include claimed edge in act snapshot', () => {
      const now = new Date().toISOString();
      const projectId = createProject(db, 'test project', 'mock', 'mock:v1', now);

      // Insert edges
      insertEdges(db, projectId, [
        { from_node_ids: [1], direction_description: 'edge 1' },
        { from_node_ids: [1], direction_description: 'edge 2' },
      ], now);

      // Claim edge 2
      const claimed = claimEdge(db, projectId, 3, 30 * 60 * 1000, now);
      expect(claimed).not.toBeNull();

      // Render act snapshot with claimed edge
      const snapshot = renderSnapshot(db, projectId, {
        snapshotMaxNodes: 100,
        snapshotMaxEdges: 200,
      }, 'act', claimed!.id);

      // Should include the claimed edge
      expect(snapshot.edges.map(e => e.id)).toContain(claimed!.id);
    });
  });

  describe('Edge Priority and Selection', () => {
    it('should select highest priority edge for act', () => {
      const originalAlgorithm = config.schedulingAlgorithm;
      config.schedulingAlgorithm = 'priority';
      
      const now = new Date().toISOString();
      const projectId = createProject(db, 'test project', 'mock', 'mock:v1', now);

      // Insert edges
      const ids = insertEdges(db, projectId, [
        { from_node_ids: [1], direction_description: 'low priority' },
        { from_node_ids: [1], direction_description: 'high priority' },
        { from_node_ids: [1], direction_description: 'medium priority' },
      ], now);

      // Set different priorities
      updateEdgePriority(db, projectId, ids[0], 0.5);  // low
      updateEdgePriority(db, projectId, ids[1], 2.0);  // high
      updateEdgePriority(db, projectId, ids[2], 1.0);  // medium

      // Claim edges - should get highest priority first
      const claimed1 = claimEdge(db, projectId, 3, 30 * 60 * 1000, now);
      expect(claimed1).not.toBeNull();
      expect(claimed1!.id).toBe(ids[1]); // high priority

      const claimed2 = claimEdge(db, projectId, 3, 30 * 60 * 1000, now);
      expect(claimed2).not.toBeNull();
      expect(claimed2!.id).toBe(ids[2]); // medium priority

      const claimed3 = claimEdge(db, projectId, 3, 30 * 60 * 1000, now);
      expect(claimed3).not.toBeNull();
      expect(claimed3!.id).toBe(ids[0]); // low priority
      
      config.schedulingAlgorithm = originalAlgorithm;
    });

    it('should update priority after edge resolution', () => {
      const now = new Date().toISOString();
      const projectId = createProject(db, 'test project', 'mock', 'mock:v1', now);

      // Insert edge
      const ids = insertEdges(db, projectId, [
        { from_node_ids: [1], direction_description: 'test edge' },
      ], now);

      const edgeId = ids[0];

      // Initial priority
      const edgeBefore = getEdge(db, projectId, edgeId);
      expect(edgeBefore!.priority).toBe(1.0);

      // Calculate new priority after success
      const newPriority = calculateEdgePriority(
        {
          priority: edgeBefore!.priority,
          failureCount: edgeBefore!.failure_count,
          createdAt: edgeBefore!.created_at,
        },
        'success'
      );

      // Update priority
      updateEdgePriority(db, projectId, edgeId, newPriority);

      // Verify priority increased
      const edgeAfter = getEdge(db, projectId, edgeId);
      expect(edgeAfter!.priority).toBeGreaterThan(1.0);
    });

    it('should reduce priority after failure', () => {
      const now = new Date().toISOString();
      const projectId = createProject(db, 'test project', 'mock', 'mock:v1', now);

      // Insert edge
      const ids = insertEdges(db, projectId, [
        { from_node_ids: [1], direction_description: 'test edge' },
      ], now);

      const edgeId = ids[0];

      // Calculate new priority after failure
      const edge = getEdge(db, projectId, edgeId);
      const newPriority = calculateEdgePriority(
        {
          priority: edge!.priority,
          failureCount: edge!.failure_count,
          createdAt: edge!.created_at,
        },
        'failure'
      );

      // Update priority
      updateEdgePriority(db, projectId, edgeId, newPriority);

      // Verify priority decreased
      const edgeAfter = getEdge(db, projectId, edgeId);
      expect(edgeAfter!.priority).toBeLessThan(1.0);
    });
  });

  describe('Complete Workflow', () => {
    it('should handle full plan-act cycle', () => {
      const originalMode = config.planTriggerMode;
      config.planTriggerMode = 'node_created';
      try {
        const now = new Date().toISOString();
        const projectId = createProject(db, 'test project', 'mock', 'mock:v1', now);

        // 1. Initial state - should trigger plan
        expect(shouldTriggerPlan(db, projectId)).toBe(true);

        // 2. Plan creates edges
        const edgeIds = insertEdges(db, projectId, [
          { from_node_ids: [1], direction_description: 'scan ports' },
          { from_node_ids: [1], direction_description: 'enum subdomains' },
        ], now);
        setProjectLastPlanAt(db, projectId, now);

        // 3. Plan snapshot includes all edges
        const planSnapshot = renderSnapshot(db, projectId, {
          snapshotMaxNodes: 100,
          snapshotMaxEdges: 200,
        }, 'plan');
        expect(planSnapshot.edges).toHaveLength(2);

        // 4. Act selects highest priority edge
        const claimed = claimEdge(db, projectId, 3, 30 * 60 * 1000, now);
        expect(claimed).not.toBeNull();
        expect(claimed!.id).toBe(edgeIds[0]);

        // 5. Act snapshot includes only claimed edge
        const actSnapshot = renderSnapshot(db, projectId, {
          snapshotMaxNodes: 100,
          snapshotMaxEdges: 200,
        }, 'act', claimed!.id);
        expect(actSnapshot.edges).toHaveLength(1);
        expect(actSnapshot.edges[0].id).toBe(claimed!.id);

        // 6. Act completes successfully
        const resultTime = new Date(Date.now() + 1000).toISOString();
        writeActResult(db, projectId, claimed!.id, null, 'Found port 80 open', 'agent', resultTime);

        // 7. Priority updated after success
        const edgeAfter = getEdge(db, projectId, claimed!.id);
        const newPriority = calculateEdgePriority(
          {
            priority: edgeAfter!.priority,
            failureCount: edgeAfter!.failure_count,
            createdAt: edgeAfter!.created_at,
          },
          'success'
        );
        updateEdgePriority(db, projectId, claimed!.id, newPriority);

        // 8. Verify edge is completed
        const completedEdge = getEdge(db, projectId, claimed!.id);
        expect(completedEdge!.to_node_ids).toHaveLength(1);

        // 9. New node should trigger next plan (node_created mode)
        expect(shouldTriggerPlan(db, projectId)).toBe(true);
      } finally {
        config.planTriggerMode = originalMode;
      }
    });

    it('should handle edge failure and priority reduction', () => {
      const now = new Date().toISOString();
      const projectId = createProject(db, 'test project', 'mock', 'mock:v1', now);

      // Insert edge
      const edgeIds = insertEdges(db, projectId, [
        { from_node_ids: [1], direction_description: 'risky operation' },
      ], now);

      // Claim edge
      const claimed = claimEdge(db, projectId, 3, 30 * 60 * 1000, now);
      expect(claimed).not.toBeNull();

      // Simulate failure
      const failTime = new Date().toISOString();
      db.prepare(`
        UPDATE edges SET failure_count = failure_count + 1, claimed_at = NULL
        WHERE project_id = ? AND id = ?
      `).run(projectId, claimed!.id);

      // Calculate reduced priority
      const edge = getEdge(db, projectId, claimed!.id);
      const newPriority = calculateEdgePriority(
        {
          priority: edge!.priority,
          failureCount: edge!.failure_count,
          createdAt: edge!.created_at,
        },
        'failure'
      );
      updateEdgePriority(db, projectId, claimed!.id, newPriority);

      // Verify priority reduced
      const edgeAfter = getEdge(db, projectId, claimed!.id);
      expect(edgeAfter!.priority).toBeLessThan(1.0);
      expect(edgeAfter!.failure_count).toBe(1);
    });

    it('should maintain correct snapshot with mixed edge states', () => {
      const now = new Date().toISOString();
      const projectId = createProject(db, 'test project', 'mock', 'mock:v1', now);

      // Insert multiple edges
      insertEdges(db, projectId, [
        { from_node_ids: [1], direction_description: 'edge 1' },
        { from_node_ids: [1], direction_description: 'edge 2' },
        { from_node_ids: [1], direction_description: 'edge 3' },
        { from_node_ids: [1], direction_description: 'edge 4' },
      ], now);

      // Complete edge 1
      writeActResult(db, projectId, 1, null, 'result 1', 'agent', now);

      // Claim edge 2
      claimEdge(db, projectId, 3, 30 * 60 * 1000, now);

      // Update priority of edge 3
      updateEdgePriority(db, projectId, 3, 2.0);

      // Plan snapshot should have all edges
      const planSnapshot = renderSnapshot(db, projectId, {
        snapshotMaxNodes: 100,
        snapshotMaxEdges: 200,
      }, 'plan');
      expect(planSnapshot.edges).toHaveLength(4);

      // Act snapshot should have only completed edges
      const actSnapshot = renderSnapshot(db, projectId, {
        snapshotMaxNodes: 100,
        snapshotMaxEdges: 200,
      }, 'act');
      expect(actSnapshot.edges).toHaveLength(1);
      expect(actSnapshot.edges[0].id).toBe(1);
    });
  });
});
