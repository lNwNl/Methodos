import { describe, it, expect } from 'vitest';
import { calculateEdgePriority } from '../priority';

describe('calculateEdgePriority', () => {
  it('should boost priority on success', () => {
    const edge = { priority: 1.0, failureCount: 0, createdAt: new Date().toISOString() };
    const result = calculateEdgePriority(edge, 'success');
    expect(result).toBeGreaterThan(1.0);
  });

  it('should reduce priority on failure', () => {
    const edge = { priority: 1.0, failureCount: 0, createdAt: new Date().toISOString() };
    const result = calculateEdgePriority(edge, 'failure');
    expect(result).toBeLessThan(1.0);
  });

  it('should apply failure count penalty', () => {
    const edge = { priority: 1.0, failureCount: 3, createdAt: new Date().toISOString() };
    const result = calculateEdgePriority(edge, 'success');
    expect(result).toBeLessThan(1.2);
  });

  it('should apply time decay', () => {
    const oldDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const edge = { priority: 1.0, failureCount: 0, createdAt: oldDate };
    const result = calculateEdgePriority(edge, 'success');
    expect(result).toBeLessThan(1.2);
  });

  it('should clamp to valid range', () => {
    const edge = { priority: 0.05, failureCount: 0, createdAt: new Date().toISOString() };
    const result = calculateEdgePriority(edge, 'failure');
    expect(result).toBeGreaterThanOrEqual(0.1);
  });
});
