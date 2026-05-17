import type { Snapshot } from '../types';

export function renderConcludePrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
): string {
  const outputFile = `${workdir}/act_output.json`;

  return `这是总结阶段。它覆盖同一次会话中任何要求你继续探索、运行更多命令、等待结果的先前指令。

## 立即停止
- 不要再运行任何命令、调用任何工具、检查任何内容、等待未完成的命令，或尝试获取额外信息。
- 仅基于本次会话中已经获得的信息作答。
- 此 JSON 是你的最终输出。输出后立即停止。

## 总结任务
对本次探索会话中发现的事实进行简要、客观的总结。描述发现、部分结果、遇到的错误，以及原始数据保存的文件路径。

## 原始探索方向
${directionDescription}

## 当前图谱
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## 输出格式
将结果写入 ${outputFile}。使用 write 工具写入。

\`\`\`json
{
  "title": "简短标题（≤10字）",
  "description": "本次探索的事实总结，包含原始数据的文件路径"
}
\`\`\`

title 必须是中文，不超过 10 个字。description 必须是中文。`;
}
