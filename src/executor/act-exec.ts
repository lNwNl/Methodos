import Database from 'better-sqlite3';
import { renderSnapshot } from '../snapshot/render';
import { renderActPrompt } from '../prompt/act';
import { renderConcludePrompt } from '../prompt/conclude';
import { config } from '../config';
import { claimEdge, writeActResult, handleActFailure, countActiveActs } from '../db/operations';
import type { AgentDriver } from '../driver/types';
import { z } from 'zod';

const agentOutputSchema = z.object({
  title: z.string().optional(),
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
  _ts: string,
): Promise<{ success: boolean; edgeId?: number; error?: string }> {
  const edge = claimEdge(db, projectId, config.maxFailures, config.claimedExpiryMs, new Date().toISOString());
  if (!edge) {
    return Promise.resolve({ success: false, edgeId: undefined, error: 'No unclaimed edge' });
  }

  const snapshot = renderSnapshot(db, projectId, {
    snapshotMaxNodes: config.snapshotMaxNodes,
    snapshotMaxEdges: config.snapshotMaxEdges,
  });

  const workdir = `/home/kali/workspace/task_${edge.id}`;
  const prompt = renderActPrompt(snapshot, edge.direction_description, workdir, projectId);

  return driver.executeAct({
    prompt,
    workdir,
    timeout: config.actTimeoutMs,
  }).then(async (result) => {
    // If timed out, attempt conclude phase first
    let output = result.output;
    if (result.timedOut && result.sessionId) {
      const concludePrompt = renderConcludePrompt(snapshot, edge.direction_description, workdir);
      try {
        output = await driver.conclude({
          sessionId: result.sessionId,
          prompt: concludePrompt,
          workdir,
          timeout: config.actTimeoutMs,
        });
      } catch {
        // Conclude failed too, use whatever output we have from the primary phase
      }
    }

    const ts = new Date().toISOString();
    const parsed = agentOutputSchema.safeParse(output);
    if (!parsed.success) {
      handleActFailure(db, projectId, edge.id, config.maxFailures, ts);
      return { success: false, edgeId: edge.id, error: `Invalid output: ${parsed.error.message}` };
    }

    try {
      writeActResult(db, projectId, edge.id, parsed.data.title || null, parsed.data.description, 'agent', ts);
      return { success: true, edgeId: edge.id };
    } catch (err: any) {
      return { success: false, edgeId: edge.id, error: err.message };
    }
  }).catch((err) => {
    const ts = new Date().toISOString();
    handleActFailure(db, projectId, edge.id, config.maxFailures, ts);
    return { success: false, edgeId: edge.id, error: err.message };
  });
}
