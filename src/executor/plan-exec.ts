import Database from 'better-sqlite3';
import { renderSnapshot } from '../snapshot/render';
import { renderPlanPrompt } from '../prompt/plan';
import { config } from '../config';
import { getProject, hasUnresultedEdges, hasNewNodesSince, insertEdges, setProjectLastPlanAt, updateProject } from '../db/operations';
import type { AgentDriver, PlanOutput } from '../driver/types';
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
    const diag = (err as any).diag;
    const cat = diag?.category || 'unknown';
    // llm_transient is expected and auto-retried — use info level
    const msg = cat === 'llm_transient'
      ? `LLM API transient fault — auto-retrying (${err.message})`
      : err.message;
    return handlePlanFailure(db, projectId, ts, msg, cat === 'llm_transient' ? 'warn' : 'error');
  });
}

function writePlan(
  db: Database.Database,
  projectId: number,
  output: PlanOutput,
  ts: string,
): { success: boolean; error?: string } {
  const parsed = planOutputSchema.safeParse(output);
  if (!parsed.success) {
    return handlePlanFailure(db, projectId, ts, `Plan JSON 格式错误: ${parsed.error.message}`, 'error');
  }

  const plan = parsed.data;

  if (plan.complete && plan.edges.length > 0) {
    return handlePlanFailure(db, projectId, ts, 'complete=true but edges non-empty');
  }
  if (plan.complete && (!plan.summary || !plan.evidence_node_ids)) {
    return handlePlanFailure(db, projectId, ts, 'complete=true but missing summary or evidence_node_ids');
  }
  if (!plan.complete && plan.edges.length === 0) {
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
  logLevel: 'error' | 'warn' = 'error',
): { success: boolean; error?: string; logLevel?: string } {
  const project = getProject(db, projectId);
  if (!project) return { success: false, error, logLevel };

  const newCount = project.failure_count + 1;

  if (newCount >= config.maxFailures) {
    db.transaction(() => {
      updateProject(db, projectId, {
        status: 'failed',
        failureCount: newCount,
      }, ts);
    })();
    return { success: false, error: `Plan 失败 ${newCount}/${config.maxFailures} 次: ${error}。项目标记为 failed。`, logLevel };
  }

  updateProject(db, projectId, { failureCount: newCount }, ts);
  return { success: false, error: `Plan ${newCount}/${config.maxFailures}: ${error}`, logLevel };
}
