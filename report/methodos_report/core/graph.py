from functools import partial
from langgraph.graph import StateGraph, START, END
from langchain_core.language_models import BaseChatModel

from .state import ReportState
from .nodes.collect import collect_node
from .nodes.attack_path import create_attack_path_node
from .nodes.vuln_analysis import create_vuln_analysis_node
from .format import format_node


def create_report_graph(llm: BaseChatModel, db_path: str) -> StateGraph:
    """创建报告生成 LangGraph 工作流"""

    # 创建带 LLM 的节点
    attack_path = create_attack_path_node(llm)
    vuln_analysis = create_vuln_analysis_node(llm)

    # 带 db_path 的 collect 节点
    collect_with_db = partial(collect_node, db_path=db_path)

    # 构建图
    builder = StateGraph(ReportState)

    # 添加节点
    builder.add_node("collect", collect_with_db)
    builder.add_node("attack_path", attack_path)
    builder.add_node("vuln_analysis", vuln_analysis)
    builder.add_node("format", format_node)

    # 定义边
    builder.add_edge(START, "collect")
    # collect 之后并行执行 attack_path 和 vuln_analysis
    builder.add_edge("collect", "attack_path")
    builder.add_edge("collect", "vuln_analysis")
    # 两个 LLM 节点完成后汇聚到 format
    builder.add_edge("attack_path", "format")
    builder.add_edge("vuln_analysis", "format")
    builder.add_edge("format", END)

    return builder.compile()
