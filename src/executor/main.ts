import { initDb, getRawDb } from '../db/connection';
import { createProject } from '../db/operations';
import { MockAgentDriver } from '../driver/mock';
import { OpenCodeDriver } from '../driver/opencode';
import { ensureContainer } from '../docker/manager';
import { createLoop } from './loop';
import { startServer } from '../api/server';

initDb();
const db = getRawDb();

const USE_DOCKER = process.argv.includes('--docker');

// Driver factory: returns right driver based on project's agent_type
const driverFactory = (projectId: number, agentType: string) => {
  if (agentType === 'mock') {
    const driver = new MockAgentDriver();
    driver.setScenario(projectId, [
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
    return driver;
  }
  if (agentType === 'opencode') {
    return new OpenCodeDriver(projectId);
  }
  return new MockAgentDriver();
};

const agentType = USE_DOCKER ? 'opencode' : 'mock';
const imageTag = USE_DOCKER ? 'test-agent:v1' : 'mock:v1';

const now = new Date().toISOString();
const projectId = createProject(db, '帮我拿到 flag。https://hackme.com', agentType, imageTag, now);

console.log(`Project ${projectId} created (agent: ${agentType})`);

async function main() {
  // Ensure container is running for Docker projects
  if (USE_DOCKER) {
    try {
      await ensureContainer(projectId, imageTag);
      console.log(`Container methodos-${projectId} ready`);
    } catch (err: any) {
      console.error(`Failed to start container: ${err.message}`);
      process.exit(1);
    }
  }

  // Start HTTP server + loop
  const PORT = parseInt(process.env.PORT || '3000', 10);
  await startServer(db, PORT);
  console.log('Starting executor loop...');
  const { start } = createLoop(db, driverFactory);
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

    if (tickCount > 60) {
      console.log(`\nTimeout after 60 seconds.`);
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
}

main();
