import type { AgentDriver, AgentOutput, ActResult, PlanOutput } from './types';
import { execInContainer, writeFileInContainer, ensureWorkdir, readFileFromContainer } from '../docker/exec';
import { config } from '../config';
import { ACT_OUTPUT_FILE, planOutputFile } from '../constants';

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

  private async tryReadOutputFile(path: string, retries = 1, retryDelayMs = 0): Promise<any | null> {
    for (let attempt = 0; attempt < retries; attempt++) {
      const content = await readFileFromContainer(this.projectId, path);
      if (content) {
        const parsed = parseJson(content);
        if (parsed) return parsed;
      }
      if (attempt < retries - 1 && retryDelayMs > 0) {
        await new Promise(r => setTimeout(r, retryDelayMs));
      }
    }
    return null;
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

  private async runAgentTask(opts: {
    promptPath: string;
    prompt: string;
    workdir: string;
    timeout: number;
    sessionId?: string;
  }): Promise<{ stdout: string; stderr: string; exitCode: number; sessionId: string | null }> {
    await ensureWorkdir(this.projectId, opts.workdir);
    await writeFileInContainer(this.projectId, opts.promptPath, opts.prompt);

    const timeoutSec = Math.floor(opts.timeout / 1000);

    const result = await execInContainer(this.projectId, [
      'timeout', String(timeoutSec),
      this.cliPath, 'run', '--format', 'json', '--dangerously-skip-permissions', '--dir', opts.workdir,
      ...(opts.sessionId ? ['--session', opts.sessionId] : []),
      '执行任务', '-f', opts.promptPath,
    ], {
      workdir: opts.workdir,
      timeout: opts.timeout + 5000,
    });

    return {
      ...result,
      sessionId: findSessionId(result.stdout),
    };
  }

  async executePlan(params: {
    prompt: string;
    workdir: string;
    timeout: number;
    round: number;
  }): Promise<PlanOutput> {
    const outputPath = `${params.workdir}/${planOutputFile(params.round)}`;

    const result = await this.runAgentTask({
      promptPath: `${params.workdir}/plan_prompt.md`,
      prompt: params.prompt,
      workdir: params.workdir,
      timeout: params.timeout,
    });

    const timedOut = result.exitCode === 124 || result.exitCode === -1;
    if (timedOut) {
      throw new Error('Plan execution timed out');
    }

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
    const outputPath = `${params.workdir}/${ACT_OUTPUT_FILE}`;

    const result = await this.runAgentTask({
      promptPath: `${params.workdir}/act_prompt.md`,
      prompt: params.prompt,
      workdir: params.workdir,
      timeout: params.timeout,
    });

    const sessionId = result.sessionId || `fallback-${Date.now()}`;
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

    const output = timedOut
      ? await this.tryReadOutputFile(outputPath, 3, 2000)
      : await this.tryReadOutputFile(outputPath);
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
    const outputPath = `${params.workdir}/${ACT_OUTPUT_FILE}`;

    await this.runAgentTask({
      promptPath: `${params.workdir}/conclude_prompt.md`,
      prompt: params.prompt,
      workdir: params.workdir,
      timeout: params.timeout,
      sessionId: params.sessionId,
    });

    const output = await this.tryReadOutputFile(outputPath);
    if (!output) throw this.outputFileError(outputPath);

    return { title: output.title, description: output.description || JSON.stringify(output) };
  }
}
