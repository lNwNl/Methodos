"""Methodos 渗透测试报告生成模块"""

from .config import config
from .core.report import generate_report

__version__ = "0.1.0"
__all__ = ["config", "generate_report"]
