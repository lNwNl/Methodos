import { config } from '../config';

export interface EdgePriorityInput {
  priority: number;
  failureCount: number;
  createdAt: string;
}

export function calculateEdgePriority(
  edge: EdgePriorityInput,
  result: 'success' | 'failure',
): number {
  let priority = edge.priority;

  if (result === 'success') {
    priority *= config.priorityBoostSuccess;
  } else {
    priority *= config.priorityPenaltyFailure;
  }

  priority *= Math.pow(config.priorityPenaltyFailure, edge.failureCount);

  const ageHours = (Date.now() - new Date(edge.createdAt).getTime()) / (1000 * 60 * 60);
  priority *= Math.max(0.5, 1.0 - (ageHours * config.priorityDecayRateHourly));

  return Math.max(0.1, Math.min(10.0, priority));
}
