# Methodos 核心循环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 Methodos 项目骨架，实现数据库层 + 核心主循环 + Mock Agent Driver，验证 Plan→Act→Plan→Complete 完整闭环

**Architecture:** SQLite (better-sqlite3 + Drizzle ORM) 存储 Node-Edge 图，Executor 主循环轮询 active 项目触发 Plan/Act，MockDriver 模拟 Agent 返回预制 JSON。纯 CLI 运行，不涉及 HTTP/Docker

**Tech Stack:** Node.js 24 + TypeScript 5 strict + pnpm + better-sqlite3 12 + drizzle-orm 0.45 + zod 4 + vitest 4 + pino 10

---

## File Map

| File | Responsibility |
|---|---|
| `package.json` | Workspace root, scripts, dependencies |
| `tsconfig.json` | TypeScript strict config |
| `vitest.config.ts` | Vitest configuration |
| `drizzle.config.ts` | Drizzle Kit config |
| `.env` | DATABASE_PATH, config overrides |
| `.gitignore` | Node + pnpm + data dir |
| `src/config.ts` | Typed config from env, defaults |
| `src/types.ts` | Shared types (Snapshot, etc.) |
| `src/db/schema.ts` | Drizzle table definitions (Project, Node, Edge) |
| `src/db/connection.ts` | better-sqlite3 init, WAL mode, migrate |
| `src/db/operations.ts` | Atomic SQL: claim, write-back, failure, CRUD |
| `src/db/operations.test.ts` | Unit tests for atomic operations |
| `src/snapshot/render.ts` | Full graph → truncated JSON snapshot |
| `src/snapshot/render.test.ts` | Snapshot truncation tests |
| `src/prompt/plan.ts` | Plan prompt template renderer |
| `src/prompt/act.ts` | Act prompt template renderer |
| `src/driver/types.ts` | AgentDriver, PlanOutput, AgentOutput, ActResult |
| `src/driver/mock.ts` | MockAgentDriver with stateful scenario engine |
| `src/driver/mock.test.ts` | Mock driver tests |
| `src/executor/plan-exec.ts` | Plan trigger check + execution + atomic write |
| `src/executor/act-exec.ts` | Edge claim + Act execution + write-back |
| `src/executor/loop.ts` | Main polling loop: tick per project |
| `src/executor/main.ts` | CLI entry: init DB, create demo project, start loop |
| `src/executor/loop.test.ts` | Integration test: full Plan→Act→Plan→complete cycle |

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts`, `.env`, `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "methodos",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/executor/main.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:push": "drizzle-kit push",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "better-sqlite3": "^12.0.0",
    "drizzle-orm": "^0.45.0",
    "zod": "^4.0.0",
    "pino": "^10.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^24.0.0",
    "drizzle-kit": "^0.31.0",
    "tsx": "^4.0.0",
    "typescript": "^5.8.0",
    "vitest": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 4: Create drizzle.config.ts**

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_PATH || './data/methodos.db',
  },
});
```

- [ ] **Step 5: Create .env**

```
DATABASE_PATH=./data/methodos.db
MAX_ACT_CONCURRENCY=3
ACT_TIMEOUT_MS=300000
PLAN_TIMEOUT_MS=600000
MAX_FAILURES=3
SNAPSHOT_MAX_NODES=100
SNAPSHOT_MAX_EDGES=200
```

- [ ] **Step 6: Create .gitignore**

```
node_modules/
dist/
data/
*.db
drizzle/
.env.local
```

- [ ] **Step 7: Install dependencies**

```bash
pnpm install
```

Expected: Installs all deps without errors.

- [ ] **Step 8: Verify TypeScript compiles**

```bash
pnpm typecheck
```

Expected: No errors (no .ts files yet, but config is valid).

---

### Task 2: Config Module + Shared Types

**Files:**
- Create: `src/config.ts`, `src/types.ts`

- [ ] **Step 1: Write config.ts**

```typescript
export const config = {
  databasePath: process.env.DATABASE_PATH || './data/methodos.db',
  maxActConcurrency: parseInt(process.env.MAX_ACT_CONCURRENCY || '3', 10),
  actTimeoutMs: parseInt(process.env.ACT_TIMEOUT_MS || '300000', 10),
  planTimeoutMs: parseInt(process.env.PLAN_TIMEOUT_MS || '600000', 10),
  maxFailures: parseInt(process.env.MAX_FAILURES || '3', 10),
  snapshotMaxNodes: parseInt(process.env.SNAPSHOT_MAX_NODES || '100', 10),
  snapshotMaxEdges: parseInt(process.env.SNAPSHOT_MAX_EDGES || '200', 10),
  claimedExpiryMs: 30 * 60 * 1000, // 30 minutes
} as const;
```

- [ ] **Step 2: Write types.ts**

```typescript
export interface SnapshotNode {
  id: number;
  description: string;
  created_by: string;
}

export interface SnapshotEdge {
  id: number;
  from_node_ids: number[];
  to_node_ids: number[];
  direction_description: string;
  failure_count: number;
}

export interface Snapshot {
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
}

export type ProjectStatus = 'active' | 'completed' | 'failed' | 'stopped';
```

---

### Task 3: Database Schema

**Files:**
- Create: `src/db/schema.ts`

- [ ] **Step 1: Write Drizzle schema**

```typescript
import { sqliteTable, integer, text, primaryKey } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  status: text('status').notNull().default('active'),
  agentType: text('agent_type').notNull(),
  imageTag: text('image_tag').notNull(),
  lastPlanAt: text('last_plan_at'),
  failureCount: integer('failure_count').notNull().default(0),
  summary: text('summary'),
  evidenceNodeIds: text('evidence_node_ids', { mode: 'json' }).$type<number[]>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const nodes = sqliteTable('nodes', {
  projectId: integer('project_id').notNull(),
  id: integer('id').notNull(),
  description: text('description').notNull(),
  createdBy: text('created_by').notNull(),
  edgeId: integer('edge_id'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.projectId, table.id] }),
}));

export const edges = sqliteTable('edges', {
  projectId: integer('project_id').notNull(),
  id: integer('id').notNull(),
  fromNodeIds: text('from_node_ids', { mode: 'json' }).$type<number[]>().notNull(),
  toNodeIds: text('to_node_ids', { mode: 'json' }).$type<number[]>().notNull().default([]),
  claimedAt: text('claimed_at'),
  directionDescription: text('direction_description').notNull(),
  failureCount: integer('failure_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.projectId, table.id] }),
}));
```

- [ ] **Step 2: Verify schema compiles**

```bash
pnpm typecheck
```

Expected: No errors.

---

### Task 4: Database Connection + Migration Runner

**Files:**
- Create: `src/db/connection.ts`

- [ ] **Step 1: Write connection.ts**

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { config } from '../config';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let dbInstance: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (dbInstance) return dbInstance;

  const dir = dirname(config.databasePath);
  mkdirSync(dir, { recursive: true });

  const sqlite = new Database(config.databasePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  dbInstance = drizzle(sqlite, { schema });
  return dbInstance;
}

export function getRawDb(): Database.Database {
  const db = getDb();
  // Access the underlying better-sqlite3 instance via internal API
  return (db as any).$client as Database.Database;
}

export function initDb() {
  const sqlite = getRawDb();

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      agent_type TEXT NOT NULL,
      image_tag TEXT NOT NULL,
      last_plan_at TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      evidence_node_ids TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nodes (
      project_id INTEGER NOT NULL,
      id INTEGER NOT NULL,
      description TEXT NOT NULL,
      created_by TEXT NOT NULL,
      edge_id INTEGER,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );

    CREATE TABLE IF NOT EXISTS edges (
      project_id INTEGER NOT NULL,
      id INTEGER NOT NULL,
      from_node_ids TEXT NOT NULL DEFAULT '[]',
      to_node_ids TEXT NOT NULL DEFAULT '[]',
      claimed_at TEXT,
      direction_description TEXT NOT NULL,
      failure_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );
  `);

  return getDb();
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: No errors (may need `@types/better-sqlite3`).

---

### Task 5: Database Operations

**Files:**
- Create: `src/db/operations.ts`, `src/db/operations.test.ts`

- [ ] **Step 1: Write failing tests for operations**

Create `src/db/operations.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  createProject,
  getProject,
  getActiveProjects,
  nextNodeId,
  nextEdgeId,
  insertNode,
  insertEdges,
  claimEdge,
  writeActResult,
  handleActFailure,
  hasUnresultedEdges,
  hasNewNodesSince,
  getSnapshotData,
} from './operations';
import { initDb } from './connection';

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      agent_type TEXT NOT NULL,
      image_tag TEXT NOT NULL,
      last_plan_at TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      evidence_node_ids TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE nodes (
      project_id INTEGER NOT NULL,
      id INTEGER NOT NULL,
      description TEXT NOT NULL,
      created_by TEXT NOT NULL,
      edge_id INTEGER,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );
    CREATE TABLE edges (
      project_id INTEGER NOT NULL,
      id INTEGER NOT NULL,
      from_node_ids TEXT NOT NULL DEFAULT '[]',
      to_node_ids TEXT NOT NULL DEFAULT '[]',
      claimed_at TEXT,
      direction_description TEXT NOT NULL,
      failure_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );
  `);
  return sqlite;
}

describe('operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('creates a project with first node', () => {
    const now = new Date().toISOString();
    const projectId = createProject(db, 'test project', 'mock', 'mock:v1', now);
    expect(projectId).toBe(1);

    const project = getProject(db, projectId);
    expect(project).not.toBeNull();
    expect(project!.title).toBe('test project');
    expect(project!.status).toBe('active');

    const nodes = db.prepare('SELECT * FROM nodes WHERE project_id = ?').all(projectId);
    expect(nodes).toHaveLength(1);
    expect((nodes[0] as any).description).toBe('test project');
    expect((nodes[0] as any).created_by).toBe('human');
  });

  it('inserts edges and claims one atomically', () => {
    const now = new Date().toISOString();
    const projectId = createProject(db, 'test', 'mock', 'mock:v1', now);

    insertEdges(db, projectId, [
      { from_node_ids: [1], direction_description: 'scan ports' },
      { from_node_ids: [1], direction_description: 'enum subdomains' },
    ], now);

    const claimed = claimEdge(db, projectId, 3, 30 * 60 * 1000, now);
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(1);
    expect(claimed!.claimed_at).not.toBeNull();

    // Second claim should get the other edge
    const claimed2 = claimEdge(db, projectId, 3, 30 * 60 * 1000, now);
    expect(claimed2).not.toBeNull();
    expect(claimed2!.id).toBe(2);

    // Third claim should return null (no more unclaimed edges under limit)
    const claimed3 = claimEdge(db, projectId, 3, 30 * 60 * 1000, now);
    expect(claimed3).toBeNull();
  });

  it('writes act result atomically', () => {
    const now = new Date().toISOString();
    const projectId = createProject(db, 'test', 'mock', 'mock:v1', now);
    insertEdges(db, projectId, [
      { from_node_ids: [1], direction_description: 'scan' },
    ], now);

    writeActResult(db, projectId, 1, 'Found port 80 open', 'agent', now);

    const nodes = db.prepare('SELECT * FROM nodes WHERE project_id = ? AND created_by = ?').all(projectId, 'agent');
    expect(nodes).toHaveLength(1);
    expect((nodes[0] as any).description).toBe('Found port 80 open');

    const edge = db.prepare('SELECT * FROM edges WHERE project_id = ? AND id = ?').get(projectId, 1);
    expect(JSON.parse((edge as any).to_node_ids)).toEqual([2]);
  });

  it('handles act failure and creates system node at threshold', () => {
    const now = new Date().toISOString();
    const projectId = createProject(db, 'test', 'mock', 'mock:v1', now);
    insertEdges(db, projectId, [
      { from_node_ids: [1], direction_description: 'scan' },
    ], now);

    // Fail once
    handleActFailure(db, projectId, 1, 3, now);
    let edge = db.prepare('SELECT * FROM edges WHERE project_id = ? AND id = ?').get(projectId, 1);
    expect((edge as any).failure_count).toBe(1);
    expect((edge as any).claimed_at).toBeNull();
    expect((edge as any).to_node_ids).toBe('[]');

    // Fail twice
    handleActFailure(db, projectId, 1, 3, now);
    edge = db.prepare('SELECT * FROM edges WHERE project_id = ? AND id = ?').get(projectId, 1);
    expect((edge as any).failure_count).toBe(2);

    // Fail third time → threshold → system node created
    handleActFailure(db, projectId, 1, 3, now);
    edge = db.prepare('SELECT * FROM edges WHERE project_id = ? AND id = ?').get(projectId, 1);
    expect((edge as any).failure_count).toBe(3);
    const toIds = JSON.parse((edge as any).to_node_ids);
    expect(toIds).toHaveLength(1);

    const sysNode = db.prepare('SELECT * FROM nodes WHERE project_id = ? AND id = ?').get(projectId, toIds[0]);
    expect((sysNode as any).created_by).toBe('system');
  });

  it('detects unresulted edges', () => {
    const now = new Date().toISOString();
    const projectId = createProject(db, 'test', 'mock', 'mock:v1', now);
    expect(hasUnresultedEdges(db, projectId)).toBe(false);

    insertEdges(db, projectId, [
      { from_node_ids: [1], direction_description: 'scan' },
    ], now);
    expect(hasUnresultedEdges(db, projectId)).toBe(true);

    writeActResult(db, projectId, 1, 'result', 'agent', now);
    expect(hasUnresultedEdges(db, projectId)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/db/operations.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write operations.ts**

```typescript
import Database from 'better-sqlite3';

function now() {
  return new Date().toISOString();
}

export function createProject(
  db: Database.Database,
  title: string,
  agentType: string,
  imageTag: string,
  ts: string,
): number {
  const result = db.prepare(`
    INSERT INTO projects (title, status, agent_type, image_tag, created_at, updated_at)
    VALUES (?, 'active', ?, ?, ?, ?)
  `).run(title, agentType, imageTag, ts, ts);

  const projectId = result.lastInsertRowid as number;

  db.prepare(`
    INSERT INTO nodes (project_id, id, description, created_by, edge_id, created_at)
    VALUES (?, 1, ?, 'human', NULL, ?)
  `).run(projectId, title, ts);

  return projectId;
}

export function getProject(db: Database.Database, projectId: number) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
}

export function getActiveProjects(db: Database.Database) {
  return db.prepare("SELECT * FROM projects WHERE status = 'active'").all() as any[];
}

export function nextNodeId(db: Database.Database, projectId: number): number {
  const row = db.prepare(
    'SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM nodes WHERE project_id = ?'
  ).get(projectId) as { next_id: number };
  return row.next_id;
}

export function nextEdgeId(db: Database.Database, projectId: number): number {
  const row = db.prepare(
    'SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM edges WHERE project_id = ?'
  ).get(projectId) as { next_id: number };
  return row.next_id;
}

export function insertNode(
  db: Database.Database,
  projectId: number,
  description: string,
  createdBy: string,
  edgeId: number | null,
  ts: string,
): number {
  const id = nextNodeId(db, projectId);
  db.prepare(`
    INSERT INTO nodes (project_id, id, description, created_by, edge_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(projectId, id, description, createdBy, edgeId, ts);
  return id;
}

export function insertEdges(
  db: Database.Database,
  projectId: number,
  edges: { from_node_ids: number[]; direction_description: string }[],
  ts: string,
): number[] {
  const ids: number[] = [];
  for (const edge of edges) {
    const id = nextEdgeId(db, projectId);
    db.prepare(`
      INSERT INTO edges (project_id, id, from_node_ids, to_node_ids, direction_description, created_at)
      VALUES (?, ?, ?, '[]', ?, ?)
    `).run(projectId, id, JSON.stringify(edge.from_node_ids), edge.direction_description, ts);
    ids.push(id);
  }
  return ids;
}

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
      LIMIT 1
    )
    RETURNING *
  `).get(ts, projectId, projectId, maxFailures, expiredAt) as any;

  if (!row) return null;

  return {
    ...row,
    to_node_ids: JSON.parse(row.to_node_ids),
    from_node_ids: JSON.parse(row.from_node_ids),
  };
}

export function writeActResult(
  db: Database.Database,
  projectId: number,
  edgeId: number,
  description: string,
  createdBy: string,
  ts: string,
): number {
  const nodeId = nextNodeId(db, projectId);

  const txn = db.transaction(() => {
    db.prepare(`
      INSERT INTO nodes (project_id, id, description, created_by, edge_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(projectId, nodeId, description, createdBy, edgeId, ts);

    db.prepare(`
      UPDATE edges SET to_node_ids = json_array(?)
      WHERE project_id = ? AND id = ? AND to_node_ids = '[]'
    `).run(nodeId, projectId, edgeId);
  });

  txn();
  return nodeId;
}

export function handleActFailure(
  db: Database.Database,
  projectId: number,
  edgeId: number,
  maxFailures: number,
  ts: string,
): { nodeCreated: boolean; nodeId?: number } {
  const txn = db.transaction(() => {
    db.prepare(`
      UPDATE edges SET failure_count = failure_count + 1, claimed_at = NULL
      WHERE project_id = ? AND id = ?
    `).run(projectId, edgeId);

    const edge = db.prepare(
      'SELECT failure_count FROM edges WHERE project_id = ? AND id = ?'
    ).get(projectId, edgeId) as { failure_count: number };

    if (edge.failure_count >= maxFailures) {
      const description = `运行超时 ${edge.failure_count} 次`;
      const nodeId = nextNodeId(db, projectId);
      db.prepare(`
        INSERT INTO nodes (project_id, id, description, created_by, edge_id, created_at)
        VALUES (?, ?, ?, 'system', ?, ?)
      `).run(projectId, nodeId, description, edgeId, ts);
      db.prepare(`
        UPDATE edges SET to_node_ids = json_array(?)
        WHERE project_id = ? AND id = ? AND to_node_ids = '[]'
      `).run(nodeId, projectId, edgeId);
      return { nodeCreated: true, nodeId };
    }

    return { nodeCreated: false };
  });

  return txn();
}

export function hasUnresultedEdges(db: Database.Database, projectId: number): boolean {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM edges WHERE project_id = ? AND to_node_ids = '[]'"
  ).get(projectId) as { count: number };
  return row.count > 0;
}

export function hasNewNodesSince(db: Database.Database, projectId: number, since: string): boolean {
  const row = db.prepare(
    'SELECT COUNT(*) as count FROM nodes WHERE project_id = ? AND created_at > ?'
  ).get(projectId, since) as { count: number };
  return row.count > 0;
}

export function countActiveActs(db: Database.Database, projectId: number): number {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM edges WHERE project_id = ? AND to_node_ids = '[]' AND claimed_at IS NOT NULL"
  ).get(projectId) as { count: number };
  return row.count;
}

export function getSnapshotData(db: Database.Database, projectId: number) {
  const nodes = db.prepare(
    'SELECT id, description, created_by, edge_id, created_at FROM nodes WHERE project_id = ? ORDER BY created_at ASC'
  ).all(projectId) as any[];

  const edges = db.prepare(
    'SELECT id, from_node_ids, to_node_ids, claimed_at, direction_description, failure_count, created_at FROM edges WHERE project_id = ? ORDER BY created_at ASC'
  ).all(projectId) as any[];

  return {
    nodes,
    edges: edges.map(e => ({
      ...e,
      from_node_ids: JSON.parse(e.from_node_ids),
      to_node_ids: JSON.parse(e.to_node_ids),
    })),
  };
}

export function updateProject(
  db: Database.Database,
  projectId: number,
  updates: {
    status?: string;
    lastPlanAt?: string;
    failureCount?: number;
    summary?: string | null;
    evidenceNodeIds?: number[] | null;
  },
  ts: string,
) {
  const sets: string[] = ['updated_at = ?'];
  const values: any[] = [ts];

  if (updates.status !== undefined) {
    sets.push('status = ?');
    values.push(updates.status);
  }
  if (updates.lastPlanAt !== undefined) {
    sets.push('last_plan_at = ?');
    values.push(updates.lastPlanAt);
  }
  if (updates.failureCount !== undefined) {
    sets.push('failure_count = ?');
    values.push(updates.failureCount);
  }
  if (updates.summary !== undefined) {
    sets.push('summary = ?');
    values.push(updates.summary === null ? null : updates.summary);
  }
  if (updates.evidenceNodeIds !== undefined) {
    sets.push('evidence_node_ids = ?');
    values.push(updates.evidenceNodeIds === null ? null : JSON.stringify(updates.evidenceNodeIds));
  }

  values.push(projectId);
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function setProjectLastPlanAt(
  db: Database.Database,
  projectId: number,
  ts: string,
) {
  db.prepare(`
    UPDATE projects SET last_plan_at = ?, failure_count = 0, updated_at = ?
    WHERE id = ?
  `).run(ts, ts, projectId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run src/db/operations.test.ts
```

Expected: All tests PASS.

---

### Task 6: Snapshot Renderer

**Files:**
- Create: `src/snapshot/render.ts`, `src/snapshot/render.test.ts`

- [ ] **Step 1: Write failing tests for snapshot renderer**

Create `src/snapshot/render.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { renderSnapshot } from './render';
import { createProject, insertEdges, writeActResult } from '../db/operations';
import type { Snapshot } from '../types';

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', agent_type TEXT NOT NULL, image_tag TEXT NOT NULL, last_plan_at TEXT, failure_count INTEGER NOT NULL DEFAULT 0, summary TEXT, evidence_node_ids TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE nodes (project_id INTEGER NOT NULL, id INTEGER NOT NULL, description TEXT NOT NULL, created_by TEXT NOT NULL, edge_id INTEGER, created_at TEXT NOT NULL, PRIMARY KEY (project_id, id));
    CREATE TABLE edges (project_id INTEGER NOT NULL, id INTEGER NOT NULL, from_node_ids TEXT NOT NULL DEFAULT '[]', to_node_ids TEXT NOT NULL DEFAULT '[]', claimed_at TEXT, direction_description TEXT NOT NULL, failure_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, PRIMARY KEY (project_id, id));
  `);
  return sqlite;
}

describe('renderSnapshot', () => {
  let db: Database.Database;
  let projectId: number;
  const now = '2026-05-14T00:00:00.000Z';

  beforeEach(() => {
    db = createTestDb();
    projectId = createProject(db, 'test', 'mock', 'mock:v1', now);
  });

  it('renders a simple snapshot with one node', () => {
    const snap = renderSnapshot(db, projectId, { snapshotMaxNodes: 100, snapshotMaxEdges: 200 });
    expect(snap.nodes).toHaveLength(1);
    expect(snap.nodes[0].id).toBe(1);
    expect(snap.nodes[0].description).toBe('test');
    expect(snap.nodes[0].created_by).toBe('human');
    expect(snap.edges).toHaveLength(0);
  });

  it('includes edges and their nodes', () => {
    insertEdges(db, projectId, [{ from_node_ids: [1], direction_description: 'scan' }], now);
    writeActResult(db, projectId, 1, 'Port 80 open', 'agent', '2026-05-14T00:01:00.000Z');

    const snap = renderSnapshot(db, projectId, { snapshotMaxNodes: 100, snapshotMaxEdges: 200 });
    expect(snap.nodes).toHaveLength(2);
    expect(snap.edges).toHaveLength(1);
    expect(snap.edges[0].direction_description).toBe('scan');
    expect(snap.edges[0].to_node_ids).toEqual([2]);
  });

  it('truncates old agent nodes while preserving human nodes and unresulted edges', () => {
    const times = Array.from({ length: 10 }, (_, i) =>
      `2026-05-14T00:0${i}:00.000Z`
    );

    for (let i = 0; i < 10; i++) {
      insertEdges(db, projectId, [{ from_node_ids: [i + 1], direction_description: `step ${i}` }], times[i]);
      writeActResult(db, projectId, i + 1, `result ${i}`, 'agent', times[i]);
    }

    // Add an unresulted edge that must be preserved
    insertEdges(db, projectId, [{ from_node_ids: [1], direction_description: 'pending step' }], '2026-05-14T00:10:00.000Z');

    const snap = renderSnapshot(db, projectId, { snapshotMaxNodes: 5, snapshotMaxEdges: 200 });

    // Human node (id=1) must be preserved
    const humanNode = snap.nodes.find(n => n.created_by === 'human');
    expect(humanNode).toBeDefined();

    // Unresulted edge must be preserved
    const pendingEdge = snap.edges.find(e => e.to_node_ids.length === 0);
    expect(pendingEdge).toBeDefined();
    expect(pendingEdge!.direction_description).toBe('pending step');

    // Recent agent nodes should be present
    expect(snap.nodes.length).toBeLessThanOrEqual(5 + 1); // +1 for human node that's always kept
  });

  it('marks truncated snapshot', () => {
    const times = Array.from({ length: 10 }, (_, i) =>
      `2026-05-14T00:0${i}:00.000Z`
    );

    for (let i = 0; i < 10; i++) {
      insertEdges(db, projectId, [{ from_node_ids: [Math.max(1, i)], direction_description: `step ${i}` }], times[i]);
      writeActResult(db, projectId, i + 1, `result ${i}`, 'agent', times[i]);
    }

    const snap = renderSnapshot(db, projectId, { snapshotMaxNodes: 3, snapshotMaxEdges: 200 });
    expect(snap.nodes.length).toBeLessThan(10 + 1); // truncated
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/snapshot/render.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write render.ts**

```typescript
import Database from 'better-sqlite3';
import type { Snapshot, SnapshotNode, SnapshotEdge } from '../types';

export function renderSnapshot(
  db: Database.Database,
  projectId: number,
  limits: { snapshotMaxNodes: number; snapshotMaxEdges: number },
): Snapshot {
  const nodes = db.prepare(
    'SELECT id, description, created_by FROM nodes WHERE project_id = ? ORDER BY created_at ASC'
  ).all(projectId) as SnapshotNode[];

  const edges = db.prepare(
    'SELECT id, from_node_ids, to_node_ids, direction_description, failure_count FROM edges WHERE project_id = ? ORDER BY created_at ASC'
  ).all(projectId) as any[];

  const parsedEdges = edges.map(e => ({
    ...e,
    from_node_ids: JSON.parse(e.from_node_ids),
    to_node_ids: JSON.parse(e.to_node_ids),
  }));

  if (nodes.length <= limits.snapshotMaxNodes && parsedEdges.length <= limits.snapshotMaxEdges) {
    return { nodes, edges: parsedEdges };
  }

  // Truncation logic
  const humanNodes = nodes.filter(n => n.created_by === 'human');
  const unresultedEdges = parsedEdges.filter(e => e.to_node_ids.length === 0);
  const unresultedNodeIds = new Set<number>();
  for (const e of unresultedEdges) {
    for (const nid of e.from_node_ids) unresultedNodeIds.add(nid);
  }

  // Keep human nodes and nodes referenced by unresulted edges
  const alwaysKeepIds = new Set<number>();
  for (const n of humanNodes) alwaysKeepIds.add(n.id);
  for (const nid of unresultedNodeIds) alwaysKeepIds.add(nid);

  const otherNodes = nodes
    .filter(n => n.created_by !== 'human' && !alwaysKeepIds.has(n.id))
    .reverse(); // newest first

  const keepSlots = limits.snapshotMaxNodes - alwaysKeepIds.size;
  const keptOtherNodes = otherNodes.slice(0, Math.max(0, keepSlots));

  const keptNodeIds = new Set<number>([
    ...alwaysKeepIds,
    ...keptOtherNodes.map(n => n.id),
  ]);

  // Filter edges: keep unresulted edges + edges where all endpoints are kept
  const keptEdges = parsedEdges.filter(e => {
    if (e.to_node_ids.length === 0) return true; // unresulted edges always kept
    const allEndpoints = [...e.from_node_ids, ...e.to_node_ids];
    return allEndpoints.every(nid => keptNodeIds.has(nid));
  });

  // Also keep unresulted edges' from_node_ids nodes
  for (const e of keptEdges) {
    if (e.to_node_ids.length === 0) {
      for (const nid of e.from_node_ids) keptNodeIds.add(nid);
    }
  }

  const keptNodes = nodes.filter(n => keptNodeIds.has(n.id));

  const finalEdges = keptEdges.slice(
    Math.max(0, keptEdges.length - limits.snapshotMaxEdges)
  );

  // Re-filter nodes based on final edge set
  const finalNodeIds = new Set<number>();
  for (const n of humanNodes) finalNodeIds.add(n.id);
  for (const e of finalEdges) {
    for (const nid of e.from_node_ids) finalNodeIds.add(nid);
    for (const nid of e.to_node_ids) finalNodeIds.add(nid);
  }

  const finalNodes = nodes.filter(n => finalNodeIds.has(n.id));

  return { nodes: finalNodes, edges: finalEdges };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run src/snapshot/render.test.ts
```

Expected: All tests PASS.

---

### Task 7: Prompt Templates

**Files:**
- Create: `src/prompt/plan.ts`, `src/prompt/act.ts`

- [ ] **Step 1: Write prompt templates**

Create `src/prompt/plan.ts`:

```typescript
import type { Snapshot } from '../types';

export function renderPlanPrompt(snapshot: Snapshot, projectId: number): string {
  return `# 任务：规划下一步探索方向

## 当前探索图
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## 你的任务
基于以上信息，判断下一步应该探索什么方向。

1. 如果认为任务已完成，返回 \`complete: true\`，附带 \`summary\` 和 \`evidence_node_ids\`
2. 如果认为还有探索方向，返回新的 Edge 列表
3. 如果无法继续且未完成，返回空 edges 数组（\`complete: false\`）

## 输出格式
请以 JSON 格式输出，严格遵循以下 Schema：

\`\`\`json
{
  "edges": [
    {
      "from_node_ids": [1, 3],
      "direction_description": "尝试 SQL 注入登录表单"
    }
  ],
  "complete": false
}
\`\`\`

## 约束
- 每条 Edge 的 \`from_node_ids\` 必须引用已有 Node 的 ID
- Node description 只放结论摘要和文件路径（不超过 500 字符）
- 大量原始数据写入文件，description 中用路径引用
- 仅当判定任务完成时才返回 \`complete: true\` 和 \`summary\`、\`evidence_node_ids\`
- \`complete: true\` 时 \`edges\` 必须为空数组
- \`complete: false\` 时不要返回 \`summary\` 和 \`evidence_node_ids\` 字段
- 当前工作目录根路径：/home/kali/workspace/

project_id: ${projectId}`;
}
```

Create `src/prompt/act.ts`:

```typescript
import type { Snapshot } from '../types';

export function renderActPrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
  projectId: number,
  edgeId: number,
): string {
  return `# 任务：执行探索方向

## 当前探索图
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## 你的探索方向
${directionDescription}

## 你的任务
沿上述方向执行探索，产出客观结论。

## 工作目录
${workdir}

## 输出格式
请以 JSON 格式输出，严格遵循以下 Schema：

\`\`\`json
{
  "description": "探索结论摘要"
}
\`\`\`

## 约束
- description 只放结论摘要和文件路径（不超过 500 字符）
- 大量原始数据写入文件（当前工作目录下），description 中用路径引用

project_id: ${projectId}
edge_id: ${edgeId}`;
}
```

---

### Task 8: Driver Types + Mock Driver

**Files:**
- Create: `src/driver/types.ts`, `src/driver/mock.ts`, `src/driver/mock.test.ts`

- [ ] **Step 1: Write driver types**

Create `src/driver/types.ts`:

```typescript
export interface AgentOutput {
  description: string;
}

export interface PlanEdge {
  from_node_ids: number[];
  direction_description: string;
}

export interface PlanOutput {
  edges: PlanEdge[];
  complete: boolean;
  summary?: string;
  evidence_node_ids?: number[];
}

export interface ActResult {
  output: AgentOutput;
  sessionId: string;
}

export interface AgentDriver {
  executePlan(params: {
    prompt: string;
    workdir: string;
    timeout: number;
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

- [ ] **Step 2: Write mock driver**

Create `src/driver/mock.ts`:

```typescript
import type { AgentDriver, AgentOutput, ActResult, PlanOutput } from './types';

export class MockAgentDriver implements AgentDriver {
  private planCounts = new Map<number, number>();
  private actCounts = new Map<string, number>();
  private scenarios: Map<number, PlanOutput[]>;

  constructor(scenarios?: Map<number, PlanOutput[]>) {
    this.scenarios = scenarios || new Map();
  }

  setScenario(projectId: number, plans: PlanOutput[]) {
    this.scenarios.set(projectId, plans);
    this.planCounts.delete(projectId);
  }

  async executePlan(params: { prompt: string; workdir: string; timeout: number }): Promise<PlanOutput> {
    const projectId = this.extractProjectId(params.prompt);
    const count = (this.planCounts.get(projectId) || 0) + 1;
    this.planCounts.set(projectId, count);

    const scenario = this.scenarios.get(projectId);
    if (scenario && scenario.length >= count) {
      return scenario[count - 1];
    }

    // Default scenario
    if (count === 1) {
      return {
        edges: [
          { from_node_ids: [1], direction_description: '扫描目标开放端口和服务' },
          { from_node_ids: [1], direction_description: '枚举子域名和虚拟主机' },
        ],
        complete: false,
      };
    }

    return {
      edges: [],
      complete: true,
      summary: '已完成信息收集，判定任务完成',
      evidence_node_ids: [2, 3],
    };
  }

  async executeAct(params: { prompt: string; workdir: string; timeout: number }): Promise<ActResult> {
    const edgeId = this.extractEdgeId(params.prompt);
    const sessionId = `mock-session-${Date.now()}`;

    return {
      output: {
        description: `探索结果 [Edge ${edgeId}]: 发现开放端口和服务信息`,
      },
      sessionId,
    };
  }

  async conclude(params: { sessionId: string; prompt: string; workdir: string; timeout: number }): Promise<AgentOutput> {
    return {
      description: '超时前部分结果：收集到部分信息',
    };
  }

  private extractProjectId(prompt: string): number {
    const match = prompt.match(/project_id:\s*(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  private extractEdgeId(prompt: string): number {
    const match = prompt.match(/edge_id:\s*(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }
}
```

- [ ] **Step 3: Write mock driver test**

Create `src/driver/mock.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MockAgentDriver } from './mock';

describe('MockAgentDriver', () => {
  it('returns edges on first plan', async () => {
    const driver = new MockAgentDriver();
    const result = await driver.executePlan({
      prompt: 'project_id: 1\ntest',
      workdir: '/tmp',
      timeout: 1000,
    });

    expect(result.complete).toBe(false);
    expect(result.edges).toHaveLength(2);
    expect(result.edges[0].direction_description).toBe('扫描目标开放端口和服务');
  });

  it('returns complete on second plan', async () => {
    const driver = new MockAgentDriver();
    await driver.executePlan({ prompt: 'project_id: 1\n', workdir: '/tmp', timeout: 1000 });
    const result = await driver.executePlan({ prompt: 'project_id: 1\n', workdir: '/tmp', timeout: 1000 });

    expect(result.complete).toBe(true);
    expect(result.edges).toHaveLength(0);
    expect(result.summary).toBeDefined();
  });

  it('uses custom scenario', async () => {
    const driver = new MockAgentDriver();
    driver.setScenario(1, [
      { edges: [{ from_node_ids: [1], direction_description: 'custom step' }], complete: false },
      { edges: [], complete: true, summary: 'done', evidence_node_ids: [2] },
    ]);

    const r1 = await driver.executePlan({ prompt: 'project_id: 1\n', workdir: '/tmp', timeout: 1000 });
    expect(r1.edges[0].direction_description).toBe('custom step');

    const r2 = await driver.executePlan({ prompt: 'project_id: 1\n', workdir: '/tmp', timeout: 1000 });
    expect(r2.complete).toBe(true);
    expect(r2.summary).toBe('done');
  });
});
```

- [ ] **Step 4: Run mock tests**

```bash
pnpm vitest run src/driver/mock.test.ts
```

Expected: All tests PASS.

---

### Task 9: Plan Execution Logic

**Files:**
- Create: `src/executor/plan-exec.ts`

- [ ] **Step 1: Write plan execution logic**

```typescript
import Database from 'better-sqlite3';
import { renderSnapshot } from '../snapshot/render';
import { renderPlanPrompt } from '../prompt/plan';
import { config } from '../config';
import { getProject, hasUnresultedEdges, hasNewNodesSince, insertEdges, setProjectLastPlanAt, updateProject } from '../db/operations';
import type { AgentDriver } from '../driver/types';
import type { PlanOutput } from '../driver/types';
import { z } from 'zod';

const planEdgeSchema = z.object({
  from_node_ids: z.array(z.number()).default([]),
  direction_description: z.string(),
});

const planOutputSchema = z.object({
  edges: z.array(planEdgeSchema).default([]),
  complete: z.boolean().default(false),
  summary: z.string().optional(),
  evidence_node_ids: z.array(z.number()).optional(),
});

export function shouldTriggerPlan(db: Database.Database, projectId: number): boolean {
  const project = getProject(db, projectId);
  if (!project || project.status !== 'active') return false;

  const unresulted = hasUnresultedEdges(db, projectId);
  if (unresulted) return false;

  if (!project.last_plan_at) return true;

  return hasNewNodesSince(db, projectId, project.last_plan_at);
}

export function executePlan(
  db: Database.Database,
  projectId: number,
  driver: AgentDriver,
  ts: string,
): Promise<{ success: boolean; error?: string }> {
  const snapshot = renderSnapshot(db, projectId, {
    snapshotMaxNodes: config.snapshotMaxNodes,
    snapshotMaxEdges: config.snapshotMaxEdges,
  });

  const prompt = renderPlanPrompt(snapshot, projectId);

  return driver.executePlan({
    prompt,
    workdir: '/home/kali/workspace/',
    timeout: config.planTimeoutMs,
  }).then((output) => {
    return writePlan(db, projectId, output, ts);
  }).catch((err) => {
    return handlePlanFailure(db, projectId, ts, err.message);
  });
}

function writePlan(
  db: Database.Database,
  projectId: number,
  output: PlanOutput,
  ts: string,
): { success: boolean; error?: string } {
  // Validate
  const parsed = planOutputSchema.safeParse(output);
  if (!parsed.success) {
    return handlePlanFailure(db, projectId, ts, `Invalid JSON: ${parsed.error.message}`);
  }

  const plan = parsed.data;

  // Validate combinations
  if (plan.complete && plan.edges.length > 0) {
    return handlePlanFailure(db, projectId, ts, 'complete=true but edges non-empty');
  }
  if (plan.complete && (!plan.summary || !plan.evidence_node_ids)) {
    return handlePlanFailure(db, projectId, ts, 'complete=true but missing summary or evidence_node_ids');
  }
  if (!plan.complete && plan.edges.length === 0) {
    // Empty edges + not complete → project failed
    const failTxn = db.transaction(() => {
      updateProject(db, projectId, { status: 'failed' }, ts);
    });
    failTxn();
    return { success: true };
  }

  const txn = db.transaction(() => {
    if (plan.complete) {
      updateProject(db, projectId, {
        status: 'completed',
        summary: plan.summary!,
        evidenceNodeIds: plan.evidence_node_ids!,
      }, ts);
    }

    if (plan.edges.length > 0) {
      insertEdges(db, projectId, plan.edges.map(e => ({
        from_node_ids: e.from_node_ids,
        direction_description: e.direction_description,
      })), ts);
    }

    setProjectLastPlanAt(db, projectId, ts);
  });

  try {
    txn();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

function handlePlanFailure(
  db: Database.Database,
  projectId: number,
  ts: string,
  error: string,
): { success: boolean; error?: string } {
  const project = getProject(db, projectId);
  if (!project) return { success: false, error };

  const newCount = project.failure_count + 1;

  if (newCount >= config.maxFailures) {
    db.transaction(() => {
      updateProject(db, projectId, {
        status: 'failed',
        failureCount: newCount,
      }, ts);
    })();
    return { success: false, error: `Plan failed ${newCount} times: ${error}. Project marked as failed.` };
  }

  updateProject(db, projectId, { failureCount: newCount }, ts);
  return { success: false, error };
}
```

---

### Task 10: Act Execution Logic

**Files:**
- Create: `src/executor/act-exec.ts`

- [ ] **Step 1: Write act execution logic**

```typescript
import Database from 'better-sqlite3';
import { renderSnapshot } from '../snapshot/render';
import { renderActPrompt } from '../prompt/act';
import { config } from '../config';
import { claimEdge, writeActResult, handleActFailure, countActiveActs } from '../db/operations';
import type { AgentDriver } from '../driver/types';
import { z } from 'zod';

const agentOutputSchema = z.object({
  description: z.string(),
});

export function canExecuteAct(db: Database.Database, projectId: number): boolean {
  const active = countActiveActs(db, projectId);
  return active < config.maxActConcurrency;
}

export function executeAct(
  db: Database.Database,
  projectId: number,
  driver: AgentDriver,
  ts: string,
): Promise<{ success: boolean; edgeId?: number; error?: string }> {
  const edge = claimEdge(db, projectId, config.maxFailures, config.claimedExpiryMs, ts);
  if (!edge) return Promise.resolve({ success: false, error: 'No unclaimed edge' });

  const snapshot = renderSnapshot(db, projectId, {
    snapshotMaxNodes: config.snapshotMaxNodes,
    snapshotMaxEdges: config.snapshotMaxEdges,
  });

  const workdir = `/home/kali/workspace/task_${edge.id}/`;
  const prompt = renderActPrompt(snapshot, edge.direction_description, workdir, projectId, edge.id);

  return driver.executeAct({
    prompt,
    workdir,
    timeout: config.actTimeoutMs,
  }).then((result) => {
    const parsed = agentOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      handleActFailure(db, projectId, edge.id, config.maxFailures, ts);
      return { success: false, edgeId: edge.id, error: `Invalid output: ${parsed.error.message}` };
    }

    try {
      writeActResult(db, projectId, edge.id, parsed.data.description, 'agent', ts);
      return { success: true, edgeId: edge.id };
    } catch (err: any) {
      return { success: false, edgeId: edge.id, error: err.message };
    }
  }).catch((err) => {
    handleActFailure(db, projectId, edge.id, config.maxFailures, ts);
    return { success: false, edgeId: edge.id, error: err.message };
  });
}
```

---

### Task 11: Main Loop

**Files:**
- Create: `src/executor/loop.ts`

- [ ] **Step 1: Write main loop**

```typescript
import Database from 'better-sqlite3';
import type { AgentDriver } from '../driver/types';
import { getActiveProjects, hasUnresultedEdges, countActiveActs } from '../db/operations';
import { shouldTriggerPlan, executePlan } from './plan-exec';
import { canExecuteAct, executeAct } from './act-exec';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ name: 'executor-loop' });

interface LoopState {
  running: boolean;
  planInFlight: Set<number>;
  actsInFlight: Map<number, number>; // projectId → count
}

export function createLoop(db: Database.Database, driver: AgentDriver) {
  const state: LoopState = {
    running: false,
    planInFlight: new Set(),
    actsInFlight: new Map(),
  };

  async function tick() {
    const ts = new Date().toISOString();
    const projects = getActiveProjects(db);

    for (const project of projects) {
      const pid = project.id;

      // Plan is currently executing → skip
      if (state.planInFlight.has(pid)) continue;

      // Check if Plan should be triggered
      if (shouldTriggerPlan(db, pid)) {
        state.planInFlight.add(pid);
        logger.info({ projectId: pid }, 'Triggering Plan');

        executePlan(db, pid, driver, ts).then((result) => {
          state.planInFlight.delete(pid);
          if (result.success) {
            logger.info({ projectId: pid }, 'Plan completed successfully');
          } else {
            logger.warn({ projectId: pid, error: result.error }, 'Plan failed');
          }
        });
        continue;
      }

      // Try to execute an Act
      if (hasUnresultedEdges(db, pid) && canExecuteAct(db, pid)) {
        const inflight = state.actsInFlight.get(pid) || 0;
        state.actsInFlight.set(pid, inflight + 1);

        executeAct(db, pid, driver, ts).then((result) => {
          const current = state.actsInFlight.get(pid) || 1;
          if (current <= 1) {
            state.actsInFlight.delete(pid);
          } else {
            state.actsInFlight.set(pid, current - 1);
          }

          if (result.success) {
            logger.info({ projectId: pid, edgeId: result.edgeId }, 'Act completed');
          } else {
            logger.warn({ projectId: pid, edgeId: result.edgeId, error: result.error }, 'Act failed');
          }
        });
      }
    }
  }

  function start() {
    state.running = true;
    logger.info('Executor loop started');

    const interval = setInterval(() => {
      if (!state.running) {
        clearInterval(interval);
        return;
      }
      tick().catch((err) => {
        logger.error({ err }, 'Tick error');
      });
    }, 1000);

    return () => {
      state.running = false;
      clearInterval(interval);
      logger.info('Executor loop stopped');
    };
  }

  return { start };
}
```

---

### Task 12: CLI Entry Point

**Files:**
- Create: `src/executor/main.ts`

- [ ] **Step 1: Write main.ts**

```typescript
import { initDb, getRawDb } from '../db/connection';
import { createProject } from '../db/operations';
import { MockAgentDriver } from '../driver/mock';
import { createLoop } from './loop';
import type { PlanOutput } from '../driver/types';

const db = getRawDb();

const driver = new MockAgentDriver();

// Demo scenario: 2-round plan → complete
driver.setScenario(1, [
  {
    edges: [
      { from_node_ids: [1], direction_description: '扫描目标开放端口和服务版本' },
      { from_node_ids: [1], direction_description: '枚举子域名和虚拟主机' },
    ],
    complete: false,
  },
  {
    edges: [],
    complete: true,
    summary: '已完成信息收集：发现 80/443 端口开放，Apache 2.4.49 存在 CVE-2021-41773',
    evidence_node_ids: [2, 3],
  },
]);

const now = new Date().toISOString();
const projectId = createProject(db, '帮我拿到 flag。https://hackme.com', 'mock', 'mock:v1', now);

console.log(`Project ${projectId} created with title: "帮我拿到 flag。https://hackme.com"`);
console.log('Starting executor loop...');

const { start } = createLoop(db, driver);
const stop = start();

let tickCount = 0;
const watcher = setInterval(() => {
  tickCount++;
  const project = db.prepare('SELECT status, summary FROM projects WHERE id = ?').get(projectId) as any;
  const nodeCount = (db.prepare('SELECT COUNT(*) as c FROM nodes WHERE project_id = ?').get(projectId) as any).c;
  const edgeCount = (db.prepare('SELECT COUNT(*) as c FROM edges WHERE project_id = ?').get(projectId) as any).c;

  console.log(`[${tickCount}s] Status: ${project.status} | Nodes: ${nodeCount} | Edges: ${edgeCount}`);

  if (project.status === 'completed') {
    console.log(`\nProject completed!`);
    console.log(`Summary: ${project.summary}`);
    stop();
    clearInterval(watcher);
    process.exit(0);
  }

  if (project.status === 'failed') {
    console.log(`\nProject failed.`);
    stop();
    clearInterval(watcher);
    process.exit(1);
  }

  if (tickCount > 30) {
    console.log(`\nTimeout after 30 seconds.`);
    stop();
    clearInterval(watcher);
    process.exit(1);
  }
}, 1000);

process.on('SIGINT', () => {
  stop();
  clearInterval(watcher);
  process.exit(0);
});
```

---

### Task 13: Integration Test

**Files:**
- Create: `src/executor/loop.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MockAgentDriver } from '../driver/mock';
import { createProject, getProject } from '../db/operations';
import { createLoop } from './loop';
import type { PlanOutput } from '../driver/types';

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', agent_type TEXT NOT NULL, image_tag TEXT NOT NULL, last_plan_at TEXT, failure_count INTEGER NOT NULL DEFAULT 0, summary TEXT, evidence_node_ids TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE nodes (project_id INTEGER NOT NULL, id INTEGER NOT NULL, description TEXT NOT NULL, created_by TEXT NOT NULL, edge_id INTEGER, created_at TEXT NOT NULL, PRIMARY KEY (project_id, id));
    CREATE TABLE edges (project_id INTEGER NOT NULL, id INTEGER NOT NULL, from_node_ids TEXT NOT NULL DEFAULT '[]', to_node_ids TEXT NOT NULL DEFAULT '[]', claimed_at TEXT, direction_description TEXT NOT NULL, failure_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, PRIMARY KEY (project_id, id));
  `);
  return sqlite;
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Executor Loop Integration', () => {
  it('completes a full Plan→Act→Plan→complete cycle', async () => {
    const db = createTestDb();
    const driver = new MockAgentDriver();

    driver.setScenario(1, [
      {
        edges: [
          { from_node_ids: [1], direction_description: '扫描端口' },
          { from_node_ids: [1], direction_description: '枚举子域名' },
        ],
        complete: false,
      },
      {
        edges: [],
        complete: true,
        summary: '任务完成',
        evidence_node_ids: [2, 3],
      },
    ]);

    const now = new Date().toISOString();
    const projectId = createProject(db, 'Test project', 'mock', 'mock:v1', now);

    const { start } = createLoop(db, driver);
    const stop = start();

    // Wait for up to 15 seconds for completion
    for (let i = 0; i < 30; i++) {
      await delay(500);
      const project = getProject(db, projectId);
      if (project && project.status === 'completed') break;
    }

    stop();

    const project = getProject(db, projectId);
    expect(project).not.toBeNull();
    expect(project!.status).toBe('completed');
    expect(project!.summary).toBe('任务完成');

    // Verify graph structure
    const nodes = db.prepare('SELECT * FROM nodes WHERE project_id = ? ORDER BY id').all(projectId) as any[];
    expect(nodes.length).toBeGreaterThanOrEqual(3); // human + 2 agent nodes from acts

    const edges = db.prepare('SELECT * FROM edges WHERE project_id = ? ORDER BY id').all(projectId) as any[];
    expect(edges.length).toBeGreaterThanOrEqual(2);

    // All edges should have results
    for (const edge of edges) {
      const toIds = JSON.parse(edge.to_node_ids);
      expect(toIds.length).toBeGreaterThan(0);
    }
  }, 15000);
});
```

- [ ] **Step 2: Run integration test**

```bash
pnpm vitest run src/executor/loop.test.ts
```

Expected: PASS after ~5-10 seconds.

---

### Task 14: Verification & Polish

- [ ] **Step 1: Run all tests**

```bash
pnpm vitest run
```

Expected: All tests PASS.

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: No errors.

- [ ] **Step 3: Run dev demo**

```bash
pnpm dev
```

Expected: Console output showing project creation, Plan triggered, Acts executing, project completed within ~5-10 seconds.

- [ ] **Step 4: Fix any issues found**

Address any lint errors, type errors, or test failures found in steps 1-3.
