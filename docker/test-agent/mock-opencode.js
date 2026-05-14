#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const promptIndex = process.argv.indexOf('-p');
const promptFile = promptIndex !== -1 ? process.argv[promptIndex + 1] : process.argv[2];
const sessionId = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

if (!promptFile) {
  process.stderr.write('Usage: opencode run -p <prompt.md>\n');
  process.exit(1);
}

const prompt = fs.readFileSync(promptFile, 'utf-8');

const projectMatch = prompt.match(/project_id:\s*(\d+)/);
const edgeMatch = prompt.match(/edge_id:\s*(\d+)/);

process.stdout.write(JSON.stringify({
  type: 'step_start',
  sessionID: sessionId,
  timestamp: new Date().toISOString(),
}) + '\n');

if (prompt.includes('规划下一步探索方向')) {
  // Parse the snapshot JSON to count agent nodes
  const snapMatch = prompt.match(/```json\n([\s\S]*?)\n```/);
  let agentNodeCount = 0;
  if (snapMatch) {
    try {
      const snap = JSON.parse(snapMatch[1]);
      agentNodeCount = (snap.nodes || []).filter(n => n.created_by === 'agent').length;
    } catch {}
  }

  if (agentNodeCount >= 2) {
    // Enough agent findings → complete
    const nodeIds = [2, 3];
    process.stdout.write(JSON.stringify({
      edges: [],
      complete: true,
      summary: '任务完成：已收集足够信息，目标环境已完全探测',
      evidence_node_ids: nodeIds.slice(0, agentNodeCount),
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

process.stdout.write(JSON.stringify({
  type: 'step_finish',
  sessionID: sessionId,
  timestamp: new Date().toISOString(),
}) + '\n');
