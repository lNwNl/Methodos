export const config = {
  databasePath: process.env.DATABASE_PATH || './data/methodos.db',
  maxActConcurrency: parseInt(process.env.MAX_ACT_CONCURRENCY || '3', 10),
  actTimeoutMs: parseInt(process.env.ACT_TIMEOUT_MS || '300000', 10),
  planTimeoutMs: parseInt(process.env.PLAN_TIMEOUT_MS || '600000', 10),
  maxFailures: parseInt(process.env.MAX_FAILURES || '3', 10),
  snapshotMaxNodes: parseInt(process.env.SNAPSHOT_MAX_NODES || '100', 10),
  snapshotMaxEdges: parseInt(process.env.SNAPSHOT_MAX_EDGES || '200', 10),
  claimedExpiryMs: 30 * 60 * 1000, // 30 minutes
  dockerSocket: process.env.DOCKER_SOCKET || '/run/user/1000/podman/podman.sock',
  agentImages: {
    opencode: 'methodos-opencode:v1.14.50',
    'claude-code': 'methodos-claude-code:v1.0.0',
    mock: 'test-agent:v1',
  } as Record<string, string>,
} as const;
