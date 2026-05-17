import argparse
import sys
from pathlib import Path

from .core.report import generate_report


# 格式映射
FORMAT_MAP = {
    "md": "markdown",
    "markdown": "markdown",
    "html": "html",
    "pdf": "pdf",
}


def main() -> int:
    """CLI 入口"""
    parser = argparse.ArgumentParser(
        prog="methodos-report",
        description="Methodos 渗透测试报告生成工具",
    )

    parser.add_argument(
        "--project-id",
        type=int,
        required=True,
        help="项目 ID",
    )
    parser.add_argument(
        "--output",
        type=str,
        required=True,
        help="输出文件路径（支持 .md, .html, .pdf 后缀）",
    )
    parser.add_argument(
        "--db-path",
        type=str,
        default=None,
        help="Methodos 数据库路径（默认: data/methodos.db）",
    )

    args = parser.parse_args()

    # 从文件后缀推断格式
    output_path = Path(args.output)
    suffix = output_path.suffix[1:]

    if suffix not in FORMAT_MAP:
        print(f"错误: 不支持的格式 '.{suffix}'，支持 .md, .html, .pdf", file=sys.stderr)
        return 1

    output_format = FORMAT_MAP[suffix]

    try:
        # 生成报告
        print(f"正在生成报告（项目 ID: {args.project_id}）...")
        content = generate_report(args.project_id, output_format, args.db_path)

        # 保存文件
        output_path.parent.mkdir(parents=True, exist_ok=True)

        if isinstance(content, bytes):
            output_path.write_bytes(content)
        else:
            output_path.write_text(content, encoding="utf-8")

        print(f"报告已生成: {output_path}")
        return 0
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
