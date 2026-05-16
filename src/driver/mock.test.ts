import { describe, it, expect } from 'vitest';
import { MockAgentDriver } from './mock';

describe('MockAgentDriver', () => {
  it('returns edges on first plan', async () => {
    const driver = new MockAgentDriver(1);
    const result = await driver.executePlan({
      prompt: 'test',
      workdir: '/tmp',
      timeout: 1000,
      round: 1,
    });

    expect(result.complete).toBe(false);
    expect(result.edges).toHaveLength(2);
    expect(result.edges[0].direction_description).toBe('扫描目标开放端口和服务');
  });

  it('returns complete on second plan', async () => {
    const driver = new MockAgentDriver(1);
    await driver.executePlan({ prompt: '', workdir: '/tmp', timeout: 1000, round: 1 });
    const result = await driver.executePlan({ prompt: '', workdir: '/tmp', timeout: 1000, round: 1 });

    expect(result.complete).toBe(true);
    expect(result.edges).toHaveLength(0);
    expect(result.summary).toBeDefined();
  });

  it('uses custom scenario', async () => {
    const driver = new MockAgentDriver(1);
    driver.setScenario(1, [
      { edges: [{ from_node_ids: [1], direction_description: 'custom step' }], complete: false },
      { edges: [], complete: true, summary: 'done', evidence_node_ids: [2] },
    ]);

    const r1 = await driver.executePlan({ prompt: '', workdir: '/tmp', timeout: 1000, round: 1 });
    expect(r1.edges[0].direction_description).toBe('custom step');

    const r2 = await driver.executePlan({ prompt: '', workdir: '/tmp', timeout: 1000, round: 1 });
    expect(r2.complete).toBe(true);
    expect(r2.summary).toBe('done');
  });
});
