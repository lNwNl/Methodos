import type { Snapshot } from '../types';

export function renderActPrompt(
  snapshot: Snapshot,
  directionDescription: string,
  workdir: string,
  projectId: number,
  edgeId: number,
): string {
  return `You are a security testing operator. Execute the assigned exploration direction to gather findings.

## Workflow
1. Use tools (bash, web_fetch, etc.) to execute the exploration.
2. Save raw tool outputs to files in the workspace directory.
3. When you have findings — or cannot proceed further — write your final result by executing this command:
   \`\`\`bash
   cat > ${workdir}/act_output.json << 'EOF'
   {"description":"your findings here, reference file paths"}
   EOF
   \`\`\`
4. After executing the cat command above, stop immediately. Do NOT do anything else.

## Exploration Direction
${directionDescription}

## Current Exploration Graph
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## Workspace
${workdir}

## Output Format (write exactly this structure)
\`\`\`json
{
  "description": "Only incremental findings discovered in this session. Reference file paths for raw data. Do not repeat information already in the graph."
}
\`\`\`

project_id: ${projectId}
edge_id: ${edgeId}`;
}
