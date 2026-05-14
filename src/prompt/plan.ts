import type { Snapshot } from '../types';

export function renderPlanPrompt(snapshot: Snapshot, projectId: number): string {
  return `你处于只读规划模式，只能观察和思考，不能执行命令或修改文件。

分析下方探索图，输出下一步行动的纯 JSON。

## 当前探索图
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## 输出格式——只输出下面这个 JSON 对象，不要附加任何文字
\`\`\`json
{
  "edges": [
    { "from_node_ids": [1], "direction_description": "具体的下一步探索方向描述" }
  ],
  "complete": false
}
\`\`\`

## 判定规则（严格遵循）
- **继续探索**：尚未达成原始目标 → \`"complete": false\` + 非空 \`edges\`
  - 每条 edge 的 \`from_node_ids\` 必须引用已有 Node ID
  - \`direction_description\` 要具体可执行，如"使用 nmap 扫描目标端口"、"访问登录页面测试 SQL 注入"
- **任务达成**：已拿到原始目标要求的结果（如 flag、密码、proof）→ \`"complete": true\`
  - \`edges\` 必须为 \`[]\`
  - 附带 \`"summary"\` 说明判定依据
  - 附带 \`"evidence_node_ids"\` 列出依据的 Node ID
- **无法继续**：已穷尽所有方法但仍未达成目标 → \`"complete": false\` + \`edges: []\`

## 渗透测试特殊规则
- ❌ **禁止过早判定完成**——仅仅获取了页面信息、端口信息但未拿到 flag/密码/权限时，绝对不能 complete
- ✅ 探索方向应针对"如何进一步渗透"而非"收集信息"
- ✅ 优先考虑：漏洞扫描、弱口令测试、SQL 注入、目录爆破、已知 CVE 利用

project_id: ${projectId}`;
}
