import { z } from 'zod';

export const createProjectSchema = z.object({
  title: z.string().min(1),
  agent_type: z.string().min(1),
});

export const pushProjectSchema = z.object({
  nodes: z.array(z.object({
    description: z.string().min(1),
  })).optional().default([]),
});

export const projectListItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  status: z.string(),
  agent_type: z.string(),
  node_count: z.number(),
  edge_total: z.number(),
  edge_unresulted: z.number(),
  edge_inflight: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const nodeSchema = z.object({
  id: z.number(),
  title: z.string().nullable(),
  description: z.string(),
  created_by: z.string(),
  edge_id: z.number().nullable(),
  created_at: z.string(),
});

export const edgeSchema = z.object({
  id: z.number(),
  from_node_ids: z.array(z.number()),
  to_node_ids: z.array(z.number()),
  title: z.string().nullable(),
  direction_description: z.string(),
  failure_count: z.number(),
  claimed_at: z.string().nullable(),
  created_at: z.string(),
});

export const projectDetailSchema = z.object({
  id: z.number(),
  title: z.string(),
  status: z.string(),
  agent_type: z.string(),
  image_tag: z.string(),
  last_plan_at: z.string().nullable(),
  failure_count: z.number(),
  summary: z.string().nullable(),
  evidence_node_ids: z.array(z.number()).nullable(),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  created_at: z.string(),
  updated_at: z.string(),
});

export const edgeStatusSchema = z.object({
  id: z.number(),
  from_node_ids: z.array(z.number()),
  to_node_ids: z.array(z.number()),
  title: z.string().nullable(),
  direction_description: z.string(),
  failure_count: z.number(),
  claimed_at: z.string().nullable(),
  created_at: z.string(),
  status: z.enum(['pending', 'running', 'completed']),
});

export const settingsSchema = z.object({
  actTimeoutMs: z.number().int().min(1000).optional(),
  planTimeoutMs: z.number().int().min(1000).optional(),
  claimedExpiryMs: z.number().int().min(1000).optional(),
  tickIntervalMs: z.number().int().min(100).optional(),
  maxFailures: z.number().int().min(1).optional(),
  maxActConcurrency: z.number().int().min(1).optional(),
  snapshotMaxNodes: z.number().int().min(10).optional(),
  snapshotMaxEdges: z.number().int().min(10).optional(),
});
