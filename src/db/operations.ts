import Database from 'better-sqlite3';

export function createProject(
  db: Database.Database,
  title: string,
  agentType: string,
  imageTag: string,
  ts: string,
): number {
  const result = db.prepare(`
    INSERT INTO projects (title, status, agent_type, image_tag, created_at, updated_at)
    VALUES (?, 'active', ?, ?, ?, ?)
  `).run(title, agentType, imageTag, ts, ts);

  const projectId = result.lastInsertRowid as number;

  db.prepare(`
    INSERT INTO nodes (project_id, id, title, description, created_by, edge_id, created_at)
    VALUES (?, 1, NULL, ?, 'human', NULL, ?)
  `).run(projectId, title, ts);

  return projectId;
}

export function getProject(db: Database.Database, projectId: number) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
}

export function getActiveProjects(db: Database.Database) {
  return db.prepare("SELECT * FROM projects WHERE status = 'active'").all() as any[];
}

export function nextNodeId(db: Database.Database, projectId: number): number {
  const row = db.prepare(
    'SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM nodes WHERE project_id = ?'
  ).get(projectId) as { next_id: number };
  return row.next_id;
}

export function nextEdgeId(db: Database.Database, projectId: number): number {
  const row = db.prepare(
    'SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM edges WHERE project_id = ?'
  ).get(projectId) as { next_id: number };
  return row.next_id;
}

export function insertNode(
  db: Database.Database,
  projectId: number,
  title: string | null,
  description: string,
  createdBy: string,
  edgeId: number | null,
  ts: string,
): number {
  const id = nextNodeId(db, projectId);
  db.prepare(`
    INSERT INTO nodes (project_id, id, title, description, created_by, edge_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, id, title, description, createdBy, edgeId, ts);
  return id;
}

export function insertEdges(
  db: Database.Database,
  projectId: number,
  edges: { from_node_ids: number[]; title?: string; direction_description: string }[],
  ts: string,
): number[] {
  const ids: number[] = [];
  const txn = db.transaction(() => {
    for (const edge of edges) {
      const id = nextEdgeId(db, projectId);
      db.prepare(`
        INSERT INTO edges (project_id, id, from_node_ids, to_node_ids, title, direction_description, priority, created_at)
        VALUES (?, ?, ?, '[]', ?, ?, 1.0, ?)
      `).run(projectId, id, JSON.stringify(edge.from_node_ids), edge.title || null, edge.direction_description, ts);
      ids.push(id);
    }
  });
  txn();
  return ids;
}

export function claimEdge(
  db: Database.Database,
  projectId: number,
  maxFailures: number,
  expiryMs: number,
  ts: string,
) {
  const expiredAt = new Date(Date.now() - expiryMs).toISOString();
  const row = db.prepare(`
    UPDATE edges SET claimed_at = ?
    WHERE project_id = ? AND id = (
      SELECT id FROM edges
      WHERE project_id = ? AND to_node_ids = '[]' AND failure_count < ?
        AND (claimed_at IS NULL OR claimed_at < ?)
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    )
    RETURNING *
  `).get(ts, projectId, projectId, maxFailures, expiredAt) as any;

  if (!row) return null;

  return {
    id: row.id,
    project_id: row.project_id,
    from_node_ids: JSON.parse(row.from_node_ids),
    to_node_ids: JSON.parse(row.to_node_ids),
    claimed_at: row.claimed_at,
    title: row.title,
    direction_description: row.direction_description,
    failure_count: row.failure_count,
    priority: row.priority,
    created_at: row.created_at,
  };
}

export function updateEdgePriority(
  db: Database.Database,
  projectId: number,
  edgeId: number,
  priority: number,
): void {
  db.prepare(`
    UPDATE edges SET priority = ? WHERE project_id = ? AND id = ?
  `).run(priority, projectId, edgeId);
}

export function getEdge(
  db: Database.Database,
  projectId: number,
  edgeId: number,
) {
  const row = db.prepare(
    'SELECT * FROM edges WHERE project_id = ? AND id = ?'
  ).get(projectId, edgeId) as any;

  if (!row) return null;

  return {
    id: row.id,
    project_id: row.project_id,
    from_node_ids: JSON.parse(row.from_node_ids),
    to_node_ids: JSON.parse(row.to_node_ids),
    claimed_at: row.claimed_at,
    title: row.title,
    direction_description: row.direction_description,
    failure_count: row.failure_count,
    priority: row.priority,
    created_at: row.created_at,
  };
}

export function writeActResult(
  db: Database.Database,
  projectId: number,
  edgeId: number,
  title: string | null,
  description: string,
  createdBy: string,
  ts: string,
): number {
  const nodeId = nextNodeId(db, projectId);

  const txn = db.transaction(() => {
    db.prepare(`
      INSERT INTO nodes (project_id, id, title, description, created_by, edge_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(projectId, nodeId, title, description, createdBy, edgeId, ts);

    db.prepare(`
      UPDATE edges SET to_node_ids = json_array(?)
      WHERE project_id = ? AND id = ? AND to_node_ids = '[]'
    `).run(nodeId, projectId, edgeId);
  });

  txn();
  return nodeId;
}

export function handleActFailure(
  db: Database.Database,
  projectId: number,
  edgeId: number,
  maxFailures: number,
  ts: string,
): { nodeCreated: boolean; nodeId?: number } {
  const txn = db.transaction(() => {
    db.prepare(`
      UPDATE edges SET failure_count = failure_count + 1, claimed_at = NULL
      WHERE project_id = ? AND id = ?
    `).run(projectId, edgeId);

    const edge = db.prepare(
      'SELECT failure_count FROM edges WHERE project_id = ? AND id = ?'
    ).get(projectId, edgeId) as { failure_count: number };

    if (edge.failure_count >= maxFailures) {
      const title = `超时 ${edge.failure_count} 次`;
      const description = `运行超时 ${edge.failure_count} 次`;
      const nodeId = nextNodeId(db, projectId);
      db.prepare(`
        INSERT INTO nodes (project_id, id, title, description, created_by, edge_id, created_at)
        VALUES (?, ?, ?, ?, 'system', ?, ?)
      `).run(projectId, nodeId, title, description, edgeId, ts);
      db.prepare(`
        UPDATE edges SET to_node_ids = json_array(?)
        WHERE project_id = ? AND id = ? AND to_node_ids = '[]'
      `).run(nodeId, projectId, edgeId);
      return { nodeCreated: true, nodeId };
    }

    return { nodeCreated: false };
  });

  return txn();
}

export function hasUnresultedEdges(db: Database.Database, projectId: number): boolean {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM edges WHERE project_id = ? AND to_node_ids = '[]'"
  ).get(projectId) as { count: number };
  return row.count > 0;
}

export function hasNewNodesSince(db: Database.Database, projectId: number, since: string): boolean {
  const row = db.prepare(
    'SELECT COUNT(*) as count FROM nodes WHERE project_id = ? AND created_at > ?'
  ).get(projectId, since) as { count: number };
  return row.count > 0;
}

export function countActiveActs(db: Database.Database, projectId: number): number {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM edges WHERE project_id = ? AND to_node_ids = '[]' AND claimed_at IS NOT NULL"
  ).get(projectId) as { count: number };
  return row.count;
}

export function getSnapshotData(db: Database.Database, projectId: number) {
  const nodes = db.prepare(
    'SELECT id, title, description, created_by, edge_id, created_at FROM nodes WHERE project_id = ? ORDER BY created_at ASC'
  ).all(projectId) as any[];

  const edges = db.prepare(
    'SELECT id, from_node_ids, to_node_ids, claimed_at, title, direction_description, failure_count, created_at FROM edges WHERE project_id = ? ORDER BY created_at ASC'
  ).all(projectId) as any[];

  return {
    nodes,
    edges: edges.map((e: any) => ({
      ...e,
      from_node_ids: JSON.parse(e.from_node_ids),
      to_node_ids: JSON.parse(e.to_node_ids),
    })),
  };
}

export function updateProject(
  db: Database.Database,
  projectId: number,
  updates: {
    status?: string;
    lastPlanAt?: string | null;
    failureCount?: number;
    summary?: string | null;
    evidenceNodeIds?: number[] | null;
  },
  ts: string,
) {
  const sets: string[] = ['updated_at = ?'];
  const values: any[] = [ts];

  if (updates.status !== undefined) {
    sets.push('status = ?');
    values.push(updates.status);
  }
  if (updates.lastPlanAt !== undefined) {
    sets.push('last_plan_at = ?');
    values.push(updates.lastPlanAt);
  }
  if (updates.failureCount !== undefined) {
    sets.push('failure_count = ?');
    values.push(updates.failureCount);
  }
  if (updates.summary !== undefined) {
    sets.push('summary = ?');
    values.push(updates.summary);
  }
  if (updates.evidenceNodeIds !== undefined) {
    sets.push('evidence_node_ids = ?');
    values.push(JSON.stringify(updates.evidenceNodeIds));
  }

  values.push(projectId);
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function incrementPlanRound(db: Database.Database, projectId: number): number {
  db.prepare(`
    UPDATE projects SET plan_round = plan_round + 1 WHERE id = ?
  `).run(projectId);
  const row = db.prepare('SELECT plan_round FROM projects WHERE id = ?').get(projectId) as any;
  return row.plan_round;
}

export function setProjectLastPlanAt(
  db: Database.Database,
  projectId: number,
  ts: string,
) {
  db.prepare(`
    UPDATE projects SET last_plan_at = ?, failure_count = 0, updated_at = ?
    WHERE id = ?
  `).run(ts, ts, projectId);
}

export function setPlanTiming(
  db: Database.Database,
  projectId: number,
  startedAt: string,
  completedAt: string,
) {
  db.prepare(`
    UPDATE projects SET plan_started_at = ?, plan_completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(startedAt, completedAt, completedAt, projectId);
}

export function listProjects(db: Database.Database) {
  return db.prepare(`
    SELECT
      p.id, p.title, p.status, p.agent_type, p.last_plan_at,
      p.created_at, p.updated_at,
      COALESCE(n.node_count, 0) as node_count,
      COALESCE(e.edge_total, 0) as edge_total,
      COALESCE(e.edge_unresulted, 0) as edge_unresulted,
      COALESCE(e.edge_inflight, 0) as edge_inflight
    FROM projects p
    LEFT JOIN (
      SELECT project_id, COUNT(*) as node_count
      FROM nodes GROUP BY project_id
    ) n ON n.project_id = p.id
    LEFT JOIN (
      SELECT
        project_id,
        COUNT(*) as edge_total,
        SUM(CASE WHEN to_node_ids = '[]' AND claimed_at IS NULL THEN 1 ELSE 0 END) as edge_unresulted,
        SUM(CASE WHEN to_node_ids = '[]' AND claimed_at IS NOT NULL THEN 1 ELSE 0 END) as edge_inflight
      FROM edges GROUP BY project_id
    ) e ON e.project_id = p.id
    ORDER BY p.created_at DESC
  `).all() as any[];
}

export function getProjectDetail(db: Database.Database, projectId: number) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
  if (!project) return null;

  const nodes = db.prepare(
    'SELECT id, title, description, created_by, edge_id, created_at FROM nodes WHERE project_id = ? ORDER BY id ASC'
  ).all(projectId) as any[];

  const edges = db.prepare(
    'SELECT id, from_node_ids, to_node_ids, title, direction_description, failure_count, claimed_at, created_at FROM edges WHERE project_id = ? ORDER BY id ASC'
  ).all(projectId) as any[];

  return {
    ...project,
    evidence_node_ids: project.evidence_node_ids ? JSON.parse(project.evidence_node_ids) : null,
    nodes,
    edges: edges.map((e: any) => ({
      ...e,
      from_node_ids: JSON.parse(e.from_node_ids),
      to_node_ids: JSON.parse(e.to_node_ids),
    })),
  };
}

export function getEdgeStatuses(db: Database.Database, projectId: number) {
  const edges = db.prepare(
    'SELECT id, from_node_ids, to_node_ids, title, direction_description, failure_count, claimed_at, created_at FROM edges WHERE project_id = ? ORDER BY id ASC'
  ).all(projectId) as any[];

  return edges.map((e: any) => {
    const toIds = JSON.parse(e.to_node_ids);
    let status: string;
    if (toIds.length > 0) {
      status = 'completed';
    } else if (e.claimed_at !== null) {
      status = 'running';
    } else {
      status = 'pending';
    }
    return {
      ...e,
      from_node_ids: JSON.parse(e.from_node_ids),
      to_node_ids: toIds,
      status,
    };
  });
}

export function getSettings(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

export function updateSettings(db: Database.Database, settings: Record<string, string>, ts: string): void {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  );
  const txn = db.transaction(() => {
    for (const [k, v] of Object.entries(settings)) {
      upsert.run(k, String(v), ts);
    }
  });
  txn();
}

// ---- Report operations ----

export function createReport(
  db: Database.Database,
  projectId: number,
  format: string,
  ts: string,
): number {
  const result = db.prepare(`
    INSERT INTO reports (project_id, status, format, created_at)
    VALUES (?, 'pending', ?, ?)
  `).run(projectId, format, ts);
  return result.lastInsertRowid as number;
}

export function updateReportStatus(
  db: Database.Database,
  reportId: number,
  status: string,
  filePath?: string,
  error?: string,
): void {
  const ts = new Date().toISOString();
  if (status === 'completed' && filePath) {
    db.prepare(`
      UPDATE reports SET status = ?, file_path = ?, completed_at = ? WHERE id = ?
    `).run(status, filePath, ts, reportId);
  } else if (status === 'failed' && error) {
    db.prepare(`
      UPDATE reports SET status = ?, error_message = ?, completed_at = ? WHERE id = ?
    `).run(status, error, ts, reportId);
  } else {
    db.prepare(`
      UPDATE reports SET status = ? WHERE id = ?
    `).run(status, reportId);
  }
}

export function getReport(
  db: Database.Database,
  reportId: number,
) {
  return db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId) as any;
}

export function getLatestReport(
  db: Database.Database,
  projectId: number,
) {
  return db.prepare(`
    SELECT * FROM reports 
    WHERE project_id = ? 
    ORDER BY created_at DESC 
    LIMIT 1
  `).get(projectId) as any;
}
