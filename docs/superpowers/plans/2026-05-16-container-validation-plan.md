# Container-side Validation with Fix Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move agent output validation from model-dependent (agent calls validate-json) to deterministic (Executor runs validate-json), with automatic fix loop on failure.

**Architecture:** After agent execution, Executor runs `validate-json` in the container. If validation fails, Executor feeds the error back to the agent via `opencode run --session` (Act) or fresh `opencode run` (Plan), agent fixes output, Executor validates again. Loop until pass or max retries.

**Tech Stack:** TypeScript, better-sqlite3, dockerode, Zod

---

## File Structure

| File | Change |
|------|--------|
| `src/driver/opencode.ts` | Add `validateAndFix()` method, call in `executeAct`/`executePlan` |
| `src/driver/types.ts` | Add `maxValidationRetries` to driver params (if needed) |
| `src/config.ts` | Add `maxValidationRetries` config |
| `src/prompt/act.ts` | Remove validate-json instruction |
| `src/prompt/plan.ts` | Remove validate-json instruction |
| `docker/opencode/AGENTS.md` | Remove validate-json self-check instruction |

---

### Task 1: Add maxValidationRetries config

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Add default and env override**

In `src/config.ts`, add to `DEFAULTS`:

```typescript
maxValidationRetries: 3,
```

Add to `ENV_OVERRIDES`:

```typescript
maxValidationRetries: 'MAX_VALIDATION_RETRIES',
```

Add to `Config` interface:

```typescript
maxValidationRetries: number;
```

Add to `_config` initialization:

```typescript
maxValidationRetries: DEFAULTS.maxValidationRetries,
```

- [ ] **Step 2: Verify config loads**

Run: `npx tsx src/executor/main.ts --help 2>&1 || true`
Expected: No TypeScript compilation errors about `maxValidationRetries`

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add maxValidationRetries config (default 3)"
```

---

### Task 2: Add validateAndFix method to OpenCodeDriver

**Files:**
- Modify: `src/driver/opencode.ts`

- [ ] **Step 1: Import execInContainer at top of file**

Verify `execInContainer` is already imported (it is — line 2). No change needed.

- [ ] **Step 2: Add validateAndFix method**

Add this private method to the `OpenCodeDriver` class, after the existing `outputFileError` method:

```typescript
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
    const fixArgs = [
      this.cliPath, 'run', '--format', 'json',
      '--dangerously-skip-permissions', '--dir', params.workdir,
      `validate-json 验证失败：\n${errorMsg}\n\n请修复 ${params.outputPath} 中的问题。`,
    ];
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

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to `validateAndFix`

- [ ] **Step 4: Commit**

```bash
git add src/driver/opencode.ts
git commit -m "feat: add validateAndFix method to OpenCodeDriver"
```

---

### Task 3: Integrate validateAndFix into executeAct

**Files:**
- Modify: `src/driver/opencode.ts:executeAct`

- [ ] **Step 1: Add validateAndFix call after agent execution**

In the `executeAct` method, after the agent writes the output file and before the `tryReadOutputFile` call (around line 97), add:

```typescript
    await this.validateAndFix({
      mode: 'act',
      outputPath,
      sessionId,
      workdir: params.workdir,
      timeout: params.timeout,
      maxRetries: config.maxValidationRetries,
    });
```

The full block should look like:

```typescript
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
```

- [ ] **Step 2: Add config import if not present**

Check if `config` is imported in `opencode.ts`. It's not — add at top:

```typescript
import { config } from '../config';
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/driver/opencode.ts
git commit -m "feat: integrate validateAndFix into executeAct"
```

---

### Task 4: Integrate validateAndFix into executePlan

**Files:**
- Modify: `src/driver/opencode.ts:executePlan`

- [ ] **Step 1: Add validateAndFix call after agent execution**

In the `executePlan` method, after the agent writes the output file and before the `tryReadOutputFile` call (around line 63), add:

```typescript
    await this.validateAndFix({
      mode: 'plan',
      outputPath,
      sessionId: null,
      workdir: params.workdir,
      timeout: params.timeout,
      maxRetries: config.maxValidationRetries,
    });
```

The full block should look like:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/driver/opencode.ts
git commit -m "feat: integrate validateAndFix into executePlan"
```

---

### Task 5: Remove validate-json instructions from prompts

**Files:**
- Modify: `src/prompt/act.ts`
- Modify: `src/prompt/plan.ts`
- Modify: `docker/opencode/AGENTS.md`

- [ ] **Step 1: Update act.ts**

In `src/prompt/act.ts`, remove the validate-json instruction from line 26:

Before:
```
无论探索成功或失败，都必须写入 ${outputFile}。使用 write 工具写入，然后运行 \`validate-json act ${outputFile}\`，验证失败则修复后重试，直到通过。
```

After:
```
无论探索成功或失败，都必须写入 ${outputFile}。使用 write 工具写入。
```

- [ ] **Step 2: Update plan.ts**

In `src/prompt/plan.ts`, remove the validate-json instruction from line 9:

Before:
```
将决策保存到 ${file}。然后运行 \`validate-json plan ${file}\`，验证失败则修复后重试，直到通过。
```

After:
```
将决策保存到 ${file}。
```

- [ ] **Step 3: Update docker/opencode/AGENTS.md**

In `docker/opencode/AGENTS.md`, remove the validate-json self-check instruction:

Before:
```
完成后运行 `validate-json act <output.json>` 自检，修复后再次验证，通过后停止。
```

After: (remove the line entirely)

Also remove from the workflow section:

Before:
```
4. 运行 `validate-json act <output.json>` 验证格式
5. 如果验证失败，修复 JSON 后重新验证
6. 验证通过后停止
```

After:
```
4. 写入完成后停止
```

- [ ] **Step 4: Verify no TypeScript errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/prompt/act.ts src/prompt/plan.ts docker/opencode/AGENTS.md
git commit -m "refactor: remove validate-json instructions from prompts"
```

---

### Task 6: Run existing tests

- [ ] **Step 1: Run test suite**

Run: `npx vitest run 2>&1`
Expected: All tests pass

- [ ] **Step 2: Check for any failures related to our changes**

If tests fail, fix them before proceeding.

- [ ] **Step 3: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix: update tests for validateAndFix integration"
```

---

### Task 7: Manual verification

- [ ] **Step 1: Start executor and create a test project**

```bash
npx tsx src/executor/main.ts
```

In another terminal:
```bash
curl -X POST http://localhost:3000/projects/ -H 'Content-Type: application/json' -d '{"description": "test", "agentType": "mock"}'
```

- [ ] **Step 2: Observe Executor logs**

Verify that after agent execution, the Executor runs `validate-json` in the container. Check for log lines indicating validation pass or fix loop.

- [ ] **Step 3: Test with mock agent that produces invalid JSON**

If mock agent can be configured to produce invalid output, verify the fix loop triggers.

- [ ] **Step 4: Commit final state**

```bash
git add -A
git commit -m "feat: container-side validation with fix loop — complete"
```
