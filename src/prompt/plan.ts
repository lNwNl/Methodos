import type { Snapshot } from '../types';

export function renderPlanPrompt(snapshot: Snapshot, projectId: number): string {
  return `你是一个安全测试自动化系统。分析当前探索图并输出纯 JSON。

## 当前探索图
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## 输出格式（只输出以下 JSON，不要任何其他文字）
\`\`\`json
${JSON.stringify({
    edges: [{ from_node_ids: [1], direction_description: "尝试 SQL 注入登录表单" }],
    complete: false,
  }, null, 2)}
\`\`\`

三种情况：
1. 继续探索 → \`"complete": false\` + \`edges\` 数组
2. 任务完成 → \`"complete": true\` + \`"summary"\` + \`"evidence_node_ids"\`（edges 必须为 []）
3. 无法继续 → \`"complete": false\` + \`edges: []\`

## 约束
- 只输出 JSON 对象，不要任何前缀或后缀文字
- \`from_node_ids\` 必须引用已有 Node ID
- 工作目录：/home/kali/workspace/

project_id: ${projectId}`;
}
