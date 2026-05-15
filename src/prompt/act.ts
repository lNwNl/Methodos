import type { Snapshot } from '../types';

export function renderActPrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
  projectId: number,
  edgeId: number,
): string {
  const outputFile = `${workdir}/act_output.json`;

  return `Use the write tool to save your results to ${outputFile} as a JSON object with a "description" field. Then run \`validate-json act ${outputFile}\`. Fix and retry if it fails. Stop when it passes.

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
