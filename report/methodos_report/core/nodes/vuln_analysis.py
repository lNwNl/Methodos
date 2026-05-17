import json
from typing import Any
from langchain_core.language_models import BaseChatModel

from ..state import ReportState, Finding
from .attack_path import format_nodes_for_prompt, format_edges_for_prompt


def create_vuln_analysis_node(llm: BaseChatModel):
    """创建漏洞分析节点"""

    def vuln_analysis_node(state: ReportState) -> dict[str, Any]:
        nodes = state["nodes"]
        edges = state["edges"]

        prompt = f"""你是一位渗透测试专家。根据以下图数据，分析发现的安全漏洞。

## 图数据

### 节点（按时间顺序）
{format_nodes_for_prompt(nodes)}

### 边（探索方向）
{format_edges_for_prompt(edges)}

## 要求

1. 识别所有安全漏洞
2. 分析漏洞成因
3. 提供修复建议
4. 输出 JSON 数组格式

请输出漏洞分析结果（JSON 格式）：
```json
[
  {{
    "title": "漏洞标题",
    "cause": "漏洞成因",
    "fix": "修复建议"
  }}
]
```"""

        response = llm.invoke(prompt)

        # 从响应中提取 JSON
        content = response.content
        # 尝试从 markdown 代码块中提取 JSON
        if "```json" in content:
            start = content.index("```json") + 7
            end = content.index("```", start)
            json_str = content[start:end].strip()
        elif "```" in content:
            start = content.index("```") + 3
            end = content.index("```", start)
            json_str = content[start:end].strip()
        else:
            json_str = content.strip()

        try:
            findings: list[Finding] = json.loads(json_str)
        except json.JSONDecodeError:
            # 如果解析失败，返回空列表
            findings = []

        return {"findings": findings}

    return vuln_analysis_node
