export interface SnapshotNode {
  id: number;
  description: string;
  created_by: string;
}

export interface SnapshotEdge {
  id: number;
  from_node_ids: number[];
  to_node_ids: number[];
  direction_description: string;
  failure_count: number;
}

export interface Snapshot {
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
}

export type ProjectStatus = 'active' | 'completed' | 'failed' | 'stopped';
