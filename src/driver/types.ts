export interface AgentOutput {
  title?: string;
  description: string;
}

export interface PlanEdge {
  from_node_ids: number[];
  title?: string;
  direction_description: string;
}

export interface PlanOutput {
  edges: PlanEdge[];
  complete: boolean;
  summary?: string;
  evidence_node_ids?: number[];
}

export interface ActResult {
  output: AgentOutput;
  sessionId: string;
  timedOut?: boolean;
}

export interface AgentDriver {
  executePlan(params: {
    prompt: string;
    workdir: string;
    timeout: number;
    round: number;
  }): Promise<PlanOutput>;

  executeAct(params: {
    prompt: string;
    workdir: string;
    timeout: number;
  }): Promise<ActResult>;

  conclude(params: {
    sessionId: string;
    prompt: string;
    workdir: string;
    timeout: number;
  }): Promise<AgentOutput>;
}
