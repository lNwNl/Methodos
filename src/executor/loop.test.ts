import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MockAgentDriver } from '../driver/mock';
import { createProject, getProject } from '../db/operations';
import { createLoop } from './loop';

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', agent_type TEXT NOT NULL, image_tag TEXT NOT NULL, last_plan_at TEXT, plan_round INTEGER NOT NULL DEFAULT 0, failure_count INTEGER NOT NULL DEFAULT 0, summary TEXT, evidence_node_ids TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE nodes (project_id INTEGER NOT NULL, id INTEGER NOT NULL, title TEXT, description TEXT NOT NULL, created_by TEXT NOT NULL, edge_id INTEGER, created_at TEXT NOT NULL, PRIMARY KEY (project_id, id));
    CREATE TABLE edges (project_id INTEGER NOT NULL, id INTEGER NOT NULL, from_node_ids TEXT NOT NULL DEFAULT '[]', to_node_ids TEXT NOT NULL DEFAULT '[]', claimed_at TEXT, title TEXT, direction_description TEXT NOT NULL, failure_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, PRIMARY KEY (project_id, id));
  `);
  return sqlite;
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Executor Loop Integration', () => {
  it('completes a full Plan→Act→Plan→complete cycle', async () => {
    const db = createTestDb();
    const driver = new MockAgentDriver();

    driver.setScenario(1, [
      {
        edges: [
          { from_node_ids: [1], direction_description: '扫描端口' },
          { from_node_ids: [1], direction_description: '枚举子域名' },
        ],
        complete: false,
      },
      {
        edges: [],
        complete: true,
        summary: '任务完成',
        evidence_node_ids: [2, 3],
      },
    ]);

    const now = new Date().toISOString();
    const projectId = createProject(db, 'Test project', 'mock', 'mock:v1', now);

    const { start } = createLoop(db, () => driver);
    const stop = start();

    for (let i = 0; i < 30; i++) {
      await delay(500);
      const project = getProject(db, projectId);
      if (project && project.status === 'completed') break;
    }

    stop();

    const project = getProject(db, projectId);
    expect(project).not.toBeNull();
    expect(project!.status).toBe('completed');
    expect(project!.summary).toBe('任务完成');

    const nodes = db.prepare('SELECT * FROM nodes WHERE project_id = ? ORDER BY id').all(projectId) as any[];
    expect(nodes.length).toBeGreaterThanOrEqual(3);

    const edges = db.prepare('SELECT * FROM edges WHERE project_id = ? ORDER BY id').all(projectId) as any[];
    expect(edges.length).toBeGreaterThanOrEqual(2);

    for (const edge of edges) {
      const toIds = JSON.parse(edge.to_node_ids);
      expect(toIds.length).toBeGreaterThan(0);
    }
  }, 20000);
});
