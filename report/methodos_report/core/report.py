from typing import Union

from ..config import config
from .graph import create_report_graph


def generate_report(
    project_id: int,
    output_format: str,
    db_path: str | None = None,
) -> Union[str, bytes]:
    """生成渗透测试报告

    Args:
        project_id: 项目 ID
        output_format: 输出格式 ('markdown' | 'html' | 'pdf')
        db_path: 数据库路径，默认使用配置中的路径

    Returns:
        报告内容（字符串或字节）
    """
    if db_path is None:
        db_path = config.DEFAULT_DB_PATH

    # 获取 LLM
    llm = config.get_llm()

    # 创建工作流图
    graph = create_report_graph(llm, db_path)

    # 初始状态
    initial_state = {
        "project_id": project_id,
        "project_title": "",
        "nodes": [],
        "edges": [],
        "timeline_markdown": "",
        "findings": [],
        "output_format": output_format,
        "output_content": "",
    }

    # 执行工作流
    result = graph.invoke(initial_state)

    return result["output_content"]
