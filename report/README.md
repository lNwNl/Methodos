# methodos-report

Methodos 渗透测试报告生成模块，基于 LangGraph 实现。

## 功能特性

- **LangGraph 工作流** — 攻击路径和漏洞分析并行生成
- **双接口** — HTTP API + CLI
- **多格式输出** — Markdown（默认）、HTML、PDF
- **可配置 LLM** — 支持 OpenAI、Anthropic、Ollama

## 快速开始

### 安装

```bash
# 克隆项目
git clone <repo-url>
cd methodos-report

# 安装依赖
uv sync

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入 API Key
```

### 使用 CLI

```bash
# 生成 Markdown 报告
uv run methodos-report generate --project-id 1 --output report.md

# 生成 PDF 报告
uv run methodos-report generate --project-id 1 --output report.pdf

# 生成 HTML 报告
uv run methodos-report generate --project-id 1 --output report.html

# 指定数据库路径
uv run methodos-report generate --project-id 1 --db-path /path/to/methodos.db --output report.md
```

支持的格式：`.md`、`.html`、`.pdf`（从文件后缀自动推断）

### 启动 HTTP 服务

```bash
# 启动服务
uv run uvicorn methodos_report.api:app --host 0.0.0.0 --port 8001

# 调用 API
curl -X POST http://localhost:8001/projects/1/report \
  -H "Content-Type: application/json" \
  -d '{"output": "data/reports/1/report.md"}'
```

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
| `API_HOST` | 服务监听地址 | `0.0.0.0` |
| `API_PORT` | 服务端口 | `8001` |

## 开发

```bash
# 运行测试
uv run pytest

# 代码格式化
uv run ruff format

# 类型检查
uv run mypy methodos_report
```

## 许可证

MIT
