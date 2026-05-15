import { sqliteTable, integer, text, primaryKey } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  status: text('status').notNull().default('active'),
  agentType: text('agent_type').notNull(),
  imageTag: text('image_tag').notNull(),
  lastPlanAt: text('last_plan_at'),
  planRound: integer('plan_round').notNull().default(0),
  failureCount: integer('failure_count').notNull().default(0),
  summary: text('summary'),
  evidenceNodeIds: text('evidence_node_ids', { mode: 'json' }).$type<number[]>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const nodes = sqliteTable('nodes', {
  projectId: integer('project_id').notNull(),
  id: integer('id').notNull(),
  title: text('title'),
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
  title: text('title'),
  directionDescription: text('direction_description').notNull(),
  failureCount: integer('failure_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.projectId, table.id] }),
}));
