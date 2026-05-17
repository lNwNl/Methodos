from typing import TypedDict, List, Optional


class NodeInfo(TypedDict):
    """图节点信息"""
    id: int
    description: str
    created_by: str  # 'human' | 'agent' | 'system'
    created_at: str


class EdgeInfo(TypedDict):
    """图边信息"""
    id: int
    from_node_ids: List[int]
    to_node_ids: List[int]
    direction_description: str
    created_at: str


class Finding(TypedDict):
    """漏洞发现"""
    title: str
    cause: str
    fix: str


class ReportState(TypedDict):
    """报告生成状态"""
    # 输入
    project_id: int
    project_title: str
    nodes: List[NodeInfo]
    edges: List[EdgeInfo]

    # 中间结果
    timeline_markdown: str  # attack_path 节点输出
    findings: List[Finding]  # vuln_analysis 节点输出

    # 输出
    output_format: str  # 'markdown' | 'html' | 'pdf'
    output_content: str  # 最终报告内容
