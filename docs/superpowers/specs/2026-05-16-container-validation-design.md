# Design: Container-side Validation with Fix Loop

## Problem

Currently, agent output validation relies on the model itself:
1. Prompt instructs agent to run `validate-json act|plan <file>` after writing output
2. Executor reads the file and validates with Zod in TypeScript

This is fragile — the model may skip validation, run it incorrectly, or produce invalid output that passes its own validation. Validation should be a deterministic, model-independent step.

## Solution

After agent execution completes, the Executor runs `validate-json` as a fixed program inside the container. If validation fails, the Executor feeds the error message back to the agent via the same session, prompting it to fix the output. This loop repeats until validation passes or retry limit is reached.

## Architecture

### Current Flow

```
Agent executes → writes output.json
  ↓ (prompt instructs agent to run validate-json)
Agent runs validate-json (model-dependent)
  ↓
Executor reads file → validates with Zod (TypeScript)
  ↓
Pass → continue | Fail → failure_count +1
```

### New Flow

```
Agent executes → writes output.json
  ↓
Executor runs validate-json in container (deterministic)
  ↓
Pass → read file, continue
Fail → enter fix loop:
  ├─ Capture error message from validate-json stderr
  ├─ Run opencode run --session <sessionId> with error feedback
  ├─ Agent fixes output.json
  ├─ Executor runs validate-json again
  ├─ Loop until pass or MAX_VALIDATION_RETRIES reached
  └─ Exhausted → failure_count +1
```

## Changes

### 1. Prompt Templates (remove validation instructions)

**`src/prompt/act.ts`** — remove:
```
然后运行 `validate-json act ${outputFile}`，验证失败则修复后重试，直到通过。
```

**`src/prompt/plan.ts`** — remove:
```
然后运行 `validate-json plan ${file}`，验证失败则修复后重试，直到通过。
```

**`docker/opencode/AGENTS.md`** — remove:
```
完成后运行 `validate-json act <output.json>` 自检，修复后再次验证，通过后停止。
```

### 2. OpenCodeDriver — add validate-then-fix loop

In `src/driver/opencode.ts`, after the agent finishes writing output, add a validation loop before returning:

```typescript
private async validateAndFix(params: {
  mode: 'act' | 'plan';
  outputPath: string;
  sessionId: string;
  workdir: string;
  timeout: number;
  maxRetries: number;
}): Promise<void> {
  for (let attempt = 0; attempt <= params.maxRetries; attempt++) {
    const result = await execInContainer(this.projectId, [
      'node', '/usr/local/bin/validate-json', params.mode, params.outputPath
    ], { workdir: params.workdir, timeout: 5000 });

    if (result.exitCode === 0) return; // validation passed

    if (attempt >= params.maxRetries) {
      throw new Error(`validate-json failed after ${params.maxRetries + 1} attempts: ${result.stderr}`);
    }

    // Feed error back to agent
    const errorMsg = result.stderr || 'Validation failed';
    const fixArgs = [
      this.cliPath, 'run', '--format', 'json',
      '--dangerously-skip-permissions', '--dir', params.workdir,
      `validate-json 验证失败：\n${errorMsg}\n\n请修复 ${params.outputPath} 中的问题。`,
    ];
    // Act reuses session for context continuity; Plan starts fresh (no session extraction)
    if (params.sessionId) {
      fixArgs.splice(3, 0, '--session', params.sessionId);
    }
    await execInContainer(this.projectId, fixArgs, {
      workdir: params.workdir,
      timeout: params.timeout,
    });
  }
}
```

Apply in `executeAct` and `executePlan` after agent execution:

- **Act**: `sessionId` is extracted from agent stdout → fix retries use `--session` to maintain conversation context. Agent sees previous exploration results and can fix JSON while preserving understanding.
- **Plan**: No session extraction → fix retries start fresh without `--session`. Agent receives only the error message and original prompt context (via working directory). This is acceptable because Plan output is self-contained JSON — the error message from validate-json provides sufficient context for fixing.

```typescript
// After agent writes output, before returning
await this.validateAndFix({
  mode: 'act', // or 'plan'
  outputPath,
  sessionId,
  workdir: params.workdir,
  timeout: params.timeout,
  maxRetries: config.maxValidationRetries,
});

const output = await this.tryReadOutputFile(outputPath);
if (!output) throw this.outputFileError(outputPath);
```

### 3. Configuration

Add to `src/config.ts`:

```typescript
maxValidationRetries: 3,  // default, env: MAX_VALIDATION_RETRIES
```

### 4. No changes to validate-json.js

The existing script already outputs clear Chinese error messages via stderr. No modifications needed.

## Timeout Budget

- Each `opencode run` call (initial execution + each fix retry) uses the same `timeout` parameter
- Fix retries should be fast (agent only modifies JSON fields), but no separate timeout is imposed
- The `claimed_at` expiry (30 minutes) acts as the outer safety net for cumulative delays
- No independent timeout for the fix loop — relies on the existing timeout mechanism

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Output file doesn't exist | `tryReadOutputFile` returns null → `outputFileError` thrown → normal failure flow |
| Agent ignores fix request | After maxRetries, error thrown → `handleActFailure` / `handlePlanFailure` |
| Session ID not found (Act) | Fallback to `fallback-${Date.now()}` — fix loop runs without `--session`, agent starts fresh |
| Session ID null (Plan) | No session extracted — fix loop runs without `--session`, agent starts fresh with error context |
| validate-json script missing | execInContainer throws → caught by existing `.catch()` → failure flow |

## Files Changed

| File | Change |
|------|--------|
| `src/prompt/act.ts` | Remove validate-json instruction |
| `src/prompt/plan.ts` | Remove validate-json instruction |
| `src/driver/opencode.ts` | Add `validateAndFix` method, call in `executeAct`/`executePlan` |
| `src/config.ts` | Add `maxValidationRetries` config |
| `docker/opencode/AGENTS.md` | Remove validate-json self-check instruction |

## Testing

1. Unit test: mock `execInContainer` to simulate validate-json pass/fail scenarios
2. Integration test: run agent in container with intentionally malformed output, verify fix loop works
3. Manual test: create project, observe Executor-side validation in logs
