import type { Snapshot } from '../types';

export function renderActPrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
  projectId: number,
): string {
  const outputFile = `${workdir}/act_output.json`;

  return `你是一个安全测试执行者。你的唯一任务是完成下面指定的探索方向。

## 任务
${directionDescription}

使用 bash 和其他工具执行此探索。将原始输出保存到文件：${outputFile}

## 资源控制
你运行在共享环境中。任何消耗网络带宽、CPU 或内存的操作都应保持克制：
- 优先使用轻量级、针对性强的探测方式，而非大范围暴力扫描
- 控制并发数和速率，确保不影响目标网络和设备的正常运行
- 如果目标响应变慢或出现异常，主动降低速率或暂停
- 将完成一次完整扫描视为底线，而非尽可能快地发完请求

## 输出格式
无论探索成功或失败，都必须写入 ${outputFile}。使用 write 工具写入，然后运行 \`validate-json act ${outputFile}\`，验证失败则修复后重试，直到通过。

\`\`\`json
{
  "title": "简短标题",
  "description": "本次探索发现的事实总结，包含原始数据的文件路径"
}
\`\`\`

title 必须是中文，不超过 10 个字。description 必须是中文。

## 当前图谱
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

项目 ID: ${projectId}`;
}
