import Database from 'better-sqlite3';
import { renderSnapshot } from '../snapshot/render';
import { renderActPrompt } from '../prompt/act';
import { renderConcludePrompt } from '../prompt/conclude';
import { config } from '../config';
import { claimEdge, writeActResult, handleActFailure, countActiveActs, updateEdgePriority } from '../db/operations';
import { calculateEdgePriority } from '../db/priority';
import type { AgentDriver } from '../driver/types';
import { z } from 'zod';

const agentOutputSchema = z.object({
  title: z.string().optional(),
  description: z.string(),
});

function recalcEdgePriority(
  db: Database.Database,
  projectId: number,
  edge: { id: number; priority: number; failure_count: number; created_at: string },
  outcome: 'success' | 'failure',
): void {
  const newPriority = calculateEdgePriority(
    { priority: edge.priority, failureCount: edge.failure_count + (outcome === 'failure' ? 1 : 0), createdAt: edge.created_at },
    outcome,
  );
  updateEdgePriority(db, projectId, edge.id, newPriority);
}

function handleActFailureWithPriority(
  db: Database.Database,
  projectId: number,
  edge: { id: number; priority: number; failure_count: number; created_at: string },
  ts: string,
  error: string,
): { success: false; edgeId: number; error: string } {
  handleActFailure(db, projectId, edge.id, config.maxFailures, ts);
  recalcEdgePriority(db, projectId, edge, 'failure');
  return { success: false, edgeId: edge.id, error };
}

export function canExecuteAct(db: Database.Database, projectId: number): boolean {
  const active = countActiveActs(db, projectId);
  return active < config.maxActConcurrency;
}

export async function executeAct(
  db: Database.Database,
  projectId: number,
  driver: AgentDriver,
  ts: string,
): Promise<{ success: boolean; edgeId?: number; error?: string }> {
  const edge = claimEdge(db, projectId, config.maxFailures, config.claimedExpiryMs, ts);
  if (!edge) {
    return { success: false, edgeId: undefined, error: 'No unclaimed edge' };
  }

  const snapshot = renderSnapshot(db, projectId, {
    snapshotMaxNodes: config.snapshotMaxNodes,
    snapshotMaxEdges: config.snapshotMaxEdges,
  }, 'act', edge.id);

  const workdir = `/root/workspace/task_${edge.id}`;
  const prompt = renderActPrompt(snapshot, edge.direction_description, workdir);

  let result;
  try {
    result = await driver.executeAct({
      prompt,
      workdir,
      timeout: config.actTimeoutMs,
    });
  } catch (err: any) {
    return handleActFailureWithPriority(db, projectId, edge, ts, err.message);
  }

  // If timed out, attempt conclude phase first
  let output = result.output;
  if (result.timedOut && result.sessionId) {
    const concludePrompt = renderConcludePrompt(snapshot, edge.direction_description, workdir);
    try {
      output = await driver.conclude({
        sessionId: result.sessionId,
        prompt: concludePrompt,
        workdir,
        timeout: config.concludeTimeoutMs,
      });
    } catch {
      // Conclude failed too, use whatever output we have from the primary phase
    }
  }

  const parsed = agentOutputSchema.safeParse(output);
  if (!parsed.success) {
    return handleActFailureWithPriority(db, projectId, edge, ts, `Invalid output: ${parsed.error.message}`);
  }

  try {
    const resultTs = new Date().toISOString();
    writeActResult(db, projectId, edge.id, parsed.data.title || null, parsed.data.description, 'agent', resultTs);
    recalcEdgePriority(db, projectId, edge, 'success');
    return { success: true, edgeId: edge.id };
  } catch (err: any) {
    return { success: false, edgeId: edge.id, error: err.message };
  }
}
