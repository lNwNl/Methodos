import sqlite3
import json
from typing import Any

from ..state import ReportState, NodeInfo, EdgeInfo


def collect_node(state: ReportState, db_path: str) -> dict[str, Any]:
    """从 SQLite 读取项目的 Node 和 Edge 数据"""
    project_id = state["project_id"]

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    try:
        # 读取项目信息
        project = conn.execute(
            "SELECT title FROM projects WHERE id = ?", (project_id,)
        ).fetchone()

        if not project:
            raise ValueError(f"Project {project_id} not found")

        # 读取节点
        rows = conn.execute(
            """SELECT id, description, created_by, created_at
               FROM nodes
               WHERE project_id = ?
               ORDER BY created_at""",
            (project_id,),
        ).fetchall()

        nodes: list[NodeInfo] = [
            {
                "id": row["id"],
                "description": row["description"],
                "created_by": row["created_by"],
                "created_at": row["created_at"],
            }
            for row in rows
        ]

        # 读取边
        rows = conn.execute(
            """SELECT id, from_node_ids, to_node_ids, direction_description, created_at
               FROM edges
               WHERE project_id = ?
               ORDER BY created_at""",
            (project_id,),
        ).fetchall()

        edges: list[EdgeInfo] = []
        for row in rows:
            edges.append(
                {
                    "id": row["id"],
                    "from_node_ids": json.loads(row["from_node_ids"]),
                    "to_node_ids": json.loads(row["to_node_ids"]),
                    "direction_description": row["direction_description"],
                    "created_at": row["created_at"],
                }
            )

        return {
            "project_title": project["title"],
            "nodes": nodes,
            "edges": edges,
        }
    finally:
        conn.close()
