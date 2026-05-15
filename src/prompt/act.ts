import type { Snapshot } from '../types';

export function renderActPrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
  projectId: number,
  edgeId: number,
): string {
  const outputFile = `${workdir}/act_output.json`;
  return `Your final step MUST be this bash command. Run it after you have gathered findings:

\`\`\`bash
cat > ${outputFile} << 'EOF'
{"description": "your findings here"}
EOF
validate-json act ${outputFile}
\`\`\`

If validate-json reports "FAIL:", fix the JSON and rerun. When it says "OK", stop immediately.

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
