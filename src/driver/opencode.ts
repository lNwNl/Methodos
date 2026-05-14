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

function countToolUses(stdout: string): number {
  let count = 0;
  for (const line of stdout.trim().split('\n')) {
    try {
      if (JSON.parse(line).type === 'tool_use') count++;
    } catch {}
  }
  return count;
}

function extractAnyText(stdout: string): string {
  const lines = stdout.trim().split('\n');
  const parts: string[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'text' && obj.part?.text) {
        parts.push(obj.part.text);
      }
    } catch {}
  }
  return parts.join('\n');
}

function parseStructuredOutput(stdout: string): any | null {
  const text = extractAnyText(stdout);

  // Try extracting from text events first
  if (text) {
    // Strategy 1: JSON in fenced block
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = fenceMatch ? fenceMatch[1].trim() : text;

    // Strategy 2: parse the entire extracted text
    try {
      return JSON.parse(jsonText);
    } catch {}

    // Strategy 3: greedy regex for first { ... } block
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {}
    }

    return { description: text.trim() };
  }

  // No text events — try position-scan on the FULL stdout (raw events)
  if (countToolUses(stdout) > 0) {
    // Strategy 4: position-scan — try every { position in stdout
    const fullOut = stdout.trim();
    for (let i = 0; i < fullOut.length; i++) {
      if (fullOut[i] === '{') {
        try {
          const cand = JSON.parse(fullOut.slice(i));
          if (cand && typeof cand === 'object' && !cand.type && !Array.isArray(cand)) {
            return cand;
          }
        } catch {}
      }
    }

    // Extract useful info from tool outputs if no JSON found
    const toolOutputs = extractToolOutputs(stdout);
    if (toolOutputs) {
      return { description: toolOutputs };
    }

    return { description: 'Agent 执行了工具操作但未产出文本结论' };
  }

  return null;
}

function extractToolOutputs(stdout: string): string | null {
  const lines = stdout.trim().split('\n');
  const outputs: string[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'tool_use' && obj.part?.state?.output) {
        const out = obj.part.state.output;
        if (out && out.length > 10) {
          outputs.push(out.slice(0, 200));
        }
      }
    } catch {}
  }
  if (outputs.length === 0) return null;
  return outputs.join(' | ').slice(0, 500);
}

export class OpenCodeDriver implements AgentDriver {
  constructor(
    private projectId: number,
    private cliPath: string = '/usr/bin/opencode',
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
      env: { OPENCODE_EXPERIMENTAL_PLAN_MODE: 'true' },
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
      env: { OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS: 'true' },
    });

    const sessionId = findSessionId(result.stdout) || `fallback-${Date.now()}`;
    const output = parseStructuredOutput(result.stdout);

    if (!output) {
      throw new Error(`Failed to parse Act output from: ${result.stdout.slice(0, 300)}`);
    }

    return {
      output: { description: output.description || extractAnyText(result.stdout) },
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
      env: { OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS: 'true' },
    });

    const output = parseStructuredOutput(result.stdout);
    if (!output) {
      throw new Error(`Failed to parse Conclude output from: ${result.stdout.slice(0, 300)}`);
    }

    return { description: output.description || extractAnyText(result.stdout) };
  }
}
