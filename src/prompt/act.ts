import type { Snapshot } from '../types';

export function renderActPrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
  projectId: number,
  edgeId: number,
): string {
  const outputFile = `${workdir}/act_output.json`;

  return `You MUST write to ${outputFile} even if tools fail or return nothing. Use the write tool. Then run \`validate-json act ${outputFile}\`. Fix and retry if validation fails. Stop when it passes.

If exploration tools fail or produce no results, still write the file with a description of what was attempted and why it failed.

## Output Format
\`\`\`json
{
  "title": "简短标题",
  "description": "Factual summary of findings from this session. Include any file paths for raw data."
}
\`\`\`

The "title" field must be a short summary in Chinese (中文), no more than 10 characters. The "description" field must also be in Chinese (中文).

## Exploration Direction
${directionDescription}

Use bash and other tools to execute this exploration. Save raw outputs to files in ${workdir}.

## Current Graph
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

project_id: ${projectId}
edge_id: ${edgeId}`;
}
