from typing import Any
from langchain_core.language_models import BaseChatModel

from ..state import ReportState, NodeInfo, EdgeInfo


def format_nodes_for_prompt(nodes: list[NodeInfo]) -> str:
    """将节点列表格式化为 prompt 字符串"""
    lines = []
    for node in nodes:
        lines.append(
            f"- [ID: {node['id']}] ({node['created_by']}) {node['description']}"
        )
    return "\n".join(lines)


def format_edges_for_prompt(edges: list[EdgeInfo]) -> str:
    """将边列表格式化为 prompt 字符串"""
    lines = []
    for edge in edges:
        from_ids = ", ".join(str(i) for i in edge["from_node_ids"])
        to_ids = ", ".join(str(i) for i in edge["to_node_ids"]) or "无结果"
        lines.append(
            f"- [ID: {edge['id']}] 方向: {edge['direction_description']}\n"
            f"  来源节点: [{from_ids}] → 结果节点: [{to_ids}]"
        )
    return "\n".join(lines)


def create_attack_path_node(llm: BaseChatModel):
    """创建攻击路径生成节点"""

    def attack_path_node(state: ReportState) -> dict[str, Any]:
        nodes = state["nodes"]
        edges = state["edges"]

        prompt = f"""你是一位渗透测试专家。根据以下图数据，生成攻击路径叙事报告。

## 图数据

### 节点（按时间顺序）
{format_nodes_for_prompt(nodes)}

### 边（探索方向）
{format_edges_for_prompt(edges)}

## 要求

1. 按时间线描述攻击过程
2. 每个关键发现单独成段
3. 使用 Markdown 格式
4. 突出重要转折点和发现
5. 描述攻击者如何一步步逼近目标

请生成攻击路径叙事："""

        response = llm.invoke(prompt)
        return {"timeline_markdown": response.content}

    return attack_path_node
