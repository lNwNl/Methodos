from pathlib import Path
from jinja2 import Environment, FileSystemLoader

from .state import ReportState


# 模板目录
TEMPLATES_DIR = Path(__file__).parent.parent / "templates"


def render_markdown(state: ReportState) -> str:
    """渲染 Markdown 报告"""
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))
    template = env.get_template("report.md")

    findings_text = ""
    for finding in state["findings"]:
        findings_text += f"""### {finding['title']}

**成因：** {finding['cause']}

**修复建议：** {finding['fix']}

---

"""

    return template.render(
        project_title=state["project_title"],
        timeline=state["timeline_markdown"],
        findings=findings_text,
    )


def markdown_to_html(markdown_content: str) -> str:
    """将 Markdown 转换为 HTML"""
    import markdown

    html_body = markdown.markdown(
        markdown_content,
        extensions=["tables", "fenced_code", "codehilite"],
    )

    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))
    template = env.get_template("report.html")

    return template.render(content=html_body)


def html_to_pdf(html_content: str) -> bytes:
    """将 HTML 转换为 PDF"""
    from weasyprint import HTML

    return HTML(string=html_content).write_pdf()


def format_node(state: ReportState) -> dict:
    """格式化节点：拼接模板并转换格式"""
    output_format = state["output_format"]

    # 渲染 Markdown
    markdown_content = render_markdown(state)

    # 根据目标格式转换
    if output_format == "markdown":
        content = markdown_content
    elif output_format == "html":
        content = markdown_to_html(markdown_content)
    elif output_format == "pdf":
        html_content = markdown_to_html(markdown_content)
        content = html_to_pdf(html_content)
    else:
        raise ValueError(f"Unsupported format: {output_format}")

    return {"output_content": content}
