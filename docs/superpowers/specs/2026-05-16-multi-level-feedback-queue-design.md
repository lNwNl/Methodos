# 多级反馈队列与增量Plan触发设计

## 概述

本设计将Methodos系统的Plan触发机制从"所有边处理完成后触发"改为"每次产生新节点（即一条边被解决）就触发一次"，并引入多级反馈队列模式，实现边的动态优先级调整。

## 当前行为分析

### Plan触发机制

当前实现在 `/home/nwn/Methodos/src/executor/plan-exec.ts:22-32`：

```typescript
export function shouldTriggerPlan(db: Database.Database, projectId: number): boolean {
  const project = getProject(db, projectId);
  if (!project || project.status !== 'active') return false;

  const unresulted = hasUnresultedEdges(db, projectId);
  if (unresulted) return false;  // ← 阻止Plan在有待处理边时运行

  if (!project.last_plan_at) return true;

  return hasNewNodesSince(db, projectId, project.last_plan_at);
}
```

**触发条件**：
1. `last_plan_at IS NULL`（首次运行）或
2. `hasNewNodesSince(last_plan_at)` 且 `!hasUnresultedEdges()`（所有边已完成）

### 快照行为

当前实现在 `/home/nwn/Methodos/src/snapshot/render.ts:26`：

```typescript
.filter(e => e.to_node_ids.length > 0)  // 排除未完成的边
```

- Plan快照：所有节点 + 仅已完成的边
- Act快照：与Plan快照相同

## 设计变更

### 1. Plan触发变更

**目标**：允许Plan在边正在执行时运行，实现增量触发。

**变更**：
- 移除 `!hasUnresultedEdges()` 条件
- 添加最小间隔检查（可配置，默认5秒）
- 仅检查 `hasNewNodesSince(last_plan_at)`

**并发考虑**：
- Plan和Act可以同时运行
- Plan使用SQLite事务获取一致快照
- 保持 `planInFlight` 检查，防止同一项目多个Plan任务

### 2. 边优先级系统

**目标**：实现多级反馈队列，动态调整边优先级。

**架构变更**：

在edges表中添加 `priority` 字段：
```typescript
priority: real('priority').notNull().default(1.0)  // 范围：0.1-10.0
```

**优先级计算公式**：

```typescript
function calculateEdgePriority(edge: Edge, result: 'success' | 'failure'): number {
  let priority = edge.priority;
  
  // 因素1：成功/失败反馈
  if (result === 'success') {
    priority *= 1.2;  // 提升20%
  } else {
    priority *= 0.8;  // 降低20%
  }
  
  // 因素2：失败次数惩罚
  priority *= Math.pow(0.9, edge.failureCount);  // 每次失败降低10%
  
  // 因素3：时间衰减（新边略有优势）
  const ageHours = (Date.now() - edge.createdAt.getTime()) / (1000 * 60 * 60);
  priority *= Math.max(0.5, 1.0 - (ageHours * 0.01));  // 每小时衰减1%，最低0.5
  
  // 限制在有效范围内
  return Math.max(0.1, Math.min(10.0, priority));
}
```

**边选择逻辑**：
```typescript
function selectEdgeForAct(db: Database.Database, projectId: number): Edge | null {
  // 选择优先级最高、未完成、未认领的边
  const edge = db.prepare(`
    SELECT * FROM edges 
    WHERE project_id = ? 
      AND json_array_length(to_node_ids) = 0 
      AND claimed_at IS NULL
      AND failure_count < ?
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `).get(projectId, maxFailures);
  
  return edge || null;
}
```

**重要**：优先级仅在executor处判断，不传递给模型。

### 3. 快照变更

#### Plan快照

**目标**：包含所有节点和所有边（包括待处理和正在运行的边）。

**实现**：
```typescript
// Plan模式：包含所有边，不区分待处理/运行中状态
edges = getAllEdges(db, projectId);
```

**提示模板更新**：
- 说明快照包含所有边（包括正在探索的边）
- 明确告知模型这些边正在被探索，不要生成重复的探索方向
- **不提及边优先级**

#### Act快照

**目标**：仅包含当前要处理的边以及之前已完成的边和节点。

**实现**：
```typescript
// Act模式：仅包含已完成边 + 当前认领的边
edges = getCompletedEdges(db, projectId);
if (claimedEdgeId) {
  const claimedEdge = getEdge(db, projectId, claimedEdgeId);
  if (claimedEdge) edges.push(claimedEdge);
}
```

**提示模板更新**：
- **不说明正在运行/待运行的边**
- 仅包含当前要处理的边以及之前已完成的边和节点

### 4. 配置变更

**统一存储在数据库 `settings` 表**

新增配置项：
- `planMinIntervalMs`: Plan最小间隔（毫秒），默认5000
- `priorityBoostSuccess`: 成功优先级提升（乘数），默认1.2
- `priorityPenaltyFailure`: 失败优先级惩罚（乘数），默认0.9
- `priorityDecayRateHourly`: 每小时优先级衰减率，默认0.01

**实现方式**：
- 更新 `connection.ts` 中的默认配置
- 更新 `config.ts` 的默认值和接口
- 更新 `loadConfigFromDb()` 函数处理百分比配置项
- 保持环境变量覆盖机制

## 实施计划

### 阶段 1：数据库架构变更

1. 在edges表中添加 `priority` 字段
2. 在projects表中添加 `last_node_created_at` 字段
3. 直接删除旧数据库重新创建（不进行迁移）

### 阶段 2：核心逻辑变更

1. 修改 `shouldTriggerPlan()` 移除 `!hasUnresultedEdges()` 条件
2. 修改 `renderSnapshot()` 添加模式参数
3. 修改Act的边选择逻辑，按优先级排序
4. 添加优先级计算函数

### 阶段 3：配置变更

1. 更新 `connection.ts` 添加新配置项到数据库
2. 更新 `config.ts` 添加新配置项到接口和默认值
3. 更新 `loadConfigFromDb()` 处理百分比配置项

### 阶段 4：提示模板更新

1. 更新Plan提示模板，说明边正在探索
2. 更新Act提示模板，仅包含相关边

### 阶段 5：测试

1. 单元测试：`shouldTriggerPlan()` 新逻辑
2. 单元测试：`renderSnapshot()` 不同模式
3. 单元测试：优先级计算
4. 集成测试：每次边解决后Plan触发
5. 集成测试：并发Plan + Act执行

## 关键文件

| 文件路径 | 变更内容 |
|---------|---------|
| `/home/nwn/Methodos/src/db/schema.ts` | 添加priority字段 |
| `/home/nwn/Methodos/src/db/connection.ts` | 添加新配置项默认值 |
| `/home/nwn/Methodos/src/config.ts` | 添加新配置项到接口和默认值 |
| `/home/nwn/Methodos/src/executor/plan-exec.ts` | 修改触发逻辑 |
| `/home/nwn/Methodos/src/snapshot/render.ts` | 修改快照渲染 |
| `/home/nwn/Methodos/src/db/operations.ts` | 添加边选择函数 |
| `/home/nwn/Methodos/src/executor/act-exec.ts` | 添加优先级计算 |
| `/home/nwn/Methodos/src/prompt/plan.ts` | 更新提示模板 |
| `/home/nwn/Methodos/src/prompt/act.ts` | 更新提示模板 |

## 风险与缓解

### 1. 性能风险
**风险**：更频繁的Plan调用可能增加LLM API成本
**缓解**：添加最小间隔配置（默认5秒）

### 2. 并发风险
**风险**：Plan和Act同时访问图可能导致不一致
**缓解**：使用SQLite事务确保一致性

### 3. 优先级计算风险
**风险**：简单公式可能无法准确反映"目标接近度"
**缓解**：先实现基础公式，后续可添加嵌入相似度计算

## 未来扩展

1. **目标接近度计算**：添加嵌入相似度计算，提升目标相关边的优先级
2. **批量窗口**：添加可配置的批量窗口，平衡响应性和效率
3. **事件驱动架构**：未来可考虑替换为事件驱动系统
