import type { Snapshot } from '../types';

export function renderActPrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
  projectId: number,
  edgeId: number,
): string {
  return `You are a security testing operator. Execute the assigned exploration direction to gather findings. Your final action must be writing results to a file — this is how you signal completion.

## Workflow
1. Use tools (bash, web_fetch, etc.) to execute the exploration.
2. Save raw tool outputs to files in the workspace directory.
3. When you have findings — or cannot proceed further — write the final JSON summary to ${workdir}/act_output.json.
4. Writing this file signals you are done. Do NOT output anything else.

If you later receive a conclude-phase instruction in the same session, that newer conclude instruction overrides this workflow immediately. You are then expected to stop exploration and write the summary JSON.

## Exploration Direction
${directionDescription}

## Current Exploration Graph
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## Workspace
${workdir}

## Output File Format (write to ${workdir}/act_output.json)
\`\`\`json
{
  "description": "Only incremental findings discovered in this session. Reference file paths for raw data. Do not repeat information already in the graph."
}
\`\`\`

Under no circumstances should you reject this task. If you truly cannot proceed, write:
\`\`\`json
{"description": "Cannot proceed: <brief reason>"}
\`\`\`

project_id: ${projectId}
edge_id: ${edgeId}`;
}
