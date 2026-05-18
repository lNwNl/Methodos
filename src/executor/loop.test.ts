import { describe, it, expect } from 'vitest';
import { MockAgentDriver } from '../driver/mock';
import { createProject, getProject } from '../db/operations';
import { createTestDb } from '../db/test-utils';
import { createLoop } from './loop';

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Executor Loop Integration', () => {
  it('completes a full Plan→Act→Plan→complete cycle', async () => {
    const db = createTestDb();
    const driver = new MockAgentDriver(1);

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
