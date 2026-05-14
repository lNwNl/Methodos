import type { Snapshot } from '../types';

export function renderActPrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
  projectId: number,
  edgeId: number,
): string {
  return `# 任务：执行探索方向

## 当前探索图
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## 你的探索方向
${directionDescription}

## 你的任务
沿上述方向执行探索，产出客观结论。

## 工作目录
${workdir}

## 输出格式
请以 JSON 格式输出，严格遵循以下 Schema：

\`\`\`json
{
  "description": "探索结论摘要"
}
\`\`\`

## 约束
- description 只放结论摘要和文件路径（不超过 500 字符）
- 大量原始数据写入文件（当前工作目录下），description 中用路径引用

project_id: ${projectId}
edge_id: ${edgeId}`;
}
