import type { AgentDriver, AgentOutput, ActResult, PlanOutput } from './types';

export class MockAgentDriver implements AgentDriver {
  private planCounts = new Map<number, number>();
  private scenarios: Map<number, PlanOutput[]>;

  constructor(scenarios?: Map<number, PlanOutput[]>) {
    this.scenarios = scenarios || new Map();
  }

  setScenario(projectId: number, plans: PlanOutput[]) {
    this.scenarios.set(projectId, plans);
    this.planCounts.delete(projectId);
  }

  async executePlan(params: { prompt: string; workdir: string; timeout: number; round: number }): Promise<PlanOutput> {
    const projectId = this.extractProjectId(params.prompt);
    const count = (this.planCounts.get(projectId) || 0) + 1;
    this.planCounts.set(projectId, count);

    const scenario = this.scenarios.get(projectId);
    if (scenario && scenario.length >= count) {
      return scenario[count - 1];
    }

    if (count === 1) {
      return {
        edges: [
          { from_node_ids: [1], title: '端口扫描', direction_description: '扫描目标开放端口和服务' },
          { from_node_ids: [1], title: '子域名枚举', direction_description: '枚举子域名和虚拟主机' },
        ],
        complete: false,
      };
    }

    return {
      edges: [],
      complete: true,
      summary: '已完成信息收集，判定任务完成',
      evidence_node_ids: [2, 3],
    };
  }

  async executeAct(params: { prompt: string; workdir: string; timeout: number }): Promise<ActResult> {
    const sessionId = `mock-session-${Date.now()}`;

    return {
      output: {
        title: '端口开放',
        description: '探索结果：发现开放端口和服务信息',
      },
      sessionId,
    };
  }

  async conclude(params: { sessionId: string; prompt: string; workdir: string; timeout: number }): Promise<AgentOutput> {
    return {
      title: '超时总结',
      description: '超时前部分结果：收集到部分信息',
    };
  }

  private extractProjectId(prompt: string): number {
    const match = prompt.match(/项目\s*ID:\s*(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }
}
