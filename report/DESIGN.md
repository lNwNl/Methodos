# methodos-report 设计文档

## 概述

methodos-report 是 Methodos 的报告生成模块，基于 LangGraph 实现。从 Methodos 的图数据（Node/Edge）生成结构化渗透测试报告，支持 Markdown、HTML、PDF 三种输出格式。

### 核心特性

- **LangGraph 工作流** — 攻击路径和漏洞分析并行生成
- **双接口** — HTTP API（供 TypeScript 调用）+ CLI（供人类手动调用）
- **多格式输出** — Markdown（默认）、HTML、PDF
- **可配置 LLM** — 支持 OpenAI、Anthropic、Ollama
- **独立部署** — 使用 uv 管理 Python 环境

---

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                   Methodos (TypeScript)                  │
│                                                         │
│  ┌─────────┐    HTTP     ┌─────────────────────────┐   │
│  │ Web UI  │ ──────────→ │  methodos-report (Python)│   │
│  └─────────┘             │                         │   │
│                          │  ┌───────────────────┐  │   │
│  ┌─────────┐    CLI      │  │   LangGraph       │  │   │
│  │ Human   │ ──────────→ │  │   Workflow        │  │   │
│  └─────────┘             │  └───────────────────┘  │   │
│                          │                         │   │
│  ┌─────────┐   直接读取   │  ┌───────────────────┐  │   │
│  │ SQLite  │ ←────────── │  │   Report Core     │  │   │
│  └─────────┘   (只读)     │  └───────────────────┘  │   │
│                          └─────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │              data/reports/{project_id}/          │   │
│  │                 report.md | .html | .pdf         │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 职责划分

| 组件 | 职责 |
|------|------|
| **methodos-report** | 读取 SQLite（只读）、生成报告内容、格式转换 |
| **Methodos TypeScript** | 管理报告元数据、文件存储、提供下载 API |

---

## 项目结构

```
methodos-report/
├── pyproject.toml              # uv 项目配置
├── .env.example                # 配置示例
├── README.md                   # 使用说明
├── DESIGN.md                   # 设计文档
├── methodos_report/
│   ├── __init__.py
│   ├── api.py                  # FastAPI 服务
│   ├── cli.py                  # CLI 入口
│   ├── config.py               # 配置管理
│   ├── core/
│   │   ├── __init__.py
│   │   ├── report.py           # 核心报告生成逻辑
│   │   ├── graph.py            # LangGraph StateGraph 定义
│   │   ├── state.py            # ReportState 类型定义
│   │   ├── nodes/
│   │   │   ├── __init__.py
│   │   │   ├── collect.py      # 数据收集节点
│   │   │   ├── attack_path.py  # 攻击路径生成节点
│   │   │   └── vuln_analysis.py # 漏洞分析生成节点
│   │   └── format.py           # 格式转换（MD→HTML/PDF）
│   └── templates/
│       ├── report.md           # Markdown 报告模板
│       └── report.html         # HTML 报告模板
└── tests/
    ├── __init__.py
    ├── test_collect.py
    ├── test_attack_path.py
    ├── test_vuln_analysis.py
    └── test_format.py
```

---

## LangGraph 工作流

### 状态定义

```python
from typing import TypedDict, List, Optional

class NodeInfo(TypedDict):
    id: int
    description: str
    created_by: str  # 'human' | 'agent' | 'system'
    created_at: str

class EdgeInfo(TypedDict):
    id: int
    from_node_ids: List[int]
    to_node_ids: List[int]
    direction_description: str
    created_at: str

class Finding(TypedDict):
    title: str
    cause: str
    fix: str

class ReportState(TypedDict):
    # 输入
    project_id: int
    project_title: str
    nodes: List[NodeInfo]
    edges: List[EdgeInfo]
    
    # 中间结果
    timeline_markdown: str      # attack_path 节点输出
    findings: List[Finding]     # vuln_analysis 节点输出
    
    # 输出
    output_format: str          # 'markdown' | 'html' | 'pdf'
    output_content: str         # 最终报告内容
```

### 工作流图

```
┌──────────┐
│ collect  │ (程序性) 读取 SQLite，填充 nodes/edges
└────┬─────┘
     │
     ├──────────────────────┬───────────────────────────
     ▼                      ▼                            
┌──────────────┐    ┌──────────────┐                    
│ attack_path  │    │ vuln_analysis│                    
│ (LLM)        │    │ (LLM)        │                    
│              │    │              │                    
│ 生成攻击路径  │    │ 生成漏洞分析  │                    
│ 时间线叙事    │    │ 成因与修复    │                    
└──────┬───────┘    └──────┬───────┘                    
       │                   │                             
       └────────┬──────────┘                             
                ▼                                        
         ┌──────────┐                                    
         │  format  │ (程序性) 拼接模板 + 格式转换         
         └──────────┘                                    
```

### 节点定义

#### collect（程序性）

从 SQLite 读取项目的 Node 和 Edge 数据。

**输入**：`project_id`
**输出**：`project_title`, `nodes`, `edges`

```python
def collect_node(state: ReportState) -> dict:
    project_id = state["project_id"]
    
    # 读取项目信息
    project = db.execute(
        "SELECT title FROM projects WHERE id = ?", (project_id,)
    ).fetchone()
    
    # 读取节点
    nodes = db.execute(
        "SELECT id, description, created_by, created_at FROM nodes WHERE project_id = ? ORDER BY created_at",
        (project_id,)
    ).fetchall()
    
    # 读取边
    edges = db.execute(
        "SELECT id, from_node_ids, to_node_ids, direction_description, created_at FROM edges WHERE project_id = ? ORDER BY created_at",
        (project_id,)
    ).fetchall()
    
    return {
        "project_title": project["title"],
        "nodes": nodes,
        "edges": edges,
    }
```

#### attack_path（LLM）

生成攻击路径叙事。

**输入**：`nodes`, `edges`
**输出**：`timeline_markdown`

```python
def attack_path_node(state: ReportState) -> dict:
    nodes = state["nodes"]
    edges = state["edges"]
    
    # 构建 prompt
    prompt = f"""
你是一位渗透测试专家。根据以下图数据，生成攻击路径叙事报告。

## 图数据

### 节点（按时间顺序）
{format_nodes(nodes)}

### 边（探索方向）
{format_edges(edges)}

## 要求

1. 按时间线描述攻击过程
2. 每个关键发现单独成段
3. 使用 Markdown 格式
4. 突出重要转折点和发现

请生成攻击路径叙事：
"""
    
    # 调用 LLM
    response = llm.invoke(prompt)
    
    return {"timeline_markdown": response.content}
```

#### vuln_analysis（LLM）

生成漏洞分析报告。

**输入**：`nodes`, `edges`
**输出**：`findings`

```python
def vuln_analysis_node(state: ReportState) -> dict:
    nodes = state["nodes"]
    edges = state["edges"]
    
    # 构建 prompt
    prompt = f"""
你是一位渗透测试专家。根据以下图数据，分析发现的漏洞。

## 图数据

### 节点（按时间顺序）
{format_nodes(nodes)}

### 边（探索方向）
{format_edges(edges)}

## 要求

1. 识别所有安全漏洞
2. 分析漏洞成因
3. 提供修复建议
4. 输出 JSON 数组格式

请输出漏洞分析结果（JSON 格式）：
```json
[
  {{
    "title": "漏洞标题",
    "cause": "漏洞成因",
    "fix": "修复建议"
  }}
]
```
"""
    
    # 调用 LLM
    response = llm.invoke(prompt)
    
    # 解析 JSON
    findings = json.loads(response.content)
    
    return {"findings": findings}
```

#### format（程序性）

拼接模板并转换格式。

**输入**：`timeline_markdown`, `findings`, `output_format`
**输出**：`output_content`

```python
def format_node(state: ReportState) -> dict:
    # 渲染 Markdown 模板
    markdown = render_template(
        "report.md",
        project_title=state["project_title"],
        timeline=state["timeline_markdown"],
        findings=state["findings"],
    )
    
    # 根据目标格式转换
    output_format = state["output_format"]
    if output_format == "markdown":
        content = markdown
    elif output_format == "html":
        content = markdown_to_html(markdown)
    elif output_format == "pdf":
        content = markdown_to_pdf(markdown)
    
    return {"output_content": content}
```

---

## API 接口

### FastAPI 服务

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from pathlib import Path

app = FastAPI(title="methodos-report", version="0.1.0")

class ReportRequest(BaseModel):
    output: str  # 输出文件路径（从后缀推断格式）

class ReportResponse(BaseModel):
    file_path: str
    size: int

@app.post("/projects/{project_id}/report", response_model=ReportResponse)
async def generate_report(project_id: int, request: ReportRequest):
    """生成项目报告"""
    try:
        # 从文件后缀推断格式
        output_path = Path(request.output)
        format = output_path.suffix[1:]  # 去掉点号
        
        if format not in ("md", "markdown", "html", "pdf"):
            raise HTTPException(400, f"Unsupported format: {format}")
        
        # 标准化格式名称
        format_map = {"md": "markdown", "markdown": "markdown"}
        format = format_map.get(format, format)
        
        # 生成报告
        content = generate_report_core(project_id, format)
        
        # 保存文件
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(content if isinstance(content, bytes) else content.encode())
        
        return ReportResponse(
            file_path=str(output_path),
            size=len(content),
        )
    except Exception as e:
        raise HTTPException(500, str(e))

@app.get("/health")
async def health_check():
    """健康检查"""
    return {"status": "ok"}
```

---

## CLI 接口

```python
import argparse
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(
        prog="methodos-report",
        description="Methodos 渗透测试报告生成工具"
    )
    
    subparsers = parser.add_subparsers(dest="command", help="可用命令")
    
    # generate 命令
    generate_parser = subparsers.add_parser(
        "generate",
        help="生成渗透测试报告"
    )
    generate_parser.add_argument(
        "--project-id",
        type=int,
        required=True,
        help="项目 ID"
    )
    generate_parser.add_argument(
        "--output",
        type=str,
        required=True,
        help="输出文件路径（支持 .md, .html, .pdf 后缀）"
    )
    generate_parser.add_argument(
        "--db-path",
        type=str,
        default="data/methodos.db",
        help="Methodos 数据库路径（默认: data/methodos.db）"
    )
    
    args = parser.parse_args()
    
    if args.command == "generate":
        # 从文件后缀推断格式
        output_path = Path(args.output)
        format = output_path.suffix[1:]
        
        if format not in ("md", "markdown", "html", "pdf"):
            print(f"错误: 不支持的格式 '{format}'，支持 .md, .html, .pdf")
            return 1
        
        format_map = {"md": "markdown", "markdown": "markdown"}
        format = format_map.get(format, format)
        
        # 生成报告
        try:
            content = generate_report_core(args.project_id, format, args.db_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(content if isinstance(content, bytes) else content.encode())
            print(f"报告已生成: {output_path}")
            return 0
        except Exception as e:
            print(f"错误: {e}")
            return 1
    
    parser.print_help()
    return 1

if __name__ == "__main__":
    exit(main())
```

---

## 数据库

### Methodos 端新增表

```sql
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  format TEXT NOT NULL,          -- 'markdown' | 'html' | 'pdf'
  file_path TEXT NOT NULL,       -- 文件路径
  size INTEGER,                  -- 文件大小 (bytes)
  created_at TEXT NOT NULL,      -- 创建时间
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

### Methodos 端新增操作

```typescript
// src/db/operations.ts

export function insertReport(
  db: Database.Database,
  projectId: number,
  format: string,
  filePath: string,
  size: number,
  createdAt: string
): number {
  const result = db.prepare(`
    INSERT INTO reports (project_id, format, file_path, size, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(projectId, format, filePath, size, createdAt);
  return result.lastInsertRowid as number;
}

export function listReports(db: Database.Database, projectId: number) {
  return db.prepare(`
    SELECT * FROM reports WHERE project_id = ? ORDER BY created_at DESC
  `).all(projectId);
}

export function getReport(db: Database.Database, reportId: number) {
  return db.prepare(`
    SELECT * FROM reports WHERE id = ?
  `).get(reportId);
}
```

---

## 配置

### Python 配置 (.env)

```env
# LLM 配置
LLM_PROVIDER=openai          # openai | anthropic | ollama

# OpenAI 配置
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1

# Anthropic 配置
ANTHROPIC_API_KEY=sk-ant-...

# Ollama 配置
OLLAMA_BASE_URL=http://localhost:11434

# 模型配置
MODEL_NAME=gpt-4o            # 或 claude-3-5-sonnet, llama3
TEMPERATURE=0.7

# 服务配置
API_HOST=0.0.0.0
API_PORT=8001
```

### TypeScript 配置 (.env)

```env
# 报告服务配置
REPORT_SERVICE_URL=http://localhost:8001
```

---

## 部署

### Python 模块部署

```bash
# 克隆项目
git clone <repo-url>
cd methodos-report

# 安装依赖
uv sync

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入 API Key

# 启动 HTTP 服务
uv run uvicorn methodos_report.api:app --host 0.0.0.0 --port 8001

# 或使用 CLI
uv run methodos-report generate --project-id 1 --output report.md
```

### 依赖

```toml
[project]
name = "methodos-report"
version = "0.1.0"
description = "Methodos 渗透测试报告生成模块"
requires-python = ">=3.11"
dependencies = [
    "langgraph>=0.2.0",
    "langchain>=0.3.0",
    "langchain-openai>=0.2.0",
    "langchain-anthropic>=0.2.0",
    "langchain-ollama>=0.2.0",
    "fastapi>=0.115.0",
    "uvicorn>=0.32.0",
    "pydantic>=2.0.0",
    "python-dotenv>=1.0.0",
    "jinja2>=3.1.0",
    "markdown>=3.7.0",
    "weasyprint>=63.0",
]

[project.scripts]
methodos-report = "methodos_report.cli:main"
```

---

## TypeScript 端变更

### 新增 API 端点

```typescript
// src/api/routes.ts

// POST /projects/:id/report — 触发报告生成
app.post('/projects/:id/report', async (request, reply) => {
  const id = parseInt((request.params as any).id, 10);
  if (isNaN(id)) return reply.status(400).send({ error: 'Invalid project ID' });
  
  const project = getProject(db, id);
  if (!project) return reply.status(404).send({ error: 'Project not found' });
  
  const { format = 'markdown' } = (request.body as any) || {};
  const timestamp = Date.now();
  const ext = format === 'markdown' ? 'md' : format;
  const outputPath = path.join('data', 'reports', String(id), `${timestamp}.${ext}`);
  
  try {
    // 调用 Python HTTP API
    const response = await fetch(`${config.reportServiceUrl}/projects/${id}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ output: outputPath })
    });
    
    if (!response.ok) {
      throw new Error(`Report service error: ${response.statusText}`);
    }
    
    const { file_path, size } = await response.json() as any;
    
    // 更新数据库
    const ts = new Date().toISOString();
    insertReport(db, id, format, file_path, size, ts);
    
    return reply.send({
      download_url: `/reports/${id}/${path.basename(file_path)}`
    });
  } catch (err: any) {
    return reply.status(500).send({ error: err.message });
  }
});

// GET /projects/:id/reports — 获取报告列表
app.get('/projects/:id/reports', async (request, reply) => {
  const id = parseInt((request.params as any).id, 10);
  if (isNaN(id)) return reply.status(400).send({ error: 'Invalid project ID' });
  
  return listReports(db, id);
});

// GET /projects/:id/reports/:reportId — 下载报告
app.get('/projects/:id/reports/:reportId', async (request, reply) => {
  const reportId = parseInt((request.params as any).reportId, 10);
  if (isNaN(reportId)) return reply.status(400).send({ error: 'Invalid report ID' });
  
  const report = getReport(db, reportId) as any;
  if (!report) return reply.status(404).send({ error: 'Report not found' });
  
  const contentTypes: Record<string, string> = {
    markdown: 'text/markdown',
    html: 'text/html',
    pdf: 'application/pdf',
  };
  
  return reply
    .type(contentTypes[report.format] || 'application/octet-stream')
    .sendFile(report.file_path);
});
```

---

## 使用示例

### HTTP API 调用

```bash
# 生成 Markdown 报告
curl -X POST http://localhost:8001/projects/1/report \
  -H "Content-Type: application/json" \
  -d '{"output": "data/reports/1/report.md"}'

# 响应
# {"file_path": "data/reports/1/report.md", "size": 1234}
```

### CLI 调用

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

### Web UI 调用

```javascript
// 前端调用
const response = await fetch('/projects/1/report', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ format: 'pdf' })
});
const { download_url } = await response.json();
window.location.href = download_url;
```

---

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| 项目不存在 | 返回 404 错误 |
| 数据库连接失败 | 返回 500 错误，日志记录 |
| LLM 调用失败 | 返回 500 错误，支持重试 |
| 文件写入失败 | 返回 500 错误，检查权限 |
| 不支持的格式 | 返回 400 错误 |
