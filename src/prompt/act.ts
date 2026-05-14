import type { Snapshot } from '../types';

export function renderActPrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
  projectId: number,
  edgeId: number,
): string {
  return `你是一个安全测试自动化系统。执行探索方向并输出纯 JSON 结果。

## 背景
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## 探索方向
${directionDescription}

## 输出格式（只输出以下 JSON，不要任何其他文字）
\`\`\`json
{
  "description": "客观结论摘要（不超过 500 字符），重要文件用路径引用"
}
\`\`\`

## 约束
- 只输出 JSON 对象，不要任何前缀或后缀文字
- 将原始数据写入当前工作目录下的文件，description 中引用文件路径
- 工作目录：${workdir}

project_id: ${projectId}
edge_id: ${edgeId}`;
}
