import { initDb, getRawDb } from '../db/connection';
import { createProject } from '../db/operations';
import { MockAgentDriver } from '../driver/mock';
import { createLoop } from './loop';
import type { PlanOutput } from '../driver/types';

initDb();
const db = getRawDb();

const driver = new MockAgentDriver();

// Demo scenario: 2-round plan → complete
driver.setScenario(1, [
  {
    edges: [
      { from_node_ids: [1], direction_description: '扫描目标开放端口和服务版本' },
      { from_node_ids: [1], direction_description: '枚举子域名和虚拟主机' },
    ],
    complete: false,
  },
  {
    edges: [],
    complete: true,
    summary: '已完成信息收集：发现 80/443 端口开放，Apache 2.4.49 存在 CVE-2021-41773',
    evidence_node_ids: [2, 3],
  },
]);

const now = new Date().toISOString();
const projectId = createProject(db, '帮我拿到 flag。https://hackme.com', 'mock', 'mock:v1', now);

console.log(`Project ${projectId} created with title: "帮我拿到 flag。https://hackme.com"`);
console.log('Starting executor loop...');

const { start } = createLoop(db, driver);
const stop = start();

let tickCount = 0;
const watcher = setInterval(() => {
  tickCount++;
  const project = db.prepare('SELECT status, summary FROM projects WHERE id = ?').get(projectId) as any;
  const nodeCount = (db.prepare('SELECT COUNT(*) as c FROM nodes WHERE project_id = ?').get(projectId) as any).c;
  const edgeCount = (db.prepare('SELECT COUNT(*) as c FROM edges WHERE project_id = ?').get(projectId) as any).c;

  console.log(`[${tickCount}s] Status: ${project.status} | Nodes: ${nodeCount} | Edges: ${edgeCount}`);

  if (project.status === 'completed') {
    console.log(`\nProject completed!`);
    console.log(`Summary: ${project.summary}`);
    stop();
    clearInterval(watcher);
    process.exit(0);
  }

  if (project.status === 'failed') {
    console.log(`\nProject failed.`);
    stop();
    clearInterval(watcher);
    process.exit(1);
  }

  if (tickCount > 30) {
    console.log(`\nTimeout after 30 seconds.`);
    stop();
    clearInterval(watcher);
    process.exit(1);
  }
}, 1000);

process.on('SIGINT', () => {
  stop();
  clearInterval(watcher);
  process.exit(0);
});
