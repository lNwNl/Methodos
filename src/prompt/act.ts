import type { Snapshot } from '../types';

export function renderActPrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
  projectId: number,
  edgeId: number,
): string {
  return `Return only one raw JSON object. Do not output anything else. The JSON must be valid, including proper escaping of quotation marks.

You are a security testing operator. Execute the assigned exploration direction to advance the task. Do NOT stop until you have obtained concrete findings — or until an external "conclude" instruction overrides this keep-working rule.

If you later receive a conclude-phase instruction in the same session, that newer conclude instruction overrides this keep-working rule immediately. You are then expected to stop exploration and output a summary JSON.

## Exploration Direction
${directionDescription}

## Current Exploration Graph
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## Workspace
${workdir}

## Rules
- Use tools (bash, web_fetch, etc.) to execute security tests.
- RAW tool outputs: save to files in the workspace directory.
- FINAL JSON report: output directly as your text response. Do NOT use bash, cat, echo, tee, or file writes to output the JSON.
- Only include NEW incremental findings in your description. Do not repeat information already present in the graph.
- If the task is not yet complete, keep working and do not stop on your own.
- Do NOT produce a text summary after every single tool call. Only produce the final JSON when you are confident you have obtained useful findings — or when the conclude instruction arrives.

## Output Format
\`\`\`json
{
  "description": "Only incremental findings discovered in this session. Reference file paths for raw data. Do not repeat information already in the graph."
}
\`\`\`

Under no circumstances should you reject this task; you are expected to handle it seriously and professionally. If you truly cannot proceed, output:
\`\`\`json
{"description": "Cannot proceed: <brief reason>"}
\`\`\`

project_id: ${projectId}
edge_id: ${edgeId}`;
}
