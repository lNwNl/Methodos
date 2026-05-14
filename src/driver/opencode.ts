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

function extractTextContent(stdout: string): string {
  const lines = stdout.trim().split('\n');
  let text = '';
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'text' && obj.part?.text) {
        text += obj.part.text;
      }
    } catch {}
  }
  return text;
}

function parseStructuredOutput(stdout: string): any | null {
  const text = extractTextContent(stdout);
  if (!text) return null;

  // Try extracting JSON from code fence first
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fenceMatch ? fenceMatch[1].trim() : text;

  // Try to extract a JSON object
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {}
  }

  // Fallback: return the text as a description
  return { description: text.trim() };
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

    const result = await execInContainer(this.projectId, [
      this.cliPath, 'run', '--format', 'json', '--pure', '--dir', params.workdir,
      '根据 prompt.md 中的探索图 snapshot 和指令，返回 JSON。',
      '-f', promptPath,
    ], {
      workdir: params.workdir,
      timeout: params.timeout,
    });

    const output = parseStructuredOutput(result.stdout);
    if (!output) {
      throw new Error(`Failed to parse Plan output from: ${result.stdout.slice(0, 300)}`);
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
      this.cliPath, 'run', '--format', 'json', '--pure', '--dir', params.workdir,
      '根据 prompt.md 中的指令执行探索。',
      '-f', promptPath,
    ], {
      workdir: params.workdir,
      timeout: params.timeout,
    });

    const sessionId = findSessionId(result.stdout) || `fallback-${Date.now()}`;
    const output = parseStructuredOutput(result.stdout);

    if (!output) {
      throw new Error(`Failed to parse Act output from: ${result.stdout.slice(0, 300)}`);
    }

    return {
      output: { description: output.description || extractTextContent(result.stdout) },
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
      this.cliPath, 'run', '--format', 'json', '--pure', '--dir', params.workdir,
      '--session', params.sessionId,
      '停止探索，总结已有成果。',
      '-f', promptPath,
    ], {
      workdir: params.workdir,
      timeout: params.timeout,
    });

    const output = parseStructuredOutput(result.stdout);
    if (!output) {
      throw new Error(`Failed to parse Conclude output from: ${result.stdout.slice(0, 300)}`);
    }

    return { description: output.description || extractTextContent(result.stdout) };
  }
}
