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

## 网络请求控制
你运行在共享环境中。违反以下规则会直接导致宿主机网络瘫痪，必须严格执行：
- **严格串行**：同一时刻只能运行 1 个网络命令（nmap、curl、wget、whatweb、gobuster、dirsearch、sqlmap、nikto、hydra、ncat 等所有网络工具均适用）。一个命令完全结束（返回输出或超时退出）后，才能运行下一个。禁止用 &、&&、||、;、| 等方式串联或并行多个网络命令
- **速率限制**：nmap 必须加 --min-rate=200 -T2，禁止使用 -T4、-T5 或 --min-rate=500 以上。其他扫描工具（gobuster、dirsearch、nikto 等）使用默认速率，禁止加 -t（线程数）或 --threads 参数提高并发
- **单一目标**：每条 Act 只完成一个具体动作，例如"扫描端口"或"访问某个 URL"，不要在一个 Act 里串联多个探测步骤
- **异常即停**：如果目标响应变慢、连接超时或出现大量失败，立即停止当前命令，不要重试

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
\`\`\`

项目 ID: ${projectId}`;
}
