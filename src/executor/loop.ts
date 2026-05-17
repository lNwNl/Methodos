import Database from 'better-sqlite3';
import type { AgentDriver } from '../driver/types';
import { getActiveProjects, hasUnresultedEdges, getProject } from '../db/operations';
import { shouldTriggerPlan, executePlan } from './plan-exec';
import { canExecuteAct, executeAct } from './act-exec';
import { ensureContainer } from '../docker/manager';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ name: 'executor-loop' });

interface LoopState {
  running: boolean;
  planInFlight: Set<number>;
  actsInFlight: Map<number, number>;
  drivers: Map<number, AgentDriver>;
  lastPlanExecutedAt: Map<number, string>;
}

export type DriverFactory = (projectId: number, agentType: string) => AgentDriver;

export function createLoop(db: Database.Database, driverFactory: DriverFactory) {
  const state: LoopState = {
    running: false,
    planInFlight: new Set(),
    actsInFlight: new Map(),
    drivers: new Map(),
    lastPlanExecutedAt: new Map(),
  };

  function getDriver(pid: number, agentType: string): AgentDriver {
    if (!state.drivers.has(pid)) {
      state.drivers.set(pid, driverFactory(pid, agentType));
    }
    return state.drivers.get(pid)!;
  }

  async function tick() {
    const ts = new Date().toISOString();
    const projects = getActiveProjects(db);

    for (const project of projects) {
      const pid = project.id;

      if (state.planInFlight.has(pid)) continue;

      if (project.agent_type === 'opencode') {
        try {
          await ensureContainer(pid, project.image_tag);
        } catch (err: any) {
          logger.warn({ projectId: pid, error: err.message }, 'Container not ready, skipping tick');
          continue;
        }
      }

      if (shouldTriggerPlan(db, pid, state.lastPlanExecutedAt.get(pid))) {
        state.planInFlight.add(pid);
        logger.info({ projectId: pid }, 'Triggering Plan');

        executePlan(db, pid, getDriver(pid, project.agent_type), ts).then((result) => {
          state.planInFlight.delete(pid);
          if (result.success) {
            state.lastPlanExecutedAt.set(pid, new Date().toISOString());
            if (result.error) {
              logger.info({ projectId: pid, reason: result.error }, 'Plan 判定无法继续');
            } else {
              logger.info({ projectId: pid }, 'Plan completed successfully');
            }
          } else {
            const level = result.logLevel === 'warn' ? 'warn' : 'error';
            logger[level]({ projectId: pid, error: result.error }, 'Plan failed');
          }
        }).catch((err) => {
          state.planInFlight.delete(pid);
          logger.error({ projectId: pid, err }, 'Plan execution threw');
        });
        continue;
      }

      if (hasUnresultedEdges(db, pid) && canExecuteAct(db, pid)) {
        const inflight = state.actsInFlight.get(pid) || 0;
        state.actsInFlight.set(pid, inflight + 1);

        executeAct(db, pid, getDriver(pid, project.agent_type), ts).then((result) => {
          const current = state.actsInFlight.get(pid) || 1;
          if (current <= 1) {
            state.actsInFlight.delete(pid);
          } else {
            state.actsInFlight.set(pid, current - 1);
          }

          if (result.success) {
            logger.info({ projectId: pid, edgeId: result.edgeId }, 'Act completed');
          } else if (result.error !== 'No unclaimed edge') {
            logger.warn({ projectId: pid, edgeId: result.edgeId, error: result.error }, 'Act failed');
          }
        }).catch((err) => {
          const current = state.actsInFlight.get(pid) || 1;
          if (current <= 1) {
            state.actsInFlight.delete(pid);
          } else {
            state.actsInFlight.set(pid, current - 1);
          }
          logger.error({ projectId: pid, err }, 'Act execution threw');
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
    }, config.tickIntervalMs);

    return () => {
      state.running = false;
      clearInterval(interval);
      logger.info('Executor loop stopped');
    };
  }

  return { start };
}
