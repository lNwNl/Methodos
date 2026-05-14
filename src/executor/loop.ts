import Database from 'better-sqlite3';
import type { AgentDriver } from '../driver/types';
import { getActiveProjects, hasUnresultedEdges, getProject } from '../db/operations';
import { shouldTriggerPlan, executePlan } from './plan-exec';
import { canExecuteAct, executeAct } from './act-exec';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ name: 'executor-loop' });

interface LoopState {
  running: boolean;
  planInFlight: Set<number>;
  actsInFlight: Map<number, number>;
  drivers: Map<number, AgentDriver>;
}

export type DriverFactory = (projectId: number, agentType: string) => AgentDriver;

export function createLoop(db: Database.Database, driverFactory: DriverFactory) {
  const state: LoopState = {
    running: false,
    planInFlight: new Set(),
    actsInFlight: new Map(),
    drivers: new Map(),
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

      if (shouldTriggerPlan(db, pid)) {
        state.planInFlight.add(pid);
        logger.info({ projectId: pid }, 'Triggering Plan');

        executePlan(db, pid, getDriver(pid, project.agent_type), ts).then((result) => {
          state.planInFlight.delete(pid);
          if (result.success) {
            logger.info({ projectId: pid }, 'Plan completed successfully');
          } else {
            logger.warn({ projectId: pid, error: result.error }, 'Plan failed');
          }
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
