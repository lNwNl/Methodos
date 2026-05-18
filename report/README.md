# methodos-report

Methodos 渗透测试报告生成模块，基于 LangGraph 实现。

## 功能特性

- **LangGraph 工作流** — 攻击路径和漏洞分析并行生成
- **多格式输出** — Markdown、HTML、PDF
- **可配置 LLM** — 支持 OpenAI、Anthropic、Ollama

## 快速开始

### 安装

```bash
cd report
uv sync

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入 API Key
```

### 使用

```bash
# 生成 Markdown 报告
uv run methodos-report generate --project-id 1 --output report.md

# 生成 HTML 报告
uv run methodos-report generate --project-id 1 --output report.html

# 生成 PDF 报告
uv run methodos-report generate --project-id 1 --output report.pdf

# 指定数据库路径
uv run methodos-report generate --project-id 1 --db-path /path/to/methodos.db --output report.md
```

格式从文件后缀自动推断（`.md`、`.html`、`.pdf`）。

## 配置

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_PROVIDER` | LLM 提供商 | `openai` |
| `OPENAI_API_KEY` | OpenAI API Key | - |
| `OPENAI_BASE_URL` | OpenAI API 地址 | `https://api.openai.com/v1` |
| `ANTHROPIC_API_KEY` | Anthropic API Key | - |
| `OLLAMA_BASE_URL` | Ollama 地址 | `http://localhost:11434` |
| `MODEL_NAME` | 模型名称 | `gpt-4o` |
| `TEMPERATURE` | 温度参数 | `0.7` |
| `DEFAULT_DB_PATH` | 默认数据库路径 | `data/methodos.db` |

所有环境变量支持 `REPORT_` 前缀（如 `REPORT_LLM_PROVIDER`），优先级更高。

## 架构

```
┌──────────┐
│ collect  │ 读取 SQLite，填充 nodes/edges
└────┬─────┘
     │
     ├──────────────────────┬────────────────────
     ▼                      ▼
┌──────────────┐    ┌──────────────┐
│ attack_path  │    │ vuln_analysis│
│ (LLM)        │    │ (LLM)        │
│ 生成攻击路径  │    │ 生成漏洞分析  │
└──────┬───────┘    └──────┬───────┘
       │                   │
       └────────┬──────────┘
                ▼
         ┌──────────┐
         │  format  │ 拼接模板 + 格式转换
         └──────────┘
```

### 项目结构

```
report/
├── pyproject.toml
├── .env.example
├── methodos_report/
│   ├── __init__.py
│   ├── cli.py                  # CLI 入口
│   ├── config.py               # 配置管理
│   ├── core/
│   │   ├── report.py           # 报告生成入口
│   │   ├── graph.py            # LangGraph 工作流定义
│   │   ├── state.py            # 状态类型定义
│   │   ├── format.py           # 格式转换（MD→HTML/PDF）
│   │   └── nodes/
│   │       ├── collect.py      # 数据收集节点
│   │       ├── attack_path.py  # 攻击路径生成
│   │       └── vuln_analysis.py # 漏洞分析生成
│   └── templates/
│       ├── report.md           # Markdown 模板
│       └── report.html         # HTML 模板
└── tests/
```

## 开发

```bash
# 运行测试
uv run pytest

# 代码格式化
uv run ruff format

# 类型检查
uv run mypy methodos_report
```
