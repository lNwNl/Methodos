#!/usr/bin/env node
const fs = require('node:fs');

const mode = process.argv[2];   // "plan" or "act"
const file = process.argv[3];

if (!mode || !file) {
  process.stderr.write('Usage: validate-json plan|act <file.json>\n');
  process.exit(1);
}

let raw;
try { raw = fs.readFileSync(file, 'utf8'); } catch {
  process.stderr.write('FAIL: cannot read file\n');
  process.exit(1);
}

raw = raw.trim();
if (!raw) {
  process.stderr.write('FAIL: file is empty\n');
  process.exit(1);
}

// Try to extract JSON from markdown code fences
const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
if (fence) raw = fence[1].trim();

let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  const msg = e.message || String(e);
  process.stderr.write(`FAIL: JSON 格式错误 — ${msg}\n`);
  process.stderr.write(`请检查：括号是否匹配、字符串是否正确转义、是否有多余逗号\n`);
  process.exit(1);
}

if (typeof data !== 'object' || Array.isArray(data) || !data) {
  process.stderr.write('FAIL: JSON 根必须是对象，不能是数组、字符串或数字\n');
  process.exit(1);
}

if (mode === 'plan') {
  // edges field
  if (!('edges' in data)) {
    process.stderr.write('FAIL: 缺少 "edges" 字段 — 必须包含 edges 数组\n');
    process.exit(1);
  }
  if (!Array.isArray(data.edges)) {
    process.stderr.write('FAIL: "edges" 必须是数组\n');
    process.exit(1);
  }

  // complete field
  if (!('complete' in data)) {
    process.stderr.write('FAIL: 缺少 "complete" 字段 — 必须是 true 或 false\n');
    process.exit(1);
  }
  if (typeof data.complete !== 'boolean') {
    process.stderr.write('FAIL: "complete" 必须是 true 或 false\n');
    process.exit(1);
  }

  // Rule: complete=true → edges must be [], summary+evidence_node_ids required
  if (data.complete) {
    if (data.edges.length > 0) {
      process.stderr.write('FAIL: complete=true 时 edges 必须为空数组 []\n');
      process.exit(1);
    }
    if (!data.summary || typeof data.summary !== 'string') {
      process.stderr.write('FAIL: complete=true 时必须包含 "summary" 字段（字符串，说明判定完成的依据）\n');
      process.exit(1);
    }
    if (!data.evidence_node_ids || !Array.isArray(data.evidence_node_ids)) {
      process.stderr.write('FAIL: complete=true 时必须包含 "evidence_node_ids" 字段（数组，列出依据的 Node ID）\n');
      process.exit(1);
    }
  }

  // Rule: complete=false → summary and evidence_node_ids must NOT exist
  if (!data.complete) {
    if ('summary' in data) {
      process.stderr.write('FAIL: complete=false 时不应包含 "summary" 字段，请删除它\n');
      process.exit(1);
    }
    if ('evidence_node_ids' in data) {
      process.stderr.write('FAIL: complete=false 时不应包含 "evidence_node_ids" 字段，请删除它\n');
      process.exit(1);
    }
  }

  // Validate each edge
  for (let i = 0; i < data.edges.length; i++) {
    const e = data.edges[i];
    if (!e.from_node_ids || !Array.isArray(e.from_node_ids)) {
      process.stderr.write(`FAIL: edges[${i}].from_node_ids 必须是数组\n`);
      process.exit(1);
    }
    if (e.from_node_ids.length > 0) {
      for (const id of e.from_node_ids) {
        if (typeof id !== 'number') {
          process.stderr.write(`FAIL: edges[${i}].from_node_ids 中的元素必须是数字\n`);
          process.exit(1);
        }
      }
    }
    if (!e.direction_description || typeof e.direction_description !== 'string' || !e.direction_description.trim()) {
      process.stderr.write(`FAIL: edges[${i}].direction_description 缺失或为空\n`);
      process.exit(1);
    }
  }
}

if (mode === 'act') {
  if (!data.description || typeof data.description !== 'string' || !data.description.trim()) {
    process.stderr.write('FAIL: 缺少 "description" 字段 — 必须是非空字符串\n');
    process.exit(1);
  }
  if (data.description.length > 500) {
    process.stderr.write(`警告: description 超过 500 字符（当前 ${data.description.length}），建议精简\n`);
  }
}

process.stdout.write('OK\n');
process.exit(0);
