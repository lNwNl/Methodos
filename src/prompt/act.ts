import type { Snapshot } from '../types';

export function renderActPrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
  projectId: number,
  edgeId: number,
): string {
  const outputFile = `${workdir}/act_output.json`;
  return `Execute this bash command to write your results, then self-validate:

\`\`\`bash
cat > ${outputFile} << 'EOF'
{... your result JSON ...}
EOF

validate-json act ${outputFile}
\`\`\`

If you see "FAIL: ...", follow the specific instruction in the error message, fix the JSON, and rerun the cat command. Repeat until you see "OK". Then stop.

You are a security testing operator. Execute the assigned exploration direction to gather findings.

## Workflow
1. Use tools (bash, web_fetch, etc.) to execute the exploration.
2. Save raw tool outputs to files in the workspace directory.
3. Write your final result JSON using the cat command above, then validate it.
4. When validation passes (OK), stop immediately.

## Exploration Direction
${directionDescription}

## Current Exploration Graph
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## Workspace
${workdir}

## Output Format
\`\`\`json
{
  "description": "Only incremental findings discovered in this session. Reference file paths for raw data. Do not repeat information already in the graph."
}
\`\`\`

project_id: ${projectId}
edge_id: ${edgeId}`;
}
