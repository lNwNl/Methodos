# Methodos — 架构设计

## 问题本质

将一个目标导向的探索过程建模为有向图上的搜索：用户给出一段描述，Agent 从描述中理解任务，通过图的生长逐步逼近目标。多个 Agent 并发工作，通过共享图间接协调，各自读图、各自产出。

渗透测试是其首要应用领域。

---

## 核心概念（两个）

| 概念      | 含义                         | 规则         |
| --------- | ---------------------------- | ------------ |
| **Node**  | 图中的节点，一条客观信息       | 只增不改      |
| **Edge**  | 图中的有向边，从一组已有 Node 出发的一次探索 | `from_node_ids` 指向一个或多个出发 Node（多个时为 AND 语义——综合所有来源信息），`to_node_ids` 指向结果 Node（空数组时未产生结果），`direction_description` 为 Plan 产出的探索方向描述 |

Node 可以由 Agent 探索产出，也可以由人类直接创建。项目创建时，用户的原始输入直接作为第一个 Node 写入图——例如 "帮我拿到 flag。https://hackme.com"。所有 Node 在因果图里平等，不存在特殊的起始节点或目标节点。Agent 自行从图中理解任务。

---

## 系统架构

```
┌──────────────────────────────────────┐
│            SQLite                    │
│                                      │
│  Node-Edge 图，纯数据存储            │
│  无 HTTP，无业务逻辑                  │
└────────────────┬─────────────────────┘
                 │
           直接 SQL（同一进程）
                 │
┌────────────────┴─────────────────────┐
│            Executor                  │
│                                      │
│  主循环（每秒轮询每个 active 项目）：│
│    有未结果 Edge？→ 选取 → 执行 Act  │
│    无未结果 Edge + 有新 Node？→ Plan │
│  管理容器生命周期                     │
│  超时 → conclude，重试，写回结果      │
│  Web 服务器（HTTP API + 静态页面）    │
└──────────────────────────────────────┘
```

### 职责划分

|          | SQLite                  | Executor                            |
| -------- | ----------------------- | ----------------------------------- |
| 知道 Agent 吗 | 存储类型名称，不管理生命周期            | 管理任务容器生命周期                |
| 写图          | 存储               | 直接 SQL 读写                       |
| 推理          | 不做              | 不做（Agent 做）                    |
| 状态          | 持久化             | 有状态（容器引用、session）         |
| Edge 管理     | 原子写锁保证      | 选取 / 执行 / 写回                  |

---

## 任务模型（两个原语）

| 任务   | 输入                     | 做什么                       | 输出                                        |
| ------ | ------------------------ | ---------------------------- | ------------------------------------------- |
| **Plan** | 全图 snapshot            | 读图判断：新方向？是否已完成？每条 Edge 的 from_node_ids 由 Agent 自行选定 | Edge[] + complete                            |
| **Act**  | 全图 snapshot + 一条 Edge | 执行这条 Edge，产出结论   | Node                                        |

初始态不存在特殊任务类型。项目创建后首次 Plan，面对仅含用户初始描述一个 Node 的图，Agent 自行从中理解任务并产出第一批探索方向。

### 批次循环

Plan 和 Act 交替执行，形成明确的批次循环：

```
Plan（产出一批 Edge）
  → Executor 并行执行所有 Edge
  → 全部 Edge 结果后
  → Plan（产出下一批 Edge）
  → ...
```

- Plan 仅在当前批次所有 Edge 均已结果后触发（`json_array_length(to_node_ids) > 0`）。新增 Node 不打断当前 batch——新信息等下一轮 Plan 才被看见。
- Act 在同一批次内并行执行，每条 Act 只执行一条 Edge
- Plan 综合全图判断是否完成——渗透测试没有明确的终止信号，需要全局视角判定

**已知约束：** 批次循环中一条 Edge 耗时过长会阻塞整个批次。通过 prompt 限制单次任务范围来缓解，超时后产出部分结果作为新 Node，Plan 在下一轮发现未完成的工作继续推进。

### Act 返回 JSON Schema

```json
{
  "description": "Act 的产出结论（客观信息，写入 Node 的 description）"
}
```

| 字段        | 类型    | 必填 | 说明                                    |
| ----------- | ------- | ---- | --------------------------------------- |
| description | string  | 是   | 产出的客观信息，写入 Node 的 description |

### Plan 返回 JSON Schema

```json
{
  "edges": [
    {
      "from_node_ids": [1, 3],
      "direction_description": "尝试 SQL 注入登录表单"
    }
  ],
  "complete": false
}
```

| 字段     | 类型     | 必填 | 说明                                                         |
| -------- | -------- | ---- | ------------------------------------------------------------ |
| edges    | Edge[]   | 是   | 新的探索方向（空数组即无新方向）。`complete: true` 时必须为空数组 |
| complete | boolean  | 否   | 默认 false；为 true 时项目完成                               |
| summary  | string   | 条件 | 仅 `complete: true` 时填写，说明判定完成的依据；`complete: false` 时忽略 |
| evidence_node_ids | number[] | 条件 | 仅 `complete: true` 时填写，判定完成所依据的 Node ID 列表 |

三种语义：
- `complete: true`（edges 必须为空）→ 项目进入 `completed`，`summary` 记录判定完成的依据，`evidence_node_ids` 记录依据的 Node
- `edges: []` + `complete: false` → 项目进入 `failed`，等待人类介入
- `edges: [...]` + `complete: false` → 继续保持 `active`，继续探索

**Snapshot 截断：** Plan 和 Act 均以全图 snapshot 为输入。当图规模超过配置阈值（默认 `SNAPSHOT_MAX_NODES = 100`、`SNAPSHOT_MAX_EDGES = 200`）时，Executor 渲染 snapshot 前截断：保留全部 `human` Node，按 `created_at` 倒序保留最近的 `agent` 和 `system` Node 直至上限，仅保留两端 Node 均被保留的 Edge。未结果 Edge（`to_node_ids` 为空数组）永不截断——当前批次尚未执行的 Edge 必须保留，否则 Plan 和 Act 无法工作。截断在 prompt 中通知 Agent，不在 JSON 中标记。

> **未来展望：Agent 摘要压缩。** 截断丢弃早期 Node 会损失全局上下文。一种更优雅的方案：当图接近阈值时，触发一个特殊 Act，将一批早期零碎 Node 压缩为一个高密度摘要 Node（如 "前期探测摘要：开放了 22/80/443 端口，Apache 2.4.49 存在 CVE-2021-41773，/admin 路径可访问…"）。摘要 Node 替换原 Node 集，被删 Node 的入边重定向至摘要 Node，出边由此出发的 Edge 以摘要 Node 为 `from_node_ids`。压缩由 Agent 执行，质量由 Agent 保证——错误摘要可在后续轮次被图自行矫正。先不实现，留作扩展点。

### 全图 snapshot 格式

```json
{
  "nodes": [
    { "id": 1, "description": "目标: 拿到 flag", "created_by": "human" },
    { "id": 2, "description": "80 端口开放 (Apache 2.4.49)", "created_by": "agent", "edge_id": 1 },
    { "id": 3, "description": "查找 exp：运行超时 3 次", "created_by": "system" }
  ],
  "edges": [
    { "id": 1, "from_node_ids": [1], "to_node_ids": [2], "direction_description": "扫描端口" },
    { "id": 2, "from_node_ids": [2], "to_node_ids": [], "direction_description": "利用 Apache 漏洞" },
    { "id": 3, "from_node_ids": [2], "to_node_ids": [3], "direction_description": "查找 exp", "failure_count": 3 }
  ]
}
```

Plan 和 Act 均接收此结构的 JSON。对比自然语言渲染，JSON 使 Agent 精确引用 Node/Edge ID，prompt 模板只需填空。

### Edge 选取与执行

Executor 从图中选取未结果的 Edge 执行 Act。每条 Act 只执行一条 Edge。选取时原子写入 `claimed_at` 时间戳，防止多个 Act 重复执行同一条 Edge。

**选取（原子）：**

```sql
UPDATE edges SET claimed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE project_id = ? AND id = (
  SELECT id FROM edges
  WHERE project_id = ? AND json_array_length(to_node_ids) = 0 AND failure_count < ?
    AND (claimed_at IS NULL OR claimed_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes'))
  ORDER BY created_at LIMIT 1
)
RETURNING *;
```

SQLite 写锁保证并发安全——两个 Act 同时执行此 UPDATE 时，只有一个成功，另一个返回 0 row，重新查询下一条。`claimed_at` 超过 30 分钟视为过期，可被重新选取。

**写回（成功）：**

```sql
UPDATE edges SET to_node_ids = json_array(?) WHERE project_id = ? AND id = ? AND json_array_length(to_node_ids) = 0;
```

**写回（失败）：**

```sql
UPDATE edges SET failure_count = failure_count + 1, claimed_at = NULL WHERE project_id = ? AND id = ?;
```

失败后重置 `claimed_at`，允许其他 Act 重试。

**并发 Act：** 同一项目可有多个 Act 并行执行不同 Edge。同一 Edge 不会被两个 Act 重复选取。并发上限可配置，超出的未选取 Edge 等待前序 Act 完成后释放槽位。

**当前约束：** 1 个 Act 只执行 1 条 Edge，返回 1 个 Node。`to_node_ids` 设计为数组则为未来保留了扩展可能性——多个 Act 写入同一条 Edge（需调整调度模型），或单次 Act 返回多个 Node（需调整 JSON Schema）。

### 超时策略

- **Plan**：单阶段。超时后进程被 SIGTERM，已捕获的 stdout 保留用于日志诊断。超时、非法 JSON、缺必填字段均视为一次失败——不写图，不更新 `last_plan_at`，`Project.failure_count +1`。主循环继续轮询，因触发条件仍满足（`last_plan_at` 未变），下一轮自然重试 Plan。连续失败达阈值（默认 3）后项目进入 `failed`——Plan 无法推进。
- **Act**：双阶段。第一阶段执行任务；若超时，进程被 SIGTERM，已捕获的 stdout（含 sessionID 和中间输出）保留，进入第二阶段——conclude 收尾。Conclude 通过 session 复用同一对话历史：Agent CLI 启动后第一条 JSON 输出即包含 sessionID，Executor 从捕获的 stdout 首行解析该 ID。Conclude 阶段以 `-s <sessionID>` 参数启动同一 session，Agent 在完整上下文中执行收尾指令；conclude 也超时则进程被 SIGTERM，执行失败写回（failure_count +1, claimed_at = NULL）。

**Act 双阶段执行流程（以 OpenCode 为例）：**

```
阶段一（执行）:
  opencode run -p "<任务指令>" --format json
    │
    ├── 第一条输出 → {"type":"step_start", "sessionID":"ses_xxx", ...}
    │   （step_start 事件在 session 创建后立即输出，发生在任何 LLM 调用之前）
    ├── 后续输出   → {"type":"text", "part":{"text":"..."}}
    └── 最后输出   → {"type":"step_finish", ...}
    │
   ← 超时 / 进程被杀死 →
    │
阶段二（总结）:
  opencode run -p "<总结指令>" --format json -s ses_xxx
    │
    Agent 加载同一对话历史，在完整上下文基础上执行总结
```

Executor 从 stdout 首行 JSON 提取 `sessionID`，超时时使用该 ID 恢复 session。不同 Agent CLI 的 session 机制由 Driver 适配层统一封装。

**超时产出部分结果的流程：**

```
Act 超时
  → conclude 产出部分结果 Node
  → Edge 的 to_node_ids 包含部分结果 Node
  → 下一轮 Plan 看到部分结果，判断是否需要继续
  → 如需继续：从部分结果 Node 创建新 Edge，继续探索
  → 如已足够：直接产出最终结论
```

超时不会阻塞批次——conclude 产出的 Node 作为该 Edge 的结果，批次循环继续。未完成的工作由 Plan 在后续轮次通过新 Edge 接续。

### 失败处理

Edge 增加 `failure_count` 字段。每次 Act 失败（非法 JSON、缺必填字段、conclude 失败）时执行失败处理。以下操作在同一事务中原子执行——主循环看不到中间状态：

```sql
-- 1. 递增失败计数，释放选取
UPDATE edges SET failure_count = failure_count + 1, claimed_at = NULL WHERE project_id = ? AND id = ?;

-- 2. 检查是否达到阈值
SELECT failure_count FROM edges WHERE project_id = ? AND id = ?;

-- 3. 达到阈值：创建系统 Node，写回 to_node_ids
INSERT INTO nodes (project_id, description, created_by, edge_id)
VALUES (?, '运行超时 N 次', 'system', ?);
UPDATE edges SET to_node_ids = json_array(last_insert_rowid())
WHERE project_id = ? AND id = ? AND json_array_length(to_node_ids) = 0;
```

未达阈值时只执行步骤 1，Edge 保持可选取状态，主循环自然重试。达到阈值时三个步骤原子完成——Edge 立即变为已结果，主循环不会在中间状态选取它。死胡同 Edge 永存图中——失败 Node 让下一轮 Plan 理解原因而非只能看到一个数字。

### 错误应对

**核心原则：验证结构，不验证语义。** 系统校验 JSON 格式和必填字段；不判定结论是否正确——错误结论由图的后续生长自行纠正。`from_node_ids` 引用不存在的 Node ID 时系统不拦截——Agent 返回的引用由可视化渲染和后续 Agent 自行处理，图无法自愈的引用损坏是可接受的退化。

| 场景              | 处理                                                         |
| ----------------- | ------------------------------------------------------------ |
| Agent 返回非法 JSON | 执行失败写回（failure_count +1, claimed_at = NULL），由主循环在下一轮重试，达阈值后创建失败 Node |
| Agent 返回合法 JSON 但缺必填字段 | 同上                                     |
| Plan 返回非法 JSON | `Project.failure_count +1`；未达阈值（默认 3）则下一轮循环重试，达阈值则项目进入 `failed` |
| Plan 返回合法 JSON 但缺必填字段 | 同上                                     |
| Plan 返回零条 Edge 且 complete 为 false | 项目进入 `failed`，Executor 停止调度。人类通过 push 补充 Node 后继续 |
| Plan 返回 complete 为 true 但缺 summary 或 evidence_node_ids | 同上（视为缺必填字段）        |
| Plan 返回 complete 为 true 但 edges 非空 | 同上（视为非法组合）                      |
| Plan 返回 complete 为 true 且 summary、evidence_node_ids 非空 | 项目完成，状态变为 completed，summary 和 evidence_node_ids 写入项目元数据 |
| Act 一阶段超时     | 进程被 SIGTERM，已捕获 stdout 保留；进入 conclude 收尾（同一 session 追加"停止探索，总结已有成果"提示）；conclude 成功则写 Node 作为 Edge 结果 |
| Act 二阶段（conclude）超时 | 进程被 SIGTERM；执行失败写回（failure_count +1, claimed_at = NULL）                                                             |
| Plan 超时          | 进程被 SIGTERM；`Project.failure_count +1`；未达阈值则下一轮循环重试，达阈值则项目进入 `failed`                      |
| 数据库写入失败     | 记录错误日志，Executor 静默等待                    |
| 容器启动失败       | 执行失败写回（failure_count +1, claimed_at = NULL），立即重试 |
| Executor 崩溃     | 遗留 claimed_at 因超过 30 分钟过期，可被重新选取；写回被 `json_array_length(to_node_ids) = 0` 检查拦截 |
| Executor 在 Plan 写入事务中崩溃 | 事务回滚，图保持崩溃前状态；`last_plan_at` 为旧值，主循环按原有逻辑重试 |

---

## Executor 端点（Web 服务器）

Executor 内置 Web 服务器，提供 HTTP API 供 UI 和人类调用。浏览器无法直接连接 SQLite，HTTP 是 UI 与 Executor 通信的必要协议。API 设计为单机本地访问，不内置鉴权——如需远程访问由反向代理（nginx/Caddy）提供 TLS 和认证。

```
POST /projects/                    — 创建项目（含用户输入描述与 Agent 类型，形成第一个 Node）
GET  /projects                     — 项目列表（含 Node 数、Edge 总数、未结果的 Edge 数）
GET  /projects/{id}                — 单个项目详情（含 Node 列表、Edge 列表、summary、evidence_node_ids）
POST /projects/{id}/stop           — 暂停项目（active → stopped）
POST /projects/{id}/push           — 推进项目（可选附带 Node 信息；stopped / completed / failed → active，active 时不中断）
GET  /projects/{id}/edges          — Edge 状态列表（从 to_node_ids、claimed_at、failure_count 推导）
```

项目状态：`active`（调度中）、`completed`（Plan 判定完成）、`failed`（Plan 返回零条 Edge 且未判定完成）、`stopped`（人工暂停）。非 active 状态下 Executor 不再选取新 Edge、不触发 Plan。stop 后正在执行的 Act 继续运行，完成后正常写回 Node，但不检查触发条件、不启动新的 Act。所有正在执行的 Act 完成后，Executor 停止容器。push 将非 active 状态恢复为 active（已为 active 时不中断），重启容器后主循环自然接管——检查未结果 Edge 和 Plan 触发条件。

### GET /projects/{id}/edges

返回该项目所有 Edge 的状态列表。每条 Edge 的状态由数据库字段推导：

| 状态   | 条件                                                               |
| ------ | ------------------------------------------------------------------ |
| 待处理 | `json_array_length(to_node_ids) = 0 AND failure_count < 阈值 AND claimed_at IS NULL` |
| 执行中 | `claimed_at IS NOT NULL AND json_array_length(to_node_ids) = 0`                      |
| 已完成 | `json_array_length(to_node_ids) > 0`                                             |

`json_array_length(to_node_ids) > 0` 的 Edge 即为"已结果"。执行中的 Edge 不阻塞其他 Edge 的选取。

### POST /projects/

创建项目，写入首个 Node（`id: 1`，`created_by: human`），记录 `agent_type` 与 `image_tag`，项目状态为 active。创建后立即触发首次 Plan。

### POST /projects/{id}/push

推进项目。请求体可选附带 Node 信息：

```json
{
  "nodes": [
    { "description": "发现新的攻击面" },
    { "description": "目标换了端口" }
  ]
}
```

| 字段   | 类型     | 必填 | 说明                               |
| ------ | -------- | ---- | ---------------------------------- |
| nodes  | Node[]   | 否   | 要创建的 Node 列表（空数组或不传则不创建） |

行为：
1. 若传入 `nodes`，遍历创建 Node（`created_by: human`, `edge_id: null`）；`description` 缺失或为空字符串的条目跳过，不中断整体流程
2. 清空 `Project.summary` 和 `Project.evidence_node_ids`，`Project.failure_count` 重置为 0
3. 若项目为 `stopped` / `completed` / `failed`，恢复为 `active`，`last_plan_at` 置为 `NULL`，重启容器
4. 若项目已为 `active`，不中断当前处理——Node 在当前 batch 完成后被下一轮 Plan 看到
5. 不手动触发 Plan、不手动处理 Edge——主循环自然驱动（有未结果 Edge 先执行 Act，Edge 为 0 后触发 Plan）

无返回体，人类通过前端观察项目状态和图的变化。

### 项目完成后纠错

项目完成（`completed`）或进入 `failed` 后若需继续推进，人类通过 `POST /projects/{id}/push` 传入纠错 Node，项目恢复为 `active`，主循环自动触发 Plan。

---

## 数据模型

### Project

| 字段          | 类型      | 说明                                                |
| ------------- | --------- | --------------------------------------------------- |
| id            | text      | 主键                                                |
| title         | text      | 从第一个 Node 的 description 截取或用户命名          |
| status        | text      | `active` \| `completed` \| `failed` \| `stopped`                 |
| agent_type    | text      | Agent 类型（如 `opencode`），创建时确定，不可变更     |
| image_tag     | text      | 完整镜像 tag（如 `opencode:v1.2.0`），创建时锁定       |
| last_plan_at  | timestamp | 最近一次成功 Plan 的时间。NULL 表示从未成功 Plan 过  |
| failure_count | integer   | Plan 连续失败次数（超时 / 非法 JSON / 缺必填字段），成功后重置为 0，push 时重置为 0 |
| summary       | text      | Plan 判定完成时的自然语言依据（`complete: true` 时写入），NULL 表示未完成 |
| evidence_node_ids | text  | JSON 数组，如 `[1, 2, 5]`，判定完成所依据的 Node ID（`complete: true` 时写入），NULL 表示未完成 |
| created_at    | timestamp |                                                  |
| updated_at    | timestamp |                                                  |

### Node

| 字段        | 类型      | 说明                                            |
| ----------- | --------- | ----------------------------------------------- |
| project_id  | text      | 所属项目，联合主键                              |
| id          | integer   | 项目内自增，联合主键                            |
| description | text      | 客观信息内容                                    |
| created_by  | text      | `human` \| `agent` \| `system`                  |
| edge_id     | integer    | 产出此 Node 的 Edge 的 id（与 project_id 共同定位，Edge 主键为 (project_id, id)）；人类直接创建时为 null |
| created_at  | timestamp |                                                 |

主键：`(project_id, id)`。`id` 在项目内从 1 自增，定位 Node 需要 `(project_id, id)` 二元组。

### Edge

| 字段                   | 类型      | 说明                                                         |
| ---------------------- | --------- | ------------------------------------------------------------ |
| project_id             | text      | 所属项目，联合主键                                          |
| id                     | integer   | 项目内自增，联合主键                                        |
| from_node_ids | text      | JSON 数组，如 `[1, 3]`，出发节点（一个或多个，多源时为 AND 语义；允许空数组，表示 Agent 未依据特定已有信息的灵光一闪），通过 JSON1 函数读写 |
| to_node_ids           | text      | 结果 Node ID 数组 JSON，如 `[3]` 或 `[3, 5]`；空数组 `[]` 表示未结果，通过 `json_array()` 写入、`json_array_length()` 判空。初始值为 `'[]'` |
| claimed_at             | timestamp | 被选取执行的时间（null 表示未被选取）                         |
| direction_description  | text      | Plan 产出的探索方向描述                                        |
| failure_count          | integer   | 失败次数（默认 0），达阈值时创建系统 Node，Edge 自然结果     |
| created_at             | timestamp |                                                              |

主键：`(project_id, id)`。`id` 在项目内从 1 自增，定位 Edge 需要 `(project_id, id)` 二元组。

Node 只增不改、不设软删除。Edge 的 `claimed_at` 在选取时写入时间戳（成功写回后自然无关，失败写回时置 null），`to_node_ids` 初始值为 `'[]'`，通过 `json_array()` 写入结果、`json_array_length()` 判空，`failure_count` 全局累加、不随重试重置——不同 Act 是同一 Agent 的不同进程，累加计数反映该 Agent 对该方向的持续失败。`failure_count` 达到配置阈值（默认 3）时创建失败 Node 并写回 `to_node_ids`，不再阻塞批次循环。

Act 执行完成后写回 Node。两步在同一 `BEGIN IMMEDIATE` 事务中原子执行：

```sql
BEGIN IMMEDIATE;
INSERT INTO nodes (project_id, description, created_by, edge_id) VALUES (?, ?, 'agent', ?);
UPDATE edges SET to_node_ids = json_array(last_insert_rowid())
WHERE project_id = ? AND id = ? AND json_array_length(to_node_ids) = 0;
COMMIT;
```

`UPDATE` 的 `json_array_length(to_node_ids) = 0` 检查作为兜底——若 Edge 因 `claimed_at` 过期被重新分配给另一 Act，UPDATE 返回 0 行，事务回滚，不留孤儿 Node。正常流程中不会触发此竞争。

### ID 生成

所有 ID 由数据库统一分配，项目内自增，Node 和 Edge 各自独立计数。主键为 `(project_id, id)` 联合主键，`id` 在项目内从 1 开始：

| 实体       | 生成时机                                      | 规则                                       |
| ---------- | --------------------------------------------- | ------------------------------------------ |
| Project ID | 创建项目                                      | 自增，`INTEGER PRIMARY KEY`                                    |
| 首个 Node  | 创建项目时                                     | 固定 `(project_id, 1)`                     |
| Edge       | Plan 完成后批量插入                             | 顺序分配 `(project_id, 1)`, `(project_id, 2)`... |
| 后续 Node  | Act 写回或人类创建                             | 顺序分配 `(project_id, 2)`, `(project_id, 3)`... |

**并发安全：** Node 和 Edge 的 INSERT 使用 `BEGIN IMMEDIATE` 事务，事务内先 `SELECT COALESCE(MAX(id), 0) + 1` 再 INSERT。写锁保证同一项目的并发 INSERT 不会分配到相同 `id`，不同项目的 INSERT 互不阻塞。

---

## 主循环

Executor 主循环每秒轮询每个 `active` 项目。每轮对每个项目按以下优先级执行一个动作：

1. **Plan 正在执行** → 跳过，等下一轮
2. **应触发 Plan** → 异步启动 Plan，本轮结束
3. **有未结果 Edge 且并发槽位空闲** → 选取 Edge，启动 Act

### Plan 触发条件

主循环每轮检查两个条件，任一满足即触发 Plan（异步执行，不阻塞循环）。Plan 成功完成时更新 `last_plan_at`，超时或失败时不更新：

1. **`last_plan_at IS NULL` 且未结果 Edge 数为 0** — Plan 从未成功，需要触发
2. **`last_plan_at IS NOT NULL` 且未结果 Edge 数为 0 且存在 `created_at > last_plan_at` 的 Node** — 有新信息需重新评估

push 恢复非 active 项目时将 `last_plan_at` 置为 `NULL`，由条件 1 接管——若已有未结果 Edge 暂不触发，等 Act 跑完 Edge 归零后自然满足。项目已为 active 时 push 不修改 `last_plan_at`：Push Node 写入后，当前批次 Act 继续执行（Plan snapshot 已渲染完毕），下一轮 Plan 被 Act 产出 Node 触发条件 2 时，Push Node 已存在于图中，Plan snapshot 自然包含它。

**Plan 写入原子性：** Plan 返回的验证通过 → INSERT 所有 Edge 行 → UPDATE `last_plan_at` 三步在同一 `BEGIN IMMEDIATE` 事务中原子执行。事务中任意写入失败则整体回滚，图保持触发前状态——`last_plan_at` 为旧值，主循环按原有逻辑重试。

### Edge 选取

主循环每轮检查：项目为 `active`、有未结果的 Edge、并发 Act 数未达上限。满足时原子选取一条 Edge 并启动 Act。Act 完成/失败后，下一轮循环自然发现空闲槽位或可重试的 Edge。

### 并发上限

同时运行的 Act 数量可配置。主循环每轮只启动一条 Act，自然串行地填满槽位——无需事件通知机制。

---

## 执行流程

```
项目创建
  → 写入首个 Node（1）
  → Executor 检测：last_plan_at IS NULL，未结果 Edge 数为 0 → 触发首次 Plan
  → Plan 产出 Edge 1, 2, 3（全部 to_node_ids 为空数组）
  → Executor 检测：有未结果 Edge → 并行执行 Act
  → Edge 1 完成 → Node 2，Edge 2 完成 → Node 3，Edge 3 超时 → conclude → Node 4（部分结果）
  → Executor 检测：所有 Edge 已结果 → 触发 Plan
  → Plan 看到 Node 4 是部分结果，判断需继续 → 产出 Edge 4（从 Node 4 出发）
  → ...
   → Plan 判断全图已足够 → complete: true → 项目状态 → completed
```

---

## 容器模型

### 镜像策略

以 [Kali](https://www.kali.org/) 官方镜像为基础，每种 Agent 在其上叠加运行时依赖，生成独立的 Agent 镜像。安全工具（nmap、sqlmap、gobuster 等）由 Kali 镜像直接提供，Methodos 不维护工具清单。

```
kali:latest
├── opencode 镜像      ← + Node.js/npm + OpenCode CLI
└── claude-code 镜像   ← + Node.js/npm + Claude Code CLI
```

每种 Agent 一个 Dockerfile，存放在 `methodos/docker/` 下。镜像由 Methodos 构建和配置，确保 Agent CLI 符合 Methodos 的调用契约（接收 prompt 文件路径 → stdout 输出结构化 JSON）。不存在使用第三方镜像的情形。

镜像使用语义化版本 tag（如 `opencode:v1.2.0`），项目创建时锁定。不得使用 `latest`——跨天执行的项目需保证环境一致。`latest` 仅用于开发阶段。

### 容器生命周期

每个项目一个独立容器实例，创建项目时人为指定所用 Agent，Executor 据此选取对应镜像启动容器。Plan 和 Act 共用同一容器（同一 Agent，仅 prompt 不同），并发 Act 在同一容器中通过 `docker exec` 并行执行，每次 Act 分配独立工作目录以避免并发文件冲突。**约束：** 项目生命周期内 Agent 类型不可变更——镜像在项目创建时确定，Plan 和 Act 始终使用同一 Agent。

容器生命周期与项目生命周期绑定——创建项目时启动容器，容器只有运行和停止两种状态。项目进入 `completed`、`failed` 或 `stopped` 时容器停止（`docker stop`），push 恢复时重新启动（`docker start`）。容器不会被销毁——停止后容器文件系统自然保留，供后续调试和审计。

容器命名规则：`methodos-<project_id>`。Executor 重启后通过容器名称发现已有容器——`docker ps -a --filter name=methodos-<id>` 查找 → 存在则 `docker start`，不存在则从 `image_tag` 字段指定的镜像创建。容器 ID 不持久化，名称即唯一标识。

容器网络模式可配置，默认 `bridge`；渗透测试需访问外网时可切换为 `host`。

Agent 类型与镜像 tag 存储在 Project 表的 `agent_type`、`image_tag` 字段中。Executor 配置中维护静态映射表（如 `{ "opencode": "opencode:v1.2.0", "claude-code": "claude-code:v2.0.0" }`），项目创建时查表确定 `image_tag` 后锁定写入，此后不可变更。Executor 从 Project 行直接读取这两个字段完成容器启动和 Driver 实例化，无需额外的运行时映射存储。

### 工作区布局

```
/home/kali/workspace/
├── task_<edge_id>/    ← docker exec -w 指向此目录
│   ├── scan_results.txt
│   ├── exploit.py
│   └── hash.txt
└── task_<edge_id>/
    └── credentials.txt
```

每条 Act 分配独立 `task_<edge_id>/` 子目录，`docker exec -w` 的工作目录设为该目录。Act prompt 中告知 Agent 当前工作目录路径；Plan prompt 中告知 workspace 根路径（`/home/kali/workspace/`），Agent 通过 Node description 中的文件路径引用读取各 Edge 的产出文件，以辅助决策。workspace 位于容器内部，停止后容器文件系统保留，跨项目生命周期持久化。

**图存语义，文件系统存细节。** Node description 存放结论摘要和重要文件路径，原始数据（扫端口全量输出、sqlmap 日志等）保留在工作目录中。后续 Agent 通过 Node description 中的路径引用读取文件。端口冲突由 Agent 自行处理——渗透测试中人也会撞端口，换一个即可。

---

## Agent 交互模型

Agent 是独立进程，在任务容器内运行。它接收渲染好的 prompt，执行后返回结构化 JSON。

Agent 不直接访问数据库。它只做一件事：读 prompt，出结果。

Plan 和 Act 使用同一 Agent，仅 prompt 模板不同。Plan prompt 侧重「基于全图判断下一步探索方向」，Act prompt 侧重「沿指定方向执行探索并产出结论」。Plan prompt 中明确告知 Agent：仅当判定任务完成时才返回 `complete: true` 并附带 `summary` 和 `evidence_node_ids`，未完成时不要返回这两个字段；`complete: true` 时 `edges` 必须为空数组。当图被截断时，prompt 中附加提示："注意：图中部分早期 Node 和 Edge 已被省略，当前 snapshot 不包含完整历史。"prompt 中同时约束：Node description 只放结论摘要和文件路径（不超过 500 字符），大量原始数据写入文件，description 中用路径引用。支持的 Agent CLI 可替换（OpenCode、Claude Code、Codex 等），通过 Driver 适配层统一接口。

---

## 可观测性

三层日志，各自独立：

1. **数据库事件**：Node 创建、Edge 创建、Edge.to 更新、Edge claim（claimed_at 写入/清除）、项目状态变化。结构化、可查询。
2. **Executor 任务记录**：每次 Plan/Act 的项目、Agent、耗时、结果。
3. **Agent 会话日志**：Agent CLI 的完整 session 文件，按 `项目ID/任务ID/` 组织，原文件保留。

三层叠加即可覆盖调试、审计、报告撰写等需求。

---

## 可视化界面

提供人类可读的 Web 界面，由 Executor 内置 Web 服务器提供。

### 总览页

项目列表，每行展示：标题、状态、Node 数、未结果的 Edge 数、当前执行中的 Edge 数。可对项目执行 stop / push。

### 项目详情页

**图视图**：Node 和 Edge 根据产生来源分色——`system` 红色（失败），`human` 蓝色（人工介入），`agent` 绿色（探索产出）。Edge 的颜色从 `to_node_ids` 指向的 Node 推导（多 Node 时取最高优先级：system > human > agent），未结果的 Edge 用虚线。点击节点或边查看详情。项目完成时，图视图上方展示 `summary`，`evidence_node_ids` 中的 Node 在图上高亮显示。

### 可用操作

- 创建新项目（填写描述，选择 Agent 类型）
- 推进项目（可选附带 Node 信息），调用 `POST /projects/{id}/push`
- Stop 项目

图形渲染使用现有 DAG 可视化库，数据全部来自 Executor API，UI 本身不存储任何状态。

---

## 设计原则

- **Agent 不接触协议。** Agent 只接收 prompt，返回结构化 JSON。数据库访问、并发控制、超时管理均由 Executor 负责。
- **间接协调。** Agent 之间不直接通信，通过共享图间接协调。
- **图是唯一真相源。** 所有探索结果和策略信息均在图中，不存在外挂的标注或类型标记。Edge 的 `to_node_ids`、`claimed_at`、`failure_count` 是执行状态的唯一记录。`to_node_ids` 和 `from_node_ids` 均通过 SQLite JSON1 函数读写（`json_array()`、`json_array_length()`），`to_node_ids` 统一使用数组表示——空数组 `[]` 为未结果，非空数组为已结果。唯一例外：`Project.summary` 存储 Plan 判定完成的依据，属于项目级元数据而非探索产出，不纳入图结构。
- **概念最小化。** 两个概念（Node、Edge）、两类任务（Plan、Act）、两层架构（SQLite + Executor）。

---

## 技术选型

### 运行时与工具链

| 项 | 选型 | 说明 |
|---|---|---|
| 运行时 | Node.js 24 LTS（Krypton） | Active LTS，支持至 2028.4 |
| 语言 | TypeScript 5，strict 模式 | 类型兜底，AI 训练数据密度最高 |
| 包管理 | pnpm | 快，AI 熟悉 |
| 开发运行 | tsx | 零配置执行 TypeScript |
| 测试 | vitest 4 | 行业标准，Jest 兼容 API |

### 数据层

| 项 | 选型 | 说明 |
|---|---|---|
| SQLite 驱动 | better-sqlite3 12 | 同步 API，匹配单线程架构，WAL 模式 |
| Schema | drizzle-orm 0.45+ | schema 定义即 TypeScript 类型；JSON 列通过 `text('col', { mode: 'json' })` 支持 SQLite JSON1 函数 |
| Migration | drizzle-kit | `push`（开发）/ `generate` + `migrate`（生产） |
| 原子选取 Edge | raw SQL prepared statement | `UPDATE ... RETURNING *` 超出 drizzle 查询能力，使用 better-sqlite3 raw API |

### HTTP & API

| 项 | 选型 | 说明 |
|---|---|---|
| 框架 | Fastify 5 | Promise-native，Schema-first |
| 校验 | Zod 4 + `fastify-type-provider-zod` | 自动推导 TS 类型；Plan/Act JSON 输出亦用 Zod 校验 |
| 静态文件 | `@fastify/static` | 服务 Web UI（`static/`）及离线 vendor 依赖（`static/vendor/`） |

### Docker 管理

| 项 | 选型 | 说明 |
|---|---|---|
| 容器生命周期 | dockerode 5 | Node.js Docker 客户端，直接映射 Engine API |
| 命令执行 | `child_process.execFile` + `docker exec` | 超时用 `AbortController`，stdout 流式捕获 |
| 并发控制 | `Promise.all` + `AbortSignal.timeout()` | 每 Act 一个独立 Promise |

### Agent Driver 接口

Agent CLI 通过 Driver 适配层统一调用。不同 Agent 实现相同接口，新增 Agent 类型时只加实现类。

```typescript
interface AgentOutput {
  description: string;  // Act 产出，写入 Node.description
}

interface PlanOutput {
  edges: {
    from_node_ids: number[];
    direction_description: string;
  }[];
  complete: boolean;
  summary?: string;  // complete: true 时必填，记录判定完成的依据
  evidence_node_ids?: number[];  // complete: true 时必填，判定完成所依据的 Node ID
}

interface ActResult {
  output: AgentOutput;   // Act 产出
  sessionId: string;     // Agent CLI 会话 ID，用于超时后 conclude 恢复
}

interface AgentDriver {
  executeAct(params: {
    prompt: string;
    workdir: string;
    timeout: number;
  }): Promise<ActResult>;

  executePlan(params: {
    prompt: string;
    workdir: string;
    timeout: number;
  }): Promise<PlanOutput>;

  conclude(params: {
    sessionId: string;
    prompt: string;
    workdir: string;
    timeout: number;
  }): Promise<AgentOutput>;
}
```

`workdir` 传入 Driver 后用于 CLI 参数（如 `opencode run --dir <workdir>` / `docker exec -w <workdir>`），同时 Executor 渲染 prompt 时也已嵌入工作目录路径（如 `当前工作目录：/home/kali/workspace/task_3/`），Agent 从 prompt 中获知自身所在位置后直接读写文件。`prompt` 参数为文件路径——Executor 先将渲染好的 prompt 写入容器内工作目录下的文件（Act 对应 `task_<edge_id>/prompt.md`，Plan 对应 workspace 根目录），再将文件路径传入 Driver。

Driver 实例化时绑定项目容器的具体 Agent CLI 路径和默认参数（如 `--format json`）。OpenCodeDriver 需额外管理 sessionID 提取（从 stdout 首行 JSON），ClaudeCodeDriver 等按各自协议实现。

### 前端（Web UI）

| 项 | 选型 | 说明 |
|---|---|---|
| 图可视化 | Cytoscape.js 3 + **dagre** | 分层布局 `dagre_tb`，天然匹配因果 DAG 的时间流 |
| 交互 | **HTMX 2** + **Alpine.js** | HTMX 管服务端通信（表行刷新、页面跳转），Alpine 管纯客户端交互（图节点选中、侧面板切换、模态框、表单态） |
| 样式 | **Tailwind CSS** + CLI 构建步 | utility class 模式匹配图可视化的密集微调需求；构建步仅一条 `npx` 命令，产出单 `output.css` |
| 加载方式 | CDN（HTMX + Alpine + Cytoscape.js + dagre） | 离线部署时下载至 `static/vendor/`，引用本地路径 |
| 图渲染逻辑 | 原生 ES module JS | 量极少，仅初始化 Cytoscape.js 并绑定点击事件 |

### 日志与配置

| 项 | 选型 | 说明 |
|---|---|---|
| 结构化日志 | pino 10 | JSON 行输出，Node.js TSC 维护 |
| 配置 | TypeScript config object + `.env`（Node 24 内置 `--env-file`） | 无第三方配置库 |
| Snapshot 限制 | `SNAPSHOT_MAX_NODES`（默认 100）、`SNAPSHOT_MAX_EDGES`（默认 200） | 可配置，超限时截断早期 Node/Edge |

### 部署

开发阶段 `tsx src/executor/main.ts` 直接运行。生产环境使用 Node.js SEA（`--build-sea`）打包为单二进制可执行文件——该特性在 Node 24+ 已稳定。SEA 限制（仅 CJS 入口、静态资源需注入）不影响核心逻辑，部署时按需适配。
- **批次驱动。** Plan 在当前批次所有 Edge 完成后触发，形成明确的 Plan → Act 全部完成 → Plan 循环。超时产出部分结果，不阻塞批次。
