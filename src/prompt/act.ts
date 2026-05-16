import type { Snapshot } from '../types';

export function renderActPrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
): string {
  const outputFile = `${workdir}/act_output.json`;

  return `你是一个安全测试执行者。你的唯一任务是完成下面指定的探索方向。

## 任务
${directionDescription}

使用 bash 和其他工具执行此探索。将工具输出中的重要信息保存到工作目录 ${workdir}/ 下的文件中，不需要保存所有原始输出，只保留有参考价值的内容。

## 网络请求控制
遵守以下规则：
- **并发限制**：所有网络扫描工具必须将并发数设为最低。nmap 使用 -T1 --max-rate=10 -n（每秒最多10个包，-n 禁止反向 DNS 解析以加快扫描速度）；gobuster、dirsearch、ffuf 等工具必须加 -t 1（线程数为1）；curl、wget 等HTTP工具禁止并行请求
- **请求间隔**：每个网络请求之间必须间隔至少 2 秒。批量探测时主动 sleep 控制节奏
- **异常降速**：如果目标响应变慢、连接超时或出现大量失败，等待 10-30 秒后以更低速率重试（如 nmap 降低 --max-rate，gobuster 使用 -t 1 基础上再加 --delay 等），不要直接放弃

## 扫描策略
优先采用分析驱动的方式，避免盲目大量扫描。先理解目标（框架、技术栈、页面内容），再有针对性地探测，而不是一开始就用大字典暴力扫描。端口扫描同理，先扫常见端口再按需扩大范围。如果需要长时间运行的扫描，将命令放入后台并定期检查结果，同时将已有发现写入输出文件。

## 输出格式
无论探索成功或失败，都必须写入 ${outputFile}。使用 write 工具写入。

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
\`\`\``;
}
