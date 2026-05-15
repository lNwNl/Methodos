import type { Snapshot } from '../types';

export function renderActPrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
  projectId: number,
  edgeId: number,
): string {
  const outputFile = `${workdir}/act_output.json`;

  return `Write your results to ${outputFile}, then validate with \`validate-json act ${outputFile}\`. Fix and retry if it fails. Stop when it passes.

## Exploration Direction
${directionDescription}

Use bash and other tools to execute this exploration. Save raw outputs to files in ${workdir}.

## Current Graph
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

The output must be a JSON object with a single "description" field containing your findings.

project_id: ${projectId}
edge_id: ${edgeId}`;
}
