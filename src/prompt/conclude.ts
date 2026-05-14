import type { Snapshot } from '../types';

export function renderConcludePrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
): string {
  return `Return only one raw JSON object. Do not output anything else.

This is the conclude phase. It overrides any earlier instruction in the same session that told you to keep working, continue exploring, run more commands, wait for results, or perform more actions.

## Stop Immediately
- Do not run any more commands, make any more tool calls, inspect anything else, wait for any unfinished command, or try to obtain any additional information.
- Base your answer only on information that has already been obtained before this conclude prompt.
- This JSON is your final output. After outputting it, stop.

## Summary Task
Produce a brief, factual summary of what you discovered during the exploration session. Describe any findings, partial results, errors encountered, and file paths where raw data was saved.

## Original Direction
${directionDescription}

## Current Graph
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## Output Format
\`\`\`json
{
  "description": "Factual summary of findings from this session. Include any file paths for raw data."
}
\`\`\``;
}
