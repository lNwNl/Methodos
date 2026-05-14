import { initDb, getRawDb } from '../db/connection';
import { MockAgentDriver } from '../driver/mock';
import { OpenCodeDriver } from '../driver/opencode';
import { createLoop } from './loop';
import { startServer } from '../api/server';

initDb();
const db = getRawDb();

const USE_DOCKER = process.argv.includes('--docker');

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

async function main() {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  await startServer(db, PORT);

  console.log('Starting executor loop...');
  const { start } = createLoop(db, driverFactory);
  const stop = start();

  console.log(`\n  Methodos ready: http://localhost:${PORT}`);
  console.log(`  Mode: ${USE_DOCKER ? 'Docker' : 'Mock'}`);
  console.log(`  Press Ctrl+C to stop\n`);

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    stop();
    process.exit(0);
  });
}

main();
