import type { Snapshot } from '../types';

export function renderActPrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
  projectId: number,
  edgeId: number,
): string {
  return `你处于执行模式，可以使用 bash 等工具执行安全测试操作。

执行指定的探索方向，完成后用纯 JSON 报告结果。

## 背景
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## 你的探索任务
${directionDescription}

## 工作目录
${workdir}

## 执行规则
1. 使用工具（bash、web_fetch 等）执行探索
2. 将原始工具输出保存到工作目录下的文件中（如 result.txt, scan.xml）
3. 执行完成后，**必须**输出 JSON 总结

## 输出格式——只输出下面这个 JSON，不要其他内容
\`\`\`json
{
  "description": "客观结论摘要。包含关键发现和文件路径引用（如：完整扫描结果见 scan.txt）"
}
\`\`\`

## 重要约束
- ⚠️ 使用工具后**必须**输出 JSON——即使工具没返回预期结果，也要产出结论
- description 不超过 500 字符，详细数据放文件用路径引用
- 只输出 JSON 对象，不要加任何前缀、后缀、解释

project_id: ${projectId}
edge_id: ${edgeId}`;
}
