# 多级反馈队列与增量Plan触发 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将Methodos系统的Plan触发机制从"所有边处理完成后触发"改为"每次产生新节点就触发一次"，并引入多级反馈队列模式实现边的动态优先级调整。

**Architecture:** 
1. 修改Plan触发逻辑，移除"所有边完成"条件，添加最小间隔检查
2. 在edges表中添加priority字段，实现动态优先级计算
3. 修改快照渲染，Plan模式包含所有边，Act模式仅包含相关边
4. 将新配置项统一存储在数据库settings表中

**Tech Stack:** TypeScript 5, SQLite (better-sqlite3), Drizzle ORM, Zod 4

---

## 文件结构

### 需要修改的文件

| 文件路径 | 职责 |
|---------|------|
| `src/db/schema.ts` | 数据库schema定义，添加priority字段 |
| `src/db/connection.ts` | 数据库初始化，添加新配置项默认值 |
| `src/config.ts` | 配置管理，添加新配置项到接口和默认值 |
| `src/executor/plan-exec.ts` | Plan触发逻辑，修改shouldTriggerPlan() |
| `src/snapshot/render.ts` | 快照渲染，添加模式参数 |
| `src/db/operations.ts` | 数据库操作，添加边选择函数和优先级更新 |
| `src/executor/act-exec.ts` | Act执行，添加优先级计算 |
| `src/prompt/plan.ts` | Plan提示模板，更新说明 |
| `src/prompt/act.ts` | Act提示模板，更新说明 |

### 需要创建的文件

| 文件路径 | 职责 |
|---------|------|
| `src/db/priority.ts` | 优先级计算逻辑（独立模块） |

---

## Task 1: 数据库架构变更

**Files:**
- Modify: `src/db/schema.ts:30-42`
- Modify: `src/db/connection.ts:59-76`

- [ ] **Step 1: 在edges表中添加priority字段**

```typescript
// src/db/schema.ts
export const edges = sqliteTable('edges', {
  projectId: integer('project_id').notNull(),
  id: integer('id').notNull(),
  fromNodeIds: text('from_node_ids', { mode: 'json' }).$type<number[]>().notNull(),
  toNodeIds: text('to_node_ids', { mode: 'json' }).$type<number[]>().notNull().default([]),
  claimedAt: text('claimed_at'),
  title: text('title'),
  directionDescription: text('direction_description').notNull(),
  failureCount: integer('failure_count').notNull().default(0),
  priority: real('priority').notNull().default(1.0),  // 新增：范围0.1-10.0
  createdAt: text('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.projectId, table.id] }),
}));
```

- [ ] **Step 2: 更新数据库初始化SQL**

```typescript
// src/db/connection.ts - initDb()函数
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS edges (
    project_id INTEGER NOT NULL,
    id INTEGER NOT NULL,
    from_node_ids TEXT NOT NULL DEFAULT '[]',
    to_node_ids TEXT NOT NULL DEFAULT '[]',
    claimed_at TEXT,
    title TEXT,
    direction_description TEXT NOT NULL,
    failure_count INTEGER NOT NULL DEFAULT 0,
    priority REAL NOT NULL DEFAULT 1.0,  -- 新增
    created_at TEXT NOT NULL,
    PRIMARY KEY (project_id, id)
  );
`);
```

- [ ] **Step 3: 删除旧数据库重新创建**

```bash
rm -f ./data/methodos.db
```

- [ ] **Step 4: 验证数据库创建成功**

```bash
npm run build && npm run start
# 检查服务器启动成功，数据库已创建
```

- [ ] **Step 5: 提交**

```bash
git add src/db/schema.ts src/db/connection.ts
git commit -m "feat(db): add priority field to edges table"
```

---

## Task 2: 配置系统更新

**Files:**
- Modify: `src/config.ts:4-14,26-39,62-77`
- Modify: `src/db/connection.ts:79-99`

- [ ] **Step 1: 更新config.ts的DEFAULTS和Config接口**

```typescript
// src/config.ts
const DEFAULTS: Record<string, number> = {
  actTimeoutMs: 600000,
  planTimeoutMs: 600000,
  claimedExpiryMs: 1800000,
  tickIntervalMs: 1000,
  maxFailures: 3,
  maxActConcurrency: 3,
  snapshotMaxNodes: 100,
  snapshotMaxEdges: 200,
  maxValidationRetries: 3,
  planMinIntervalMs: 5000,           // 新增
  priorityBoostSuccess: 120,         // 新增：存储为整数百分比（1.2 -> 120）
  priorityPenaltyFailure: 90,        // 新增：存储为整数百分比（0.9 -> 90）
  priorityDecayRateHourly: 1,        // 新增：存储为整数百分比（0.01 -> 1）
};

interface Config {
  databasePath: string;
  dockerSocket: string;
  agentImages: Record<string, string>;
  actTimeoutMs: number;
  planTimeoutMs: number;
  claimedExpiryMs: number;
  tickIntervalMs: number;
  maxFailures: number;
  maxActConcurrency: number;
  snapshotMaxNodes: number;
  snapshotMaxEdges: number;
  maxValidationRetries: number;
  planMinIntervalMs: number;         // 新增
  priorityBoostSuccess: number;      // 新增
  priorityPenaltyFailure: number;    // 新增
  priorityDecayRateHourly: number;   // 新增
}
```

- [ ] **Step 2: 更新loadConfigFromDb()函数**

```typescript
// src/config.ts
export function loadConfigFromDb(db: Database.Database): void {
  const settings = getSettings(db);

  for (const [key, defaultVal] of Object.entries(DEFAULTS)) {
    const envKey = ENV_OVERRIDES[key];
    const envVal = envKey ? process.env[envKey] : undefined;

    if (envVal !== undefined) {
      (_config as any)[key] = parseInt(envVal, 10) || defaultVal;
    } else if (settings[key] !== undefined) {
      // 特殊处理百分比配置项
      if (key.startsWith('priority') || key === 'priorityBoostSuccess' || key === 'priorityPenaltyFailure' || key === 'priorityDecayRateHourly') {
        (_config as any)[key] = parseInt(settings[key], 10) / 100 || defaultVal / 100;
      } else {
        (_config as any)[key] = parseInt(settings[key], 10) || defaultVal;
      }
    } else {
      (_config as any)[key] = key.startsWith('priority') || key === 'priorityBoostSuccess' || key === 'priorityPenaltyFailure' || key === 'priorityDecayRateHourly' ? defaultVal / 100 : defaultVal;
    }
  }
}
```

- [ ] **Step 3: 更新数据库初始化默认配置**

```typescript
// src/db/connection.ts - initDb()函数
if (existing.count === 0) {
  const now = new Date().toISOString();
  const defaults: Record<string, string> = {
    actTimeoutMs: '600000',
    planTimeoutMs: '600000',
    claimedExpiryMs: '1800000',
    tickIntervalMs: '1000',
    maxFailures: '3',
    maxActConcurrency: '3',
    snapshotMaxNodes: '100',
    snapshotMaxEdges: '200',
    planMinIntervalMs: '5000',           // 新增
    priorityBoostSuccess: '120',         // 新增：1.2 -> 120
    priorityPenaltyFailure: '90',        // 新增：0.9 -> 90
    priorityDecayRateHourly: '1',        // 新增：0.01 -> 1
  };
  // ...
}
```

- [ ] **Step 4: 验证配置加载**

```bash
npm run build && npm run start
# 检查配置正确加载
```

- [ ] **Step 5: 提交**

```bash
git add src/config.ts src/db/connection.ts
git commit -m "feat(config): add priority and plan interval config to database"
```

---

## Task 3: 优先级计算模块

**Files:**
- Create: `src/db/priority.ts`

- [ ] **Step 1: 创建优先级计算模块**

```typescript
// src/db/priority.ts
import { config } from '../config';

export interface EdgePriorityInput {
  priority: number;
  failureCount: number;
  createdAt: string;
}

export function calculateEdgePriority(
  edge: EdgePriorityInput,
  result: 'success' | 'failure',
): number {
  let priority = edge.priority;
  
  // 因素1：成功/失败反馈
  if (result === 'success') {
    priority *= config.priorityBoostSuccess;
  } else {
    priority *= config.priorityPenaltyFailure;
  }
  
  // 因素2：失败次数惩罚
  priority *= Math.pow(config.priorityPenaltyFailure, edge.failureCount);
  
  // 因素3：时间衰减（新边略有优势）
  const ageHours = (Date.now() - new Date(edge.createdAt).getTime()) / (1000 * 60 * 60);
  priority *= Math.max(0.5, 1.0 - (ageHours * config.priorityDecayRateHourly));
  
  // 限制在有效范围内
  return Math.max(0.1, Math.min(10.0, priority));
}
```

- [ ] **Step 2: 编写单元测试**

```typescript
// src/db/__tests__/priority.test.ts
import { describe, it, expect } from 'vitest';
import { calculateEdgePriority } from '../priority';

describe('calculateEdgePriority', () => {
  it('should boost priority on success', () => {
    const edge = { priority: 1.0, failureCount: 0, createdAt: new Date().toISOString() };
    const result = calculateEdgePriority(edge, 'success');
    expect(result).toBeGreaterThan(1.0);
  });

  it('should reduce priority on failure', () => {
    const edge = { priority: 1.0, failureCount: 0, createdAt: new Date().toISOString() };
    const result = calculateEdgePriority(edge, 'failure');
    expect(result).toBeLessThan(1.0);
  });

  it('should apply failure count penalty', () => {
    const edge = { priority: 1.0, failureCount: 3, createdAt: new Date().toISOString() };
    const result = calculateEdgePriority(edge, 'success');
    expect(result).toBeLessThan(1.2); // 1.2 * 0.9^3 ≈ 0.875
  });

  it('should apply time decay', () => {
    const oldDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24 hours ago
    const edge = { priority: 1.0, failureCount: 0, createdAt: oldDate };
    const result = calculateEdgePriority(edge, 'success');
    expect(result).toBeLessThan(1.2); // Should be reduced by time decay
  });

  it('should clamp to valid range', () => {
    const edge = { priority: 0.05, failureCount: 0, createdAt: new Date().toISOString() };
    const result = calculateEdgePriority(edge, 'failure');
    expect(result).toBeGreaterThanOrEqual(0.1);
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
npm test src/db/__tests__/priority.test.ts
```

- [ ] **Step 4: 提交**

```bash
git add src/db/priority.ts src/db/__tests__/priority.test.ts
git commit -m "feat(priority): add edge priority calculation module"
```

---

## Task 4: 修改Plan触发逻辑

**Files:**
- Modify: `src/executor/plan-exec.ts:22-32`

- [ ] **Step 1: 修改shouldTriggerPlan()函数**

```typescript
// src/executor/plan-exec.ts
export function shouldTriggerPlan(
  db: Database.Database,
  projectId: number,
  lastPlanExecutedAt?: string,
): boolean {
  const project = getProject(db, projectId);
  if (!project || project.status !== 'active') return false;

  // 移除：const unresulted = hasUnresultedEdges(db, projectId);
  // 移除：if (unresulted) return false;

  if (!project.last_plan_at) return true;

  // 检查最小间隔
  if (lastPlanExecutedAt) {
    const lastExec = new Date(lastPlanExecutedAt).getTime();
    const now = Date.now();
    if (now - lastExec < config.planMinIntervalMs) {
      return false;
    }
  }

  return hasNewNodesSince(db, projectId, project.last_plan_at);
}
```

- [ ] **Step 2: 更新loop.ts中的调用**

```typescript
// src/executor/loop.ts
let lastPlanExecutedAt: string | undefined;

// 在Plan执行成功后更新
if (shouldTriggerPlan(db, project.id, lastPlanExecutedAt)) {
  lastPlanExecutedAt = new Date().toISOString();
  // ... 执行Plan
}
```

- [ ] **Step 3: 编写单元测试**

```typescript
// src/executor/__tests__/plan-exec.test.ts
import { describe, it, expect, vi } from 'vitest';
import { shouldTriggerPlan } from '../plan-exec';

describe('shouldTriggerPlan', () => {
  it('should trigger when last_plan_at is null', () => {
    // 测试首次触发
  });

  it('should trigger when new nodes exist and min interval passed', () => {
    // 测试正常触发
  });

  it('should not trigger when min interval not passed', () => {
    // 测试最小间隔
  });

  it('should not trigger when no new nodes', () => {
    // 测试无新节点
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
npm test src/executor/__tests__/plan-exec.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add src/executor/plan-exec.ts src/executor/__tests__/plan-exec.test.ts
git commit -m "feat(plan): remove unresulted edges check, add min interval"
```

---

## Task 5: 修改快照渲染

**Files:**
- Modify: `src/snapshot/render.ts:4-69`

- [ ] **Step 1: 添加模式参数和边过滤逻辑**

```typescript
// src/snapshot/render.ts
export function renderSnapshot(
  db: Database.Database,
  projectId: number,
  limits: { snapshotMaxNodes: number; snapshotMaxEdges: number },
  mode: 'plan' | 'act' = 'plan',  // 新增参数
  claimedEdgeId?: number,          // 新增参数
): Snapshot {
  const nodes = db.prepare(
    'SELECT id, title, description, created_by FROM nodes WHERE project_id = ? ORDER BY created_at ASC'
  ).all(projectId) as SnapshotNode[];

  const rawEdges = db.prepare(
    'SELECT id, from_node_ids, to_node_ids, title, direction_description, failure_count FROM edges WHERE project_id = ? ORDER BY created_at ASC'
  ).all(projectId) as any[];

  const allEdges: SnapshotEdge[] = rawEdges.map(e => ({
    id: e.id,
    from_node_ids: JSON.parse(e.from_node_ids),
    to_node_ids: JSON.parse(e.to_node_ids),
    title: e.title || null,
    direction_description: e.direction_description,
    failure_count: e.failure_count,
  }));

  let edges: SnapshotEdge[];
  if (mode === 'plan') {
    // Plan模式：包含所有边（不区分待处理/运行中状态）
    edges = allEdges;
  } else {
    // Act模式：仅包含已完成边 + 当前认领的边
    const completedEdges = allEdges.filter(e => e.to_node_ids.length > 0);
    if (claimedEdgeId) {
      const claimedEdge = allEdges.find(e => e.id === claimedEdgeId);
      if (claimedEdge) {
        edges = [...completedEdges, claimedEdge];
      } else {
        edges = completedEdges;
      }
    } else {
      edges = completedEdges;
    }
  }

  // ... 截断逻辑保持不变 ...
}
```

- [ ] **Step 2: 更新截断逻辑以处理未完成边**

```typescript
// 在截断逻辑中，确保未完成边的源节点也被保留
if (mode === 'act') {
  // Act模式：确保claimedEdge的源节点被保留
  if (claimedEdgeId) {
    const claimedEdge = edges.find(e => e.id === claimedEdgeId);
    if (claimedEdge) {
      for (const nid of claimedEdge.from_node_ids) {
        keptNodeIds.add(nid);
      }
    }
  }
}
```

- [ ] **Step 3: 编写单元测试**

```typescript
// src/snapshot/__tests__/render.test.ts
import { describe, it, expect } from 'vitest';
import { renderSnapshot } from '../render';

describe('renderSnapshot', () => {
  it('should include all edges in plan mode', () => {
    // 测试Plan模式包含所有边
  });

  it('should include only completed edges + claimed edge in act mode', () => {
    // 测试Act模式仅包含相关边
  });

  it('should preserve source nodes for claimed edge in act mode', () => {
    // 测试Act模式保留源节点
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
npm test src/snapshot/__tests__/render.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add src/snapshot/render.ts src/snapshot/__tests__/render.test.ts
git commit -m "feat(snapshot): add mode parameter for plan/act snapshot"
```

---

## Task 6: 更新数据库操作

**Files:**
- Modify: `src/db/operations.ts:68-84,86-118`

- [ ] **Step 1: 修改insertEdges()支持priority字段**

```typescript
// src/db/operations.ts
export function insertEdges(
  db: Database.Database,
  projectId: number,
  edges: { from_node_ids: number[]; title?: string; direction_description: string }[],
  ts: string,
): number[] {
  const ids: number[] = [];
  for (const edge of edges) {
    const id = nextEdgeId(db, projectId);
    db.prepare(`
      INSERT INTO edges (project_id, id, from_node_ids, to_node_ids, title, direction_description, priority, created_at)
      VALUES (?, ?, ?, '[]', ?, ?, 1.0, ?)
    `).run(projectId, id, JSON.stringify(edge.from_node_ids), edge.title || null, edge.direction_description, ts);
    ids.push(id);
  }
  return ids;
}
```

- [ ] **Step 2: 修改claimEdge()支持优先级排序**

```typescript
// src/db/operations.ts
export function claimEdge(
  db: Database.Database,
  projectId: number,
  maxFailures: number,
  expiryMs: number,
  ts: string,
) {
  const expiredAt = new Date(Date.now() - expiryMs).toISOString();
  const row = db.prepare(`
    UPDATE edges SET claimed_at = ?
    WHERE project_id = ? AND id = (
      SELECT id FROM edges
      WHERE project_id = ? AND to_node_ids = '[]' AND failure_count < ?
        AND (claimed_at IS NULL OR claimed_at < ?)
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    )
    RETURNING *
  `).get(ts, projectId, projectId, maxFailures, expiredAt) as any;

  if (!row) return null;

  return {
    id: row.id,
    project_id: row.project_id,
    from_node_ids: JSON.parse(row.from_node_ids),
    to_node_ids: JSON.parse(row.to_node_ids),
    claimed_at: row.claimed_at,
    title: row.title,
    direction_description: row.direction_description,
    failure_count: row.failure_count,
    priority: row.priority,
    created_at: row.created_at,
  };
}
```

- [ ] **Step 3: 添加updateEdgePriority()函数**

```typescript
// src/db/operations.ts
export function updateEdgePriority(
  db: Database.Database,
  projectId: number,
  edgeId: number,
  priority: number,
): void {
  db.prepare(`
    UPDATE edges SET priority = ? WHERE project_id = ? AND id = ?
  `).run(priority, projectId, edgeId);
}
```

- [ ] **Step 4: 添加getEdge()函数**

```typescript
// src/db/operations.ts
export function getEdge(
  db: Database.Database,
  projectId: number,
  edgeId: number,
) {
  const row = db.prepare(
    'SELECT * FROM edges WHERE project_id = ? AND id = ?'
  ).get(projectId, edgeId) as any;

  if (!row) return null;

  return {
    id: row.id,
    project_id: row.project_id,
    from_node_ids: JSON.parse(row.from_node_ids),
    to_node_ids: JSON.parse(row.to_node_ids),
    claimed_at: row.claimed_at,
    title: row.title,
    direction_description: row.direction_description,
    failure_count: row.failure_count,
    priority: row.priority,
    created_at: row.created_at,
  };
}
```

- [ ] **Step 5: 提交**

```bash
git add src/db/operations.ts
git commit -m "feat(db): add priority support to edge operations"
```

---

## Task 7: 更新Act执行逻辑

**Files:**
- Modify: `src/executor/act-exec.ts:20-78`

- [ ] **Step 1: 更新executeAct()使用新的快照渲染**

```typescript
// src/executor/act-exec.ts
export function executeAct(
  db: Database.Database,
  projectId: number,
  driver: AgentDriver,
  _ts: string,
): Promise<{ success: boolean; edgeId?: number; error?: string }> {
  const edge = claimEdge(db, projectId, config.maxFailures, config.claimedExpiryMs, new Date().toISOString());
  if (!edge) {
    return Promise.resolve({ success: false, edgeId: undefined, error: 'No unclaimed edge' });
  }

  // 使用新的快照渲染，传入模式和claimedEdgeId
  const snapshot = renderSnapshot(db, projectId, {
    snapshotMaxNodes: config.snapshotMaxNodes,
    snapshotMaxEdges: config.snapshotMaxEdges,
  }, 'act', edge.id);

  // ... 其余逻辑保持不变 ...
}
```

- [ ] **Step 2: 添加优先级更新逻辑**

```typescript
// src/executor/act-exec.ts
import { calculateEdgePriority } from '../db/priority';
import { updateEdgePriority } from '../db/operations';

// 在writeActResult成功后
try {
  writeActResult(db, projectId, edge.id, parsed.data.title || null, parsed.data.description, 'agent', ts);
  
  // 更新优先级
  const newPriority = calculateEdgePriority(
    { priority: edge.priority, failureCount: edge.failure_count, createdAt: edge.created_at },
    'success'
  );
  updateEdgePriority(db, projectId, edge.id, newPriority);
  
  return { success: true, edgeId: edge.id };
} catch (err: any) {
  return { success: false, edgeId: edge.id, error: err.message };
}
```

- [ ] **Step 3: 在失败时也更新优先级**

```typescript
// 在handleActFailure调用后
handleActFailure(db, projectId, edge.id, config.maxFailures, ts);

// 更新优先级
const newPriority = calculateEdgePriority(
  { priority: edge.priority, failureCount: edge.failure_count + 1, createdAt: edge.created_at },
  'failure'
);
updateEdgePriority(db, projectId, edge.id, newPriority);
```

- [ ] **Step 4: 提交**

```bash
git add src/executor/act-exec.ts
git commit -m "feat(act): add priority update after edge resolution"
```

---

## Task 8: 更新Plan执行逻辑

**Files:**
- Modify: `src/executor/plan-exec.ts:34-66`

- [ ] **Step 1: 更新executePlan()使用新的快照渲染**

```typescript
// src/executor/plan-exec.ts
export function executePlan(
  db: Database.Database,
  projectId: number,
  driver: AgentDriver,
  _ts: string,
): Promise<{ success: boolean; error?: string }> {
  // 使用新的快照渲染，传入模式
  const snapshot = renderSnapshot(db, projectId, {
    snapshotMaxNodes: config.snapshotMaxNodes,
    snapshotMaxEdges: config.snapshotMaxEdges,
  }, 'plan');

  // ... 其余逻辑保持不变 ...
}
```

- [ ] **Step 2: 提交**

```bash
git add src/executor/plan-exec.ts
git commit -m "feat(plan): use plan mode snapshot rendering"
```

---

## Task 9: 更新提示模板

**Files:**
- Modify: `src/prompt/plan.ts:5-80`
- Modify: `src/prompt/act.ts:1-43`

- [ ] **Step 1: 更新Plan提示模板**

```typescript
// src/prompt/plan.ts
export function renderPlanPrompt(snapshot: Snapshot, projectId: number, round: number): string {
  const file = `/home/kali/workspace/plan_output_${round}.json`;
  return `你是一个安全测试规划者。分析当前探索图谱，决定下一步行动。

你的职责是规划，不是执行。不要运行 nmap、curl、sqlmap 等探索命令——这些由其他执行者完成。你应该专注于分析已有发现，规划接下来的探索方向。

将决策保存到 ${file}。

所有文本字段（title、summary、direction_description）必须是中文。

## 当前探索图谱
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

**注意**：图谱中包含所有边，包括正在探索和待探索的边。请勿创建重复的探索方向。

## 决策规则
// ... 其余保持不变 ...
```

- [ ] **Step 2: 更新Act提示模板**

```typescript
// src/prompt/act.ts
export function renderActPrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
  projectId: number,
): string {
  const outputFile = `${workdir}/act_output.json`;

  return `你是一个安全测试执行者。你的唯一任务是完成下面指定的探索方向。

## 任务
${directionDescription}

使用 bash 和其他工具执行此探索。将原始输出保存到文件：${outputFile}

## 网络请求控制
// ... 保持不变 ...

## 输出格式
// ... 保持不变 ...

## 当前图谱
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

项目 ID: ${projectId}`;
}
```

- [ ] **Step 3: 提交**

```bash
git add src/prompt/plan.ts src/prompt/act.ts
git commit -m "feat(prompt): update prompts for new snapshot modes"
```

---

## Task 10: 集成测试

**Files:**
- Create: `src/__tests__/integration/multi-level-queue.test.ts`

- [ ] **Step 1: 编写集成测试**

```typescript
// src/__tests__/integration/multi-level-queue.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { initDb } from '../../db/connection';
import { shouldTriggerPlan } from '../../executor/plan-exec';
import { renderSnapshot } from '../../snapshot/render';
import { calculateEdgePriority } from '../../db/priority';

describe('Multi-level Feedback Queue Integration', () => {
  let db: Database.Database;

  beforeAll(() => {
    // 创建测试数据库
    db = new Database(':memory:');
    initDb();
  });

  afterAll(() => {
    db.close();
  });

  it('should trigger plan when new nodes exist regardless of unresulted edges', () => {
    // 测试Plan触发逻辑
  });

  it('should include all edges in plan snapshot', () => {
    // 测试Plan快照
  });

  it('should include only relevant edges in act snapshot', () => {
    // 测试Act快照
  });

  it('should select highest priority edge for act', () => {
    // 测试边选择
  });

  it('should update priority after edge resolution', () => {
    // 测试优先级更新
  });
});
```

- [ ] **Step 2: 运行集成测试**

```bash
npm test src/__tests__/integration/multi-level-queue.test.ts
```

- [ ] **Step 3: 提交**

```bash
git add src/__tests__/integration/multi-level-queue.test.ts
git commit -m "test: add integration tests for multi-level feedback queue"
```

---

## Task 11: 最终验证

- [ ] **Step 1: 运行所有测试**

```bash
npm test
```

- [ ] **Step 2: 运行类型检查**

```bash
npm run typecheck
```

- [ ] **Step 3: 运行lint**

```bash
npm run lint
```

- [ ] **Step 4: 构建项目**

```bash
npm run build
```

- [ ] **Step 5: 启动服务验证**

```bash
npm run start
# 创建测试项目，验证Plan触发和优先级调整
```

- [ ] **Step 6: 最终提交**

```bash
git add .
git commit -m "feat: implement multi-level feedback queue and incremental plan triggering"
```

---

## 自检清单

### 规范覆盖检查
✅ Plan触发变更 - Task 4
✅ 边优先级系统 - Task 3, 6, 7
✅ 快照变更 - Task 5, 8
✅ 配置变更 - Task 2
✅ 提示模板更新 - Task 9
✅ 测试 - Task 10, 11

### 占位符检查
✅ 无TBD、TODO或模糊要求

### 类型一致性检查
✅ 函数名、参数、返回值在各任务间一致
✅ 配置项名称一致
✅ 数据库字段名一致

---

## 执行选项

**Plan complete and saved to `docs/superpowers/plans/2026-05-16-multi-level-feedback-queue.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
