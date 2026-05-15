import type { Snapshot } from '../types';

export function renderPlanPrompt(snapshot: Snapshot, projectId: number, round: number): string {
  const file = `/home/kali/workspace/plan_output_${round}.json`;
  return `Execute this bash command to write your plan, then self-validate:

\`\`\`bash
cat > ${file} << 'EOF'
{... your plan JSON ...}
EOF

validate-json plan ${file}
\`\`\`

If you see "FAIL: ...", follow the specific instruction in the error message, fix the JSON, and rerun the cat command. Repeat until you see "OK". Then stop.

You are a security testing planner. Analyze the current exploration graph and decide the next course of action. Do NOT execute exploration commands (nmap, curl, etc.) — only use tools to understand the state, then write your decision.

## Current Exploration Graph
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## Decision Rules
Choose exactly one of the three outcomes below:

### 1. Goal Achieved → complete: true
Only when explicit proof of the original objective exists in the graph (flag captured, password obtained, shell established, target compromised). For penetration testing, mere information gathering is NEVER sufficient for completion.

\`\`\`json
{
  "edges": [],
  "complete": true,
  "summary": "Brief description of what was achieved and why the task is complete.",
  "evidence_node_ids": [1, 2, 3]
}
\`\`\`

### 2. Continue Exploring → complete: false + edges
When the goal is not yet achieved and new exploration directions are warranted.

\`\`\`json
{
  "edges": [
    {
      "from_node_ids": [1],
      "direction_description": "Specific, actionable next step. E.g.: 'Use nmap to scan ports 1-1000 on target host'"
    }
  ],
  "complete": false
}
\`\`\`

### 3. Stuck → complete: false + empty edges
When you have exhausted all reasonable exploration directions but the goal remains unachieved. This signals to the human operator that intervention is needed.

\`\`\`json
{
  "edges": [],
  "complete": false
}
\`\`\`

## Rules
- Different edges should cover DIFFERENT exploration dimensions. Avoid duplication or heavy overlap.
- Each edge's from_node_ids must reference existing Node IDs from the graph.
- Each direction_description must be specific and actionable — a single concrete step, not a vague category.
- For pentesting: only set complete: true when the actual objective is met (flag/password/shell). Information collection is NEVER completion.
- Propose at most 3 edges per round — focus on the most promising directions.

project_id: ${projectId}`;
}
