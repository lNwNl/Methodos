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

function countEventTypes(stdout: string) {
  const counts: Record<string, number> = {};
  for (const line of stdout.trim().split('\n')) {
    try {
      const obj = JSON.parse(line);
      counts[obj.type] = (counts[obj.type] || 0) + 1;
    } catch {}
  }
  return counts;
}

export type DiagCategory = 'exec_error' | 'llm_transient' | 'no_text' | 'bad_format' | 'unknown';

export interface DiagResult {
  category: DiagCategory;
  message: string;
}

export function diagnoseStdout(stdout: string): DiagResult {
  const s = stdout.trim();
  if (!s) {
    return { category: 'exec_error', message: '容器未返回任何输出，可能是启动失败或命令错误' };
  }

  const events = countEventTypes(s);

  // Only step_start — LLM API failed or was killed before producing anything
  if (events.step_start && !events.text && !events.tool_use && !events.step_finish) {
    return { category: 'llm_transient', message: 'LLM API 未返回结果（瞬时故障），自动重试' };
  }

  // Ran tools but no text conclusion
  if (events.tool_use && !events.text && events.step_finish) {
    return { category: 'no_text', message: 'Agent 执行了工具但未产出文本结论' };
  }

  // Ran tools but never finished (no step_finish)
  if (events.tool_use && !events.text && !events.step_finish) {
    return { category: 'no_text', message: 'Agent 执行了工具但未产出文本结论（可能已超时）' };
  }

  // Has text but couldn't parse JSON from it
  if (events.text && !events.tool_use) {
    return { category: 'bad_format', message: 'Agent 返回了文本但不符合 JSON 格式' };
  }

  // Has both text and tools
  if (events.text && events.tool_use) {
    return { category: 'bad_format', message: 'Agent 执行了工具并返回了文本，但无法解析 JSON' };
  }

  // Step_start + step_finish only — ran briefly and exited
  if (events.step_start && events.step_finish && !events.text && !events.tool_use) {
    return { category: 'llm_transient', message: 'LLM 调用后立即退出未产生结果' };
  }

  return { category: 'unknown', message: '无法解析输出' };
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
    // Strategy 4: scan tool_use input fields for JSON (LLM writes via bash heredoc)
    for (const line of stdout.trim().split('\n')) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'tool_use') {
          const input = obj.part?.state?.input;
          const cmd = typeof input === 'string' ? input : (input?.command || '');
          const heredoc = cmd.match(/<<['"]?(\w+)['"]?\s*\n?([\s\S]*?)\1/);
          if (heredoc) {
            try {
              return JSON.parse(heredoc[2].trim());
            } catch {}
          }
        }
      } catch {}
    }

    // Strategy 5: position-scan — try every { position in stdout
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
      if (obj.type === 'tool_use') {
        // Check tool output
        const out = obj.part?.state?.output;
        if (out && out.length > 10) outputs.push(out.slice(0, 200));

        // Also check tool INPUT — LLM may write JSON via bash heredoc
        const input = obj.part?.state?.input;
        if (input) {
          const cmd = typeof input === 'string' ? input : (input.command || '');
          // Extract JSON from heredoc body (cat <<'X' ... X)
          const heredoc = cmd.match(/<<['"]?(\w+)['"]?\s*\n?([\s\S]*?)\1/);
          if (heredoc) {
            const body = heredoc[2].trim();
            // Try to parse as JSON
            try {
              const parsed = JSON.parse(body);
              return `Tool output JSON: ${JSON.stringify(parsed)}`;
            } catch {}
            // Not JSON — treat as text
            outputs.push(body.slice(0, 500));
          }
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
      const diag = diagnoseStdout(result.stdout);
      const hint = result.stderr ? ` | stderr: ${result.stderr.slice(0, 100)}` : '';
      throw Object.assign(new Error(diag.message), { diag, hint });
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
      const diag = diagnoseStdout(result.stdout);
      // Add partial info for no_text category — caller can retry or conclude
      const hint = result.stderr ? ` | stderr: ${result.stderr.slice(0, 100)}` : '';
      throw Object.assign(new Error(diag.message), { diag, hint, sessionId, timedOut: result.exitCode === -1 });
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
      const diag = diagnoseStdout(result.stdout);
      throw Object.assign(new Error(diag.message), { diag });
    }

    return { description: output.description || extractAnyText(result.stdout) };
  }
}
