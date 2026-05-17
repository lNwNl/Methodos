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
      const isMissing = errorMsg.includes('cannot read file') || errorMsg.includes('file is empty');
      const fmt = params.mode === 'plan'
        ? `继续探索：{"edges":[{"from_node_ids":[1],"direction_description":"具体步骤"}],"complete":false}\n完成判定：{"edges":[],"complete":true,"summary":"完成原因","evidence_node_ids":[1]}`
        : '{"title":"简短标题","description":"发现的事实总结"}';
      const prompt = isMissing
        ? `任务尚未完成：你还没有将探索结果写入 ${params.outputPath}。\n请根据已有的探索结果，使用 write 工具写入该文件。\n格式：${fmt}`
        : `任务输出格式不正确：${params.outputPath} 验证失败 — ${errorMsg}\n请使用 write 工具修正该文件。\n格式：${fmt}`;
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

    const result = await execInContainer(this.projectId, [
      'timeout', String(timeoutSec),
      this.cliPath, 'run', '--format', 'json',  '--dangerously-skip-permissions', '--dir', params.workdir,
      '执行任务', '-f', promptPath,
    ], {
      workdir: params.workdir,
      timeout: params.timeout + 5000,
    });

    const sessionId = findSessionId(result.stdout);

    await this.validateAndFix({
      mode: 'plan',
      outputPath,
      sessionId: sessionId ?? null,
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
      '执行任务', '-f', promptPath,
    ], {
      workdir: params.workdir,
      timeout: params.timeout + 5000,
    });

    const sessionId = findSessionId(result.stdout) || `fallback-${Date.now()}`;
    const timedOut = result.exitCode === 124 || result.exitCode === -1;

    if (!timedOut) {
      await this.validateAndFix({
        mode: 'act',
        outputPath,
        sessionId,
        workdir: params.workdir,
        timeout: params.timeout,
        maxRetries: config.maxValidationRetries,
      });
    }

    const output = await this.tryReadOutputFile(outputPath);
    if (!output) {
      if (timedOut) {
        return {
          output: { description: '任务超时，未产出结果' },
          sessionId,
          timedOut: true,
        };
      }
      await writeFileInContainer(this.projectId,
        `${params.workdir}/act_debug.log`,
        `exit=${result.exitCode}\n---stdout---\n${result.stdout}\n---stderr---\n${result.stderr}`,
      );
      throw this.outputFileError(outputPath);
    }

    return {
      output: { title: output.title, description: output.description || JSON.stringify(output) },
      sessionId,
      timedOut,
    };
  }

  async conclude(params: {
    sessionId: string;
    prompt: string;
    workdir: string;
    timeout: number;
  }): Promise<AgentOutput> {
    const promptPath = `${params.workdir}/conclude_prompt.md`;
    const outputPath = `${params.workdir}/act_output.json`;
    await ensureWorkdir(this.projectId, params.workdir);
    await writeFileInContainer(this.projectId, promptPath, params.prompt);

    const timeoutSec = Math.floor(params.timeout / 1000);

    await execInContainer(this.projectId, [
      'timeout', String(timeoutSec),
      this.cliPath, 'run', '--format', 'json',  '--dangerously-skip-permissions', '--dir', params.workdir,
      '--session', params.sessionId,
      '执行任务', '-f', promptPath,
    ], {
      workdir: params.workdir,
      timeout: params.timeout + 5000,
    });

    const output = await this.tryReadOutputFile(outputPath);
    if (!output) throw this.outputFileError(outputPath);

    return { title: output.title, description: output.description || JSON.stringify(output) };
  }
}
