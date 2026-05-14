import type { Snapshot } from '../types';

export function renderPlanPrompt(snapshot: Snapshot, projectId: number): string {
  return `# 任务：规划下一步探索方向

## 当前探索图
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## 你的任务
基于以上信息，判断下一步应该探索什么方向。

1. 如果认为任务已完成，返回 \`complete: true\`，附带 \`summary\` 和 \`evidence_node_ids\`
2. 如果认为还有探索方向，返回新的 Edge 列表
3. 如果无法继续且未完成，返回空 edges 数组（\`complete: false\`）

## 输出格式
请以 JSON 格式输出，严格遵循以下 Schema：

\`\`\`json
{
  "edges": [
    {
      "from_node_ids": [1, 3],
      "direction_description": "尝试 SQL 注入登录表单"
    }
  ],
  "complete": false
}
\`\`\`

## 约束
- 每条 Edge 的 \`from_node_ids\` 必须引用已有 Node 的 ID
- Node description 只放结论摘要和文件路径（不超过 500 字符）
- 大量原始数据写入文件，description 中用路径引用
- 仅当判定任务完成时才返回 \`complete: true\` 和 \`summary\`、\`evidence_node_ids\`
- \`complete: true\` 时 \`edges\` 必须为空数组
- \`complete: false\` 时不要返回 \`summary\` 和 \`evidence_node_ids\` 字段
- 当前工作目录根路径：/home/kali/workspace/

project_id: ${projectId}`;
}
