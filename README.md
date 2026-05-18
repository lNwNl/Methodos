# Methodos

自动化渗透测试编排系统。通过 Plan-Act 循环驱动 LLM Agent 自主执行安全测试任务，以有向图（探索图谱）建模探索过程，支持多 Agent 并行执行与优先级调度。

> 本项目受 [Cairn](https://github.com/oritera/Cairn) 启发，借鉴了其以图谱建模探索过程、通过 LLM Agent 自主驱动安全测试的核心思想，同时在架构和技术选型上做了不同的选择。

### 与 Cairn 的主要差异

| 维度 | Cairn | Methodos |
|------|-------|----------|
| 技术栈 | Python + FastAPI（Server）+ Docker SDK（Dispatcher） | TypeScript + Fastify + Podman CLI |
| 进程模型 | 双进程：Server 维护图谱状态，Dispatcher 通过 HTTP 轮询 Server 并调度任务 | 单进程：HTTP 服务与调度循环同进程，共享 SQLite 连接 |
| 图谱模型 | Fact（已确认发现，不可变）+ Intent（探索方向，通过心跳租约认领）+ Hint（人工提示） | Node（发现）+ Edge（探索方向，含动态优先级和认领超时） |
| 执行循环 | Reason 分析图谱产出 Intent → Explore 认领 Intent 执行探索产出 Fact | Plan 分析图谱产出 Edge → Act 认领 Edge 执行探索产出 Node |
| Agent 交互 | Dispatcher 构建 CLI 命令在容器内执行，解析 stdout 提取 JSON | 将 prompt 写入容器内文件，Agent 将结果写入指定文件，读取并校验；校验失败自动重试修正 |
| 调度策略 | Worker 按容量/健康状态过滤，Intent 通过心跳租约防止重复认领 | 默认随机选取 Edge，可选按优先级排序；Edge 通过认领超时防止永久锁定 |
| Agent 后端 | WorkerDriver 接口：构建 CLI 参数 + 解析输出，内置 Claude Code / Codex / Pi | AgentDriver 接口：管理执行生命周期，内置 OpenCode / Mock |

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                     Web UI (Vue 3)                       │
│              Cytoscape.js 图谱可视化                      │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP API
┌────────────────────────┴────────────────────────────────┐
│                   Fastify Server                         │
│            REST API + 静态文件服务                        │
└────────┬──────────────────────────────────┬──────────────┘
         │                                  │
┌────────┴──────────────┐    ┌──────────────┴──────────────┐
│     Executor Loop     │    │     Report Generator         │
│  ┌──────────┐         │    │  Python (uv) 子进程          │
│  │  Plan    │→ Act →  │    │  LLM 驱动报告生成            │
│  │ Conclude │         │    └──────────────────────────────┘
│  └──────────┘         │
│        ↕              │
│  ┌────────────────────┤
│  │  Agent Driver      │
│  │  OpenCode │ Mock   │
│  └────────────────────┤
│        ↕              │
│  ┌────────────────────┤
│  │  Container Pool    │
│  │  Podman CLI        │
│  └────────────────────┘
└────────┬──────────────┘
         │
┌────────┴────────────────────────────────────────────────┐
│                  SQLite (better-sqlite3)                  │
│        projects │ nodes │ edges │ reports │ settings     │
└─────────────────────────────────────────────────────────┘
```

## 核心概念

### 探索图谱

每个项目维护一个有向图：

- **Node（节点）**：一个发现或事实。来源分为 `human`（人工输入）、`agent`（Agent 产出）、`system`（系统生成，如超时记录）。
- **Edge（边）**：一个探索方向。`from_node_ids` 指向已有节点，`to_node_ids` 在执行完成后指向新产出的节点。未执行的边（`to_node_ids = []`）是待探索的任务。

### validateAndFix 机制

Plan 和 Act 执行后，Agent 输出的 JSON 会经过校验。若输出文件缺失或格式不合法，系统自动重试（最多 `maxValidationRetries` 次），引导 Agent 修正输出格式。

### Plan-Act 循环

1. **Plan（规划）**：将当前图谱快照发送给 LLM，由其分析已有发现，决策下一步：
   - `complete: true` — 目标达成或探索穷尽，项目结束
   - `complete: false` + 新 edges — 继续探索
   - `complete: false` + 空 edges — 卡住，项目标记为 failed

   Plan 触发模式（`planTriggerMode`）：
   - `edge_drain`（默认）— 所有边均已产出结果后才触发下一轮 Plan
   - `node_created` — 有新节点即触发 Plan
2. **Act（执行）**：从待探索边中按优先级认领一条，将方向描述发送给 LLM Agent 在容器内执行实际操作（扫描、枚举、利用等）。
3. **Conclude（总结）**：当 Act 超时时，触发总结阶段，要求 Agent 基于已有信息产出结果。

### 优先级调度

边的优先级由 `src/db/priority.ts` 中的算法动态计算：
- 成功执行 → 优先级提升（`priorityBoostSuccess`）
- 失败 → 优先级降低（`priorityPenaltyFailure`）
- 随时间衰减（`priorityDecayRateHourly`）
- Claimed 过期机制防止边被永久占用

## 技术栈

| 层         | 技术                                           |
| ---------- | ---------------------------------------------- |
| 语言       | TypeScript (ES2024, ESM)                       |
| 运行时     | Node.js 24 + tsx                               |
| HTTP       | Fastify 5                                      |
| 数据库     | SQLite + better-sqlite3                        |
| 容器       | Podman CLI（可替换为 Docker）                   |
| 前端       | Vue 3 (CDN) + Cytoscape.js + Dagre             |
| 样式       | CSS Variables（自定义暗色/亮色主题）             |
| 校验       | Zod 4                                          |
| 日志       | Pino                                           |
| 报告       | Python (uv) + LLM 驱动报告生成                  |
| 测试       | Vitest                                         |

## 项目结构

```
src/
├── api/
│   ├── server.ts          # Fastify 服务器创建与启动
│   ├── routes.ts          # REST API 路由定义
│   ├── schemas.ts         # Zod 请求/响应 schema
│   └── routes.test.ts     # API 测试
├── db/
│   ├── connection.ts      # 数据库连接、初始化与 schema 定义
│   ├── operations.ts      # CRUD 操作（项目、节点、边、设置）
│   ├── priority.ts        # 边优先级计算算法
│   └── __tests__/         # 数据库操作测试
├── docker/
│   ├── index.ts           # Podman 常量与容器命名
│   ├── manager.ts         # 容器生命周期管理（创建、启停、配置注入）
│   └── exec.ts            # 容器内命令执行、文件读写
├── driver/
│   ├── types.ts           # AgentDriver 接口定义
│   ├── opencode.ts        # OpenCode Agent 驱动（Docker 模式）
│   ├── mock.ts            # Mock 驱动（测试模式）
│   └── mock.test.ts       # Mock 驱动测试
├── executor/
│   ├── main.ts            # 应用入口
│   ├── loop.ts            # 核心调度循环（tick-based）
│   ├── plan-exec.ts       # Plan 执行逻辑与结果写入
│   ├── act-exec.ts        # Act 执行逻辑与结果写入
│   └── __tests__/         # 执行器测试
├── prompt/
│   ├── plan.ts            # Plan 阶段 prompt 模板
│   ├── act.ts             # Act 阶段 prompt 模板
│   └── conclude.ts        # Conclude 阶段 prompt 模板
├── report/
│   └── runner.ts          # 报告生成模块（调用 Python uv 子进程）
├── snapshot/
│   └── render.ts          # 图谱快照渲染（截断策略）
├── __tests__/
│   └── integration/
│       └── multi-level-queue.test.ts  # 多级反馈队列集成测试
├── config.ts              # 配置管理（默认值 + 环境变量 + DB 覆盖）
└── types.ts               # 共享类型定义

static/
├── index.html             # 首页（项目列表）
├── project.html           # 项目详情页（图谱可视化）
├── settings.html          # 设置页面（通用 + 报告 + Agent 配置）
├── app.js                 # 首页 Vue 应用
├── graph.js               # 图谱可视化 Vue 应用 + Cytoscape 集成
├── settings.js            # 设置页面 Vue 应用
└── theme.css              # 全局样式（暗色/亮色主题）

docker/
├── opencode/              # OpenCode Agent 容器配置与 skills
├── test-agent/            # 测试用 Agent 容器
└── validate-json.js       # Agent 输出 JSON 校验脚本
```

## 快速开始

### 前置条件

- Node.js ≥ 24
- Podman（或 Docker，需修改 `DOCKER_BIN` 环境变量）
- uv（Python 包管理器，用于报告生成）

### 安装

```bash
npm install
```

### 初始化数据库

```bash
npm run db:push
```

### 拉取 Agent 镜像

Docker 模式需要预拉取 Agent 容器镜像：

```bash
# 拉取 OpenCode Agent 镜像
podman pull ghcr.io/lnwnl/methodos/opencode:latest
```

如使用 Docker，需设置环境变量：

```bash
export DOCKER_BIN=docker
```

### 启动

```bash
npm run dev
```

访问 `http://localhost:3000`。

### 启动（Mock 模式）

Mock 模式无需容器，使用内置的 MockAgentDriver 模拟 Agent 行为：

```bash
npm run dev -- --mock
```

### 运行测试

```bash
npm test
```

### 类型检查

```bash
npm run typecheck
```

## 配置

配置优先级：环境变量 > 数据库 settings 表 > 代码默认值

| 配置项               | 环境变量               | 默认值     | 说明                         |
| -------------------- | ---------------------- | ---------- | ---------------------------- |
| `actTimeoutMs`       | `ACT_TIMEOUT_MS`       | 600000     | Act 执行超时（ms）           |
| `concludeTimeoutMs`  | `CONCLUDE_TIMEOUT_MS`  | 300000     | Conclude 执行超时（ms）      |
| `planTimeoutMs`      | `PLAN_TIMEOUT_MS`      | 600000     | Plan 执行超时（ms）          |
| `claimedExpiryMs`    | —                      | 1800000    | 边认领过期时间（ms）         |
| `tickIntervalMs`     | —                      | 1000       | 调度循环间隔（ms）           |
| `maxFailures`        | `MAX_FAILURES`         | 3          | 最大失败次数后放弃           |
| `maxActConcurrency`  | `MAX_ACT_CONCURRENCY`  | 3          | 最大并行 Act 数              |
| `snapshotMaxNodes`   | `SNAPSHOT_MAX_NODES`   | 100        | 快照最大节点数               |
| `snapshotMaxEdges`   | `SNAPSHOT_MAX_EDGES`   | 200        | 快照最大边数                 |
| `maxValidationRetries` | `MAX_VALIDATION_RETRIES` | 3       | Agent 输出校验重试次数       |
| `planMinIntervalMs`  | —                      | 5000       | Plan 最小间隔（ms）          |
| `planTriggerMode`    | `PLAN_TRIGGER_MODE`    | edge_drain | Plan 触发模式（edge_drain / node_created） |
| `priorityBoostSuccess` | —                    | 1.2        | 成功后优先级乘数             |
| `priorityPenaltyFailure` | —                   | 0.9        | 失败后优先级乘数             |
| `priorityDecayRateHourly` | —                  | 0.01       | 优先级每小时衰减率           |
| `schedulingAlgorithm`  | `SCHEDULING_ALGORITHM` | random     | 边调度算法（random / priority） |
| `DATABASE_PATH`        | `DATABASE_PATH`        | `./data/methodos.db` | 数据库文件路径          |

Agent 配置通过 `/settings/agent` API 或数据库 settings 表设置：

| 配置项           | 说明                         |
| ---------------- | ---------------------------- |
| `agentProvider`  | Agent LLM 提供商             |
| `agentApiKey`    | Agent API Key                |
| `agentBaseURL`   | Agent 兼容 Base URL          |
| `agentModel`     | Agent 模型名称               |

## 报告生成

项目完成后可触发渗透测试报告生成。报告由 Python 子进程（`uv run methodos-report`）调用 LLM 生成 Markdown 格式报告，存储在 `data/reports/<projectId>/` 目录下。

报告 LLM 配置通过 `/settings/report` API 或环境变量设置：

| 配置项                    | 环境变量                  | 说明               |
| ------------------------- | ------------------------- | ------------------ |
| `report.llm_provider`     | `REPORT_LLM_PROVIDER`     | LLM 提供商         |
| `report.openai_api_key`   | `REPORT_OPENAI_API_KEY`   | OpenAI API Key     |
| `report.openai_base_url`  | `REPORT_OPENAI_BASE_URL`  | OpenAI 兼容 Base URL |
| `report.anthropic_api_key`| `REPORT_ANTHROPIC_API_KEY`| Anthropic API Key  |
| `report.ollama_base_url`  | `REPORT_OLLAMA_BASE_URL`  | Ollama Base URL    |
| `report.model_name`       | `REPORT_MODEL_NAME`       | 模型名称           |
| `report.temperature`      | `REPORT_TEMPERATURE`      | 生成温度           |

## CI/CD

GitHub Actions 自动构建 Docker 镜像并推送至 GitHub Container Registry (GHCR)：

- 触发条件：推送到 `master` 分支或 `v*.*.*` 标签
- 镜像地址：`ghcr.io/<owner>/methodos/opencode`
- Workflow 文件：`.github/workflows/docker-publish.yml`

## API

| 方法   | 路径                          | 说明                               |
| ------ | ----------------------------- | ---------------------------------- |
| `GET`  | `/health`                     | 健康检查                           |
| `GET`  | `/mode`                       | 当前运行模式（docker/mock）        |
| `POST` | `/projects`                   | 创建项目                           |
| `GET`  | `/projects`                   | 列出所有项目                       |
| `GET`  | `/projects/:id`               | 获取项目详情（含节点和边）         |
| `POST` | `/projects/:id/stop`          | 暂停项目                           |
| `POST` | `/projects/:id/push`          | 推进项目（添加人工节点/恢复）      |
| `GET`  | `/projects/:id/edges`         | 获取边状态列表                     |
| `GET`  | `/settings`                   | 获取当前设置                       |
| `PUT`  | `/settings`                   | 更新设置                           |
| `GET`  | `/settings/report`            | 获取报告配置（敏感字段脱敏）       |
| `PUT`  | `/settings/report`            | 更新报告配置                       |
| `GET`  | `/settings/agent`             | 获取 Agent 配置（敏感字段脱敏）    |
| `PUT`  | `/settings/agent`             | 更新 Agent 配置                    |
| `POST` | `/projects/:id/report`        | 触发报告生成（项目需已完成）       |
| `GET`  | `/projects/:id/report/latest` | 获取最近报告状态                   |
| `GET`  | `/reports/:id/download`       | 下载报告文件（Markdown）           |

## Agent Driver 接口

实现 `AgentDriver` 接口即可接入新的 Agent：

```typescript
interface AgentDriver {
  executePlan(params: {
    prompt: string;
    workdir: string;
    timeout: number;
    round: number;
  }): Promise<PlanOutput>;

  executeAct(params: {
    prompt: string;
    workdir: string;
    timeout: number;
  }): Promise<ActResult>;

  conclude(params: {
    sessionId: string;
    prompt: string;
    workdir: string;
    timeout: number;
  }): Promise<AgentOutput>;
}
```

## 许可证

[GNU Affero General Public License v3.0](LICENSE)
