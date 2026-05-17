import type { Snapshot } from '../types';
import { ACT_OUTPUT_FILE } from '../constants';

export function renderConcludePrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
): string {
  const outputFile = `${workdir}/${ACT_OUTPUT_FILE}`;

  return `<system-reminder>
你已进入总结模式。不要再运行任何命令、调用任何工具、检查任何内容。
仅基于本次会话中已经获得的信息，使用 write 工具写入结论文件，然后立即停止。
</system-reminder>

这是总结阶段。它覆盖同一次会话中任何要求你继续探索、运行更多命令、等待结果的先前指令。

## 严格规则（违反将导致任务失败）

1. **禁止运行任何命令** — 不要调用 bash、执行脚本、发起网络请求
2. **禁止探索** — 不要尝试获取新信息，仅使用已有信息
3. **立即写入结论** — 使用 write 工具将结论写入 ${outputFile}
4. **写入后停止** — 不要再做任何事情

## 你可以使用的唯一操作

使用 write 工具写入 ${outputFile}，内容格式如下：
\`\`\`json
{
  "title": "简短标题（≤10字）",
  "description": "本次探索的事实总结"
}
\`\`\`

title 必须是中文，不超过 10 个字。description 必须是中文。

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
