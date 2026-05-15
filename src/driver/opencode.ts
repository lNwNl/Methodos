import type { AgentDriver, AgentOutput, ActResult, PlanOutput } from './types';
import { execInContainer, writeFileInContainer, ensureWorkdir, readFileFromContainer } from '../docker/exec';

function parseJson(s: string): any | null {
  try { return JSON.parse(s.trim()); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

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

export class OpenCodeDriver implements AgentDriver {
  constructor(
    private projectId: number,
    private cliPath: string = '/usr/bin/opencode',
  ) {}

  private async tryReadOutputFile(path: string): Promise<any | null> {
    // Wait for model to write file — may take a while if LLM is still running tools
    for (let i = 0; i < 30; i++) {
      const content = await readFileFromContainer(this.projectId, path);
      if (content) return parseJson(content);
      await new Promise(r => setTimeout(r, 2000));
    }
    return null;
  }

  private outputFileError(path: string): Error {
    return new Error(`Output file not found: ${path}. Model did not write results.`);
  }

  async executePlan(params: {
    prompt: string;
    workdir: string;
    timeout: number;
    round: number;
  }): Promise<PlanOutput> {
    const promptPath = `${params.workdir}/plan_prompt.md`;
    const outputPath = `${params.workdir}/plan_output_${params.round}.json`;
    await ensureWorkdir(this.projectId, params.workdir);
    await writeFileInContainer(this.projectId, promptPath, params.prompt);

    await execInContainer(this.projectId, [
      this.cliPath, 'run', '--format', 'json', '--pure', '--dir', params.workdir,
      `Follow plan_prompt.md to write and validate plan_output_${params.round}.json, then stop.`,
      '-f', promptPath,
    ], {
      workdir: params.workdir,
      timeout: params.timeout,
      env: { OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS: 'true' },
    });

    const output = await this.tryReadOutputFile(outputPath);
    if (!output) throw this.outputFileError(outputPath);

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
    const outputPath = `${params.workdir}/act_output.json`;
    await ensureWorkdir(this.projectId, params.workdir);
    await writeFileInContainer(this.projectId, promptPath, params.prompt);

    const result = await execInContainer(this.projectId, [
      this.cliPath, 'run', '--format', 'json', '--pure', '--dir', params.workdir,
      'Follow act_prompt.md to write and validate act_output.json, then stop.',
      '-f', promptPath,
    ], {
      workdir: params.workdir,
      timeout: params.timeout,
      env: { OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS: 'true' },
    });

    const sessionId = findSessionId(result.stdout) || `fallback-${Date.now()}`;
    const output = await this.tryReadOutputFile(outputPath);
    if (!output) throw this.outputFileError(outputPath);

    return {
      output: { description: output.description || JSON.stringify(output) },
      sessionId,
      timedOut: result.exitCode === -1,
    };
  }

  async conclude(params: {
    sessionId: string;
    prompt: string;
    workdir: string;
    timeout: number;
  }): Promise<AgentOutput> {
    const promptPath = `${params.workdir}/conclude_prompt.md`;
    const outputPath = `${params.workdir}/conclude_output.json`;
    await ensureWorkdir(this.projectId, params.workdir);
    await writeFileInContainer(this.projectId, promptPath, params.prompt);

    await execInContainer(this.projectId, [
      this.cliPath, 'run', '--format', 'json', '--pure', '--dir', params.workdir,
      '--session', params.sessionId,
      '停止探索，总结已有成果。将结果写入 conclude_output.json，然后停止。',
      '-f', promptPath,
    ], {
      workdir: params.workdir,
      timeout: params.timeout,
      env: { OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS: 'true' },
    });

    const output = await this.tryReadOutputFile(outputPath);
    if (!output) throw this.outputFileError(outputPath);

    return { description: output.description || JSON.stringify(output) };
  }
}
