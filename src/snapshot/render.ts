import Database from 'better-sqlite3';
import type { Snapshot, SnapshotNode, SnapshotEdge } from '../types';

export function renderSnapshot(
  db: Database.Database,
  projectId: number,
  limits: { snapshotMaxNodes: number; snapshotMaxEdges: number },
): Snapshot {
  const nodes = db.prepare(
    'SELECT id, title, description, created_by FROM nodes WHERE project_id = ? ORDER BY created_at ASC'
  ).all(projectId) as SnapshotNode[];

  const rawEdges = db.prepare(
    'SELECT id, from_node_ids, to_node_ids, title, direction_description, failure_count FROM edges WHERE project_id = ? ORDER BY created_at ASC'
  ).all(projectId) as any[];

  const edges: SnapshotEdge[] = rawEdges.map(e => ({
    id: e.id,
    from_node_ids: JSON.parse(e.from_node_ids),
    to_node_ids: JSON.parse(e.to_node_ids),
    title: e.title || null,
    direction_description: e.direction_description,
    failure_count: e.failure_count,
  }));

  if (nodes.length <= limits.snapshotMaxNodes && edges.length <= limits.snapshotMaxEdges) {
    return { nodes, edges };
  }

  // Truncation logic
  const humanNodes = nodes.filter(n => n.created_by === 'human');
  const unresultedEdges = edges.filter(e => e.to_node_ids.length === 0);

  // Collect nodes referenced by unresulted edges (must be preserved)
  const unresultedNodeIds = new Set<number>();
  for (const e of unresultedEdges) {
    for (const nid of e.from_node_ids) unresultedNodeIds.add(nid);
  }

  // Always keep: human nodes + nodes referenced by unresulted edges
  const alwaysKeepIds = new Set<number>();
  for (const n of humanNodes) alwaysKeepIds.add(n.id);
  for (const nid of unresultedNodeIds) alwaysKeepIds.add(nid);

  const otherNodes = nodes
    .filter(n => n.created_by !== 'human' && !alwaysKeepIds.has(n.id))
    .reverse(); // newest first

  const keepSlots = limits.snapshotMaxNodes - alwaysKeepIds.size;
  const keptOtherNodes = otherNodes.slice(0, Math.max(0, keepSlots));

  const keptNodeIds = new Set<number>([
    ...alwaysKeepIds,
    ...keptOtherNodes.map(n => n.id),
  ]);

  // Filter edges: keep unresulted + edges where all endpoints are kept
  let keptEdges = edges.filter(e => {
    if (e.to_node_ids.length === 0) return true;
    const allEndpoints = [...e.from_node_ids, ...e.to_node_ids];
    return allEndpoints.every(nid => keptNodeIds.has(nid));
  });

  // Include nodes referenced by unresulted edges that were in kept edges
  for (const e of keptEdges) {
    if (e.to_node_ids.length === 0) {
      for (const nid of e.from_node_ids) keptNodeIds.add(nid);
    }
  }

  // Edge truncation
  const finalEdges = keptEdges.slice(
    Math.max(0, keptEdges.length - limits.snapshotMaxEdges)
  );

  // Recompute node set from final edges
  const finalNodeIds = new Set<number>();
  for (const n of humanNodes) finalNodeIds.add(n.id);
  for (const e of finalEdges) {
    for (const nid of e.from_node_ids) finalNodeIds.add(nid);
    for (const nid of e.to_node_ids) finalNodeIds.add(nid);
  }

  const finalNodes = nodes.filter(n => finalNodeIds.has(n.id));

  return { nodes: finalNodes, edges: finalEdges };
}
