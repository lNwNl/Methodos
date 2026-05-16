import Database from 'better-sqlite3';
import { getSettings } from './db/operations';

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
  planMinIntervalMs: 5000,
  priorityBoostSuccess: 120,
  priorityPenaltyFailure: 90,
  priorityDecayRateHourly: 1,
};

const ENV_OVERRIDES: Record<string, string> = {
  actTimeoutMs: 'ACT_TIMEOUT_MS',
  planTimeoutMs: 'PLAN_TIMEOUT_MS',
  maxFailures: 'MAX_FAILURES',
  maxActConcurrency: 'MAX_ACT_CONCURRENCY',
  snapshotMaxNodes: 'SNAPSHOT_MAX_NODES',
  snapshotMaxEdges: 'SNAPSHOT_MAX_EDGES',
  maxValidationRetries: 'MAX_VALIDATION_RETRIES',
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
  planMinIntervalMs: number;
  priorityBoostSuccess: number;
  priorityPenaltyFailure: number;
  priorityDecayRateHourly: number;
}

const _config: Config = {
  databasePath: process.env.DATABASE_PATH || './data/methodos.db',
  dockerSocket: process.env.DOCKER_SOCKET || '/run/user/1000/podman/podman.sock',
  agentImages: {
    opencode: 'methodos-opencode:v1.14.50',
    'claude-code': 'methodos-claude-code:v1.0.0',
    mock: 'test-agent:v1',
  },
  actTimeoutMs: DEFAULTS.actTimeoutMs,
  planTimeoutMs: DEFAULTS.planTimeoutMs,
  claimedExpiryMs: DEFAULTS.claimedExpiryMs,
  tickIntervalMs: DEFAULTS.tickIntervalMs,
  maxFailures: DEFAULTS.maxFailures,
  maxActConcurrency: DEFAULTS.maxActConcurrency,
  snapshotMaxNodes: DEFAULTS.snapshotMaxNodes,
  snapshotMaxEdges: DEFAULTS.snapshotMaxEdges,
  maxValidationRetries: DEFAULTS.maxValidationRetries,
  planMinIntervalMs: DEFAULTS.planMinIntervalMs,
  priorityBoostSuccess: DEFAULTS.priorityBoostSuccess,
  priorityPenaltyFailure: DEFAULTS.priorityPenaltyFailure,
  priorityDecayRateHourly: DEFAULTS.priorityDecayRateHourly,
};

export const config: Config = _config;

export function loadConfigFromDb(db: Database.Database): void {
  const settings = getSettings(db);

  for (const [key, defaultVal] of Object.entries(DEFAULTS)) {
    const envKey = ENV_OVERRIDES[key];
    const envVal = envKey ? process.env[envKey] : undefined;

    const isPercentField = key === 'priorityBoostSuccess' || key === 'priorityPenaltyFailure' || key === 'priorityDecayRateHourly';

    if (envVal !== undefined) {
      (_config as any)[key] = parseInt(envVal, 10) || defaultVal;
    } else if (settings[key] !== undefined) {
      if (isPercentField) {
        (_config as any)[key] = parseInt(settings[key], 10) / 100 || defaultVal / 100;
      } else {
        (_config as any)[key] = parseInt(settings[key], 10) || defaultVal;
      }
    } else {
      (_config as any)[key] = isPercentField ? defaultVal / 100 : defaultVal;
    }
  }
}

export function reloadConfig(db: Database.Database): void {
  loadConfigFromDb(db);
}
