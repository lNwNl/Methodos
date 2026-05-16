import type { AgentDriver, AgentOutput, ActResult, PlanOutput } from './types';
import { execInContainer, writeFileInContainer, ensureWorkdir, readFileFromContainer } from '../docker/exec';
import { config } from '../config';

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
    const content = await readFileFromContainer(this.projectId, path);
    if (!content) return null;
    return parseJson(content);
  }

  private outputFileError(path: string): Error {
    return new Error(`Output file not found: ${path}. Model did not write results.`);
  }

  private async validateAndFix(params: {
    mode: 'act' | 'plan';
    outputPath: string;
    sessionId: string | null;
    workdir: string;
    timeout: number;
    maxRetries: number;
  }): Promise<void> {
    for (let attempt = 0; attempt <= params.maxRetries; attempt++) {
      const result = await execInContainer(this.projectId, [
        'node', '/usr/local/bin/validate-json', params.mode, params.outputPath
      ], { workdir: params.workdir, timeout: 5000 });

      if (result.exitCode === 0) return;

      if (attempt >= params.maxRetries) {
        throw new Error(`validate-json failed after ${params.maxRetries + 1} attempts: ${result.stderr}`);
      }

      const errorMsg = result.stderr || 'Validation failed';
      const prompt = `validate-json 验证失败：\n${errorMsg}\n\n请修复 ${params.outputPath} 中的问题。`;
      const fixArgs = [
        this.cliPath, 'run', '--format', 'json',
        '--dangerously-skip-permissions', '--dir', params.workdir,
        ...(params.sessionId ? ['--session', params.sessionId] : []),
        prompt,
      ];
      await execInContainer(this.projectId, fixArgs, {
        workdir: params.workdir,
        timeout: params.timeout,
      });
    }
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

    const timeoutSec = Math.floor(params.timeout / 1000);

    await execInContainer(this.projectId, [
      'timeout', String(timeoutSec),
      this.cliPath, 'run', '--format', 'json',  '--dangerously-skip-permissions', '--dir', params.workdir,
      `Follow plan_prompt.md to write and validate plan_output_${params.round}.json, then stop.`,
      '-f', promptPath,
    ], {
      workdir: params.workdir,
      timeout: params.timeout + 5000,
    });

    await this.validateAndFix({
      mode: 'plan',
      outputPath,
      sessionId: null,
      workdir: params.workdir,
      timeout: params.timeout,
      maxRetries: config.maxValidationRetries,
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

    const timeoutSec = Math.floor(params.timeout / 1000);

    const result = await execInContainer(this.projectId, [
      'timeout', String(timeoutSec),
      this.cliPath, 'run', '--format', 'json',  '--dangerously-skip-permissions', '--dir', params.workdir,
      'Follow act_prompt.md to write and validate act_output.json, then stop.',
      '-f', promptPath,
    ], {
      workdir: params.workdir,
      timeout: params.timeout + 5000,
    });

    const sessionId = findSessionId(result.stdout) || `fallback-${Date.now()}`;

    await this.validateAndFix({
      mode: 'act',
      outputPath,
      sessionId,
      workdir: params.workdir,
      timeout: params.timeout,
      maxRetries: config.maxValidationRetries,
    });

    const output = await this.tryReadOutputFile(outputPath);
    if (!output) {
      await writeFileInContainer(this.projectId,
        `${params.workdir}/act_debug.log`,
        `exit=${result.exitCode}\n---stdout---\n${result.stdout}\n---stderr---\n${result.stderr}`,
      );
      throw this.outputFileError(outputPath);
    }

    return {
      output: { title: output.title, description: output.description || JSON.stringify(output) },
      sessionId,
      timedOut: result.exitCode === 124 || result.exitCode === -1,
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

    const timeoutSec = Math.floor(params.timeout / 1000);

    await execInContainer(this.projectId, [
      'timeout', String(timeoutSec),
      this.cliPath, 'run', '--format', 'json',  '--dangerously-skip-permissions', '--dir', params.workdir,
      '--session', params.sessionId,
      '停止探索，总结已有成果。将结果写入 conclude_output.json，然后停止。',
      '-f', promptPath,
    ], {
      workdir: params.workdir,
      timeout: params.timeout + 5000,
    });

    const output = await this.tryReadOutputFile(outputPath);
    if (!output) throw this.outputFileError(outputPath);

    return { title: output.title, description: output.description || JSON.stringify(output) };
  }
}
