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

export const settingsSchema = z.object({
  actTimeoutMs: z.number().int().min(1000).optional(),
  concludeTimeoutMs: z.number().int().min(1000).optional(),
  planTimeoutMs: z.number().int().min(1000).optional(),
  claimedExpiryMs: z.number().int().min(1000).optional(),
  tickIntervalMs: z.number().int().min(100).optional(),
  maxFailures: z.number().int().min(1).optional(),
  maxActConcurrency: z.number().int().min(1).optional(),
  snapshotMaxNodes: z.number().int().min(10).optional(),
  snapshotMaxEdges: z.number().int().min(10).optional(),
  planTriggerMode: z.enum(['edge_drain', 'node_created']).optional(),
});
