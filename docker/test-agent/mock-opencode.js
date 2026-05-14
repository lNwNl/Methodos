#!/usr/bin/env node
const fs = require('node:fs');

const args = process.argv.slice(2);
const sessionId = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Handle simple flags
if (args[0] === '--version' || args[0] === '-v') {
  process.stdout.write('1.14.50\n');
  process.exit(0);
}
if (args[0] === '--help' || args[0] === '-h') {
  process.stdout.write('OpenCode CLI (mock)\nUsage: opencode run [options] [message]\n');
  process.exit(0);
}

// Subcommand dispatch
const sub = args[0];
if (sub !== 'run') {
  process.stderr.write(`Unknown command: ${sub}\n`);
  process.exit(1);
}

// Parse: opencode run --format json --dir <workdir> -f <prompt.md> [message]
const runArgs = args.slice(1);
const fIndex = runArgs.indexOf('-f');
const promptFile = fIndex !== -1 ? runArgs[fIndex + 1] : null;

if (!promptFile) {
  process.stderr.write('Usage: opencode run -f <prompt.md>\n');
  process.exit(1);
}

let prompt;
try {
  prompt = fs.readFileSync(promptFile, 'utf-8');
} catch (e) {
  process.stderr.write(`Cannot read prompt: ${e.message}\n`);
  process.exit(1);
}

const projectMatch = prompt.match(/project_id:\s*(\d+)/);
const edgeMatch = prompt.match(/edge_id:\s*(\d+)/);

// Output step_start event (opencode format)
process.stdout.write(JSON.stringify({
  type: 'step_start',
  sessionID: sessionId,
  timestamp: new Date().toISOString(),
}) + '\n');

// Determine response by prompt content
if (prompt.includes('规划下一步探索方向')) {
  // Parse snapshot to count agent nodes
  const snapMatch = prompt.match(/```json\n([\s\S]*?)\n```/);
  let agentNodeCount = 0;
  if (snapMatch) {
    try {
      const snap = JSON.parse(snapMatch[1]);
      agentNodeCount = (snap.nodes || []).filter(n => n.created_by === 'agent').length;
    } catch {}
  }

  if (agentNodeCount >= 2) {
    process.stdout.write(JSON.stringify({
      edges: [],
      complete: true,
      summary: '任务完成：已收集足够信息，目标环境已完全探测',
      evidence_node_ids: [2, 3],
    }) + '\n');
  } else {
    process.stdout.write(JSON.stringify({
      edges: [
        { from_node_ids: [1], direction_description: '扫描目标开放端口和服务版本' },
        { from_node_ids: [1], direction_description: '枚举子域名和虚拟主机' },
      ],
      complete: false,
    }) + '\n');
  }
} else if (prompt.includes('执行探索方向')) {
  process.stdout.write(JSON.stringify({
    description: `探索结果 [Edge ${edgeMatch ? edgeMatch[1] : '?'}]: 发现端口 80/443 开放，Apache 2.4.49`,
  }) + '\n');
} else {
  process.stdout.write(JSON.stringify({
    description: '超时前部分结果：已收集到部分端口信息',
  }) + '\n');
}

// Output step_finish event
process.stdout.write(JSON.stringify({
  type: 'step_finish',
  sessionID: sessionId,
  timestamp: new Date().toISOString(),
}) + '\n');
