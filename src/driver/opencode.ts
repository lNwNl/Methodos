import type { AgentDriver, AgentOutput, ActResult, PlanOutput } from './types';
import { execInContainer, writeFileInContainer, ensureWorkdir } from '../docker/exec';

function findSessionId(stdout: string): string | null {
  const lines = stdout.trim().split('\n');
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'step_start' && obj.sessionID) {
        return obj.sessionID;
      }
    } catch {}
  }
  return null;
}

function parseJsonOutput(stdout: string): any | null {
  const lines = stdout.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.type === 'step_start' || obj.type === 'step_finish') continue;
      return obj;
    } catch {}
  }
  return null;
}

export class OpenCodeDriver implements AgentDriver {
  constructor(
    private projectId: number,
    private cliPath: string = '/usr/local/bin/opencode',
  ) {}

  async executePlan(params: {
    prompt: string;
    workdir: string;
    timeout: number;
  }): Promise<PlanOutput> {
    const promptPath = `${params.workdir}/plan_prompt.md`;
    await ensureWorkdir(this.projectId, params.workdir);
    await writeFileInContainer(this.projectId, promptPath, params.prompt);

    const promptArg = `-p`;
    const result = await execInContainer(this.projectId, [
      this.cliPath, 'run', promptArg, promptPath,
    ], {
      workdir: params.workdir,
      timeout: params.timeout,
    });

    const output = parseJsonOutput(result.stdout);
    if (!output) {
      throw new Error(`Failed to parse Plan JSON from output: ${result.stdout.slice(0, 200)}`);
    }

    return {
      edges: output.edges || [],
      complete: output.complete || false,
      summary: output.summary,
      evidence_node_ids: output.evidence_node_ids,
    };
  }

  async executeAct(params: {
    prompt: string;
    workdir: string;
    timeout: number;
  }): Promise<ActResult> {
    const promptPath = `${params.workdir}/act_prompt.md`;
    await ensureWorkdir(this.projectId, params.workdir);
    await writeFileInContainer(this.projectId, promptPath, params.prompt);

    const result = await execInContainer(this.projectId, [
      this.cliPath, 'run', '-p', promptPath,
    ], {
      workdir: params.workdir,
      timeout: params.timeout,
    });

    const sessionId = findSessionId(result.stdout) || `fallback-${Date.now()}`;
    const output = parseJsonOutput(result.stdout);

    if (!output || !output.description) {
      throw new Error(`Failed to parse Act JSON: ${result.stdout.slice(0, 200)}`);
    }

    return {
      output: { description: output.description },
      sessionId,
    };
  }

  async conclude(params: {
    sessionId: string;
    prompt: string;
    workdir: string;
    timeout: number;
  }): Promise<AgentOutput> {
    const promptPath = `${params.workdir}/conclude_prompt.md`;
    await ensureWorkdir(this.projectId, params.workdir);
    await writeFileInContainer(this.projectId, promptPath, params.prompt);

    const result = await execInContainer(this.projectId, [
      this.cliPath, 'run', '-p', promptPath, '-s', params.sessionId,
    ], {
      workdir: params.workdir,
      timeout: params.timeout,
    });

    const output = parseJsonOutput(result.stdout);
    if (!output || !output.description) {
      throw new Error(`Failed to parse Conclude JSON: ${result.stdout.slice(0, 200)}`);
    }

    return { description: output.description };
  }
}
