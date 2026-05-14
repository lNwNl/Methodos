import * as path from 'node:path';

const managerPath = path.join(import.meta.dirname || __dirname, '../../src/docker/manager');
const execPath = path.join(import.meta.dirname || __dirname, '../../src/docker/exec');
const driverPath = path.join(import.meta.dirname || __dirname, '../../src/driver/opencode');

async function main() {
  const { ensureContainer, stopContainer, containerExists } = await import(managerPath);

  console.log('=== Test: ensureContainer ===');
  const container = await ensureContainer(1, 'localhost/test-agent:v1');
  console.log(`Container started: ${container.id}`);

  console.log('=== Test: containerExists ===');
  const exists = await containerExists(1);
  console.log(`Container exists: ${exists}`);

  if (!exists) {
    throw new Error('Container should exist after ensureContainer');
  }

  const { execInContainer, writeFileInContainer, ensureWorkdir } = await import(execPath);

  console.log('=== Test: writeFileInContainer ===');
  await writeFileInContainer(1, '/home/kali/workspace/test/plan_prompt.md',
    'project_id: 1\n\n规划下一步探索方向\n\n测试 prompt。');

  console.log('=== Test: execInContainer — plan mode ===');
  const planResult = await execInContainer(1, [
    'node', '/usr/local/bin/opencode', '-p', '/home/kali/workspace/test/plan_prompt.md'
  ], { workdir: '/home/kali/workspace/test', timeout: 15000 });
  console.log(`Plan stdout (${planResult.stdout.length} bytes)`);
  console.log(`Plan stderr: ${planResult.stderr}`);

  console.log('=== Test: OpenCodeDriver.executePlan ===');
  const { OpenCodeDriver } = await import(driverPath);
  const driver = new OpenCodeDriver(1);
  const planOutput = await driver.executePlan({
    prompt: 'project_id: 1\n\n规划下一步探索方向',
    workdir: '/home/kali/workspace/plan_test/',
    timeout: 15000,
  });
  console.log(`Plan complete: ${planOutput.complete}`);
  console.log(`Plan edges: ${planOutput.edges.length}`);
  if (planOutput.edges.length > 0) {
    console.log(`First edge: ${planOutput.edges[0].direction_description}`);
  }

  console.log('=== Test: OpenCodeDriver.executeAct ===');
  const actResult = await driver.executeAct({
    prompt: 'project_id: 1\nedge_id: 42\n\n执行探索方向：扫描端口',
    workdir: '/home/kali/workspace/act_test/',
    timeout: 15000,
  });
  console.log(`Act sessionId: ${actResult.sessionId}`);
  console.log(`Act output: ${actResult.output.description}`);

  console.log('=== Test: OpenCodeDriver.conclude ===');
  const concludeOutput = await driver.conclude({
    sessionId: actResult.sessionId,
    prompt: 'project_id: 1\n超时了，输出总结',
    workdir: '/home/kali/workspace/conclude_test/',
    timeout: 15000,
  });
  console.log(`Conclude output: ${concludeOutput.description}`);

  console.log('=== Test: stopContainer ===');
  await stopContainer(1);
  console.log('Container stopped');

  console.log('\n=== ALL TESTS PASSED ===');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
