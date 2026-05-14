import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { createProjectSchema, pushProjectSchema } from './schemas';

export function registerRoutes(app: FastifyInstance, db: Database.Database, useDocker = false) {
  // GET /mode
  app.get('/mode', async (_request, _reply) => {
    return { docker: useDocker };
  });

  // POST /projects/
  app.post('/projects', async (request, reply) => {
    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues });
    }

    const { title, agent_type } = parsed.data;

    if (agent_type === 'opencode' && !useDocker) {
      return reply.status(400).send({ error: 'OpenCode requires Docker mode. Start with --docker flag.' });
    }

    const { config } = await import('../config');
    const image_tag = config.agentImages[agent_type] || `${agent_type}:latest`;
    const ts = new Date().toISOString();

    const { createProject } = await import('../db/operations');
    const projectId = createProject(db, title, agent_type, image_tag, ts);

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;

    const { ensureContainer } = await import('../docker/manager');
    ensureContainer(projectId, image_tag).catch((err: any) => {
      console.error(`Failed to start container for project ${projectId}:`, err.message);
    });

    return reply.status(201).header('HX-Trigger', 'projectCreated').send(project);
  });

  // GET /projects-list — HTML rendering for overview page
  app.get('/projects-list', async (_request, reply) => {
    const { listProjects } = await import('../db/operations');
    const projects = listProjects(db);

    function esc(s: string) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function statusBadge(status: string, isPlanning = false) {
      const map: Record<string, string> = {
        active: 'bg-emerald-900/50 text-emerald-400 border-emerald-800',
        completed: 'bg-blue-900/50 text-blue-400 border-blue-800',
        failed: 'bg-red-900/50 text-red-400 border-red-800',
        stopped: 'bg-gray-800 text-gray-400 border-gray-700',
      };
      if (isPlanning) {
        return `<span class="px-2 py-0.5 rounded-full text-xs border bg-emerald-900/50 text-emerald-400 border-emerald-800 animate-pulse">推理中</span>`;
      }
      const cls = map[status] || 'bg-gray-800 text-gray-400 border-gray-700';
      return `<span class="px-2 py-0.5 rounded-full text-xs border ${cls}">${esc(status)}</span>`;
    }

    const html = projects.map((p: any) => {
      const isPlanning = p.status === 'active' && !p.last_plan_at && p.edge_total === 0;
      const statusLabel = isPlanning ? '推理中' : p.status;
      return `
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors">
        <div class="flex items-center justify-between">
          <div class="flex-1 min-w-0">
            <a href="/project.html?id=${p.id}" class="text-base font-medium hover:text-emerald-400 truncate block">${esc(p.title)}</a>
            <div class="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
              ${statusBadge(statusLabel, isPlanning)}
              <span>Nodes: ${p.node_count}</span>
              <span>Edges: ${p.edge_total}</span>
              ${p.edge_unresulted > 0 ? `<span class="text-amber-400">待处理: ${p.edge_unresulted}</span>` : ''}
              ${p.edge_inflight > 0 ? `<span class="text-blue-400">执行中: ${p.edge_inflight}</span>` : ''}
              ${isPlanning ? '<span class="text-emerald-400 animate-pulse">▊ Plan 推理中…</span>' : ''}
            </div>
          </div>
          <div class="flex gap-2 ml-4 shrink-0">
            ${p.status === 'active' ? `
            <button class="px-3 py-1.5 text-xs rounded-lg bg-amber-900/50 text-amber-400 hover:bg-amber-900 border border-amber-800 transition-colors"
              hx-post="/projects/${p.id}/stop" hx-swap="none">暂停</button>
            ` : ''}
            ${p.status !== 'active' ? `
            <button class="px-3 py-1.5 text-xs rounded-lg bg-blue-900/50 text-blue-400 hover:bg-blue-900 border border-blue-800 transition-colors"
              hx-post="/projects/${p.id}/push" hx-swap="none">推进</button>
            ` : ''}
          </div>
        </div>
      </div>
    `}).join('');

    if (!html) {
      return reply.type('text/html').send('<div class="text-center text-gray-500 py-12">暂无项目</div>');
    }

    return reply.type('text/html').send(html);
  });

  // GET /projects
  app.get('/projects', async (_request, _reply) => {
    const { listProjects } = await import('../db/operations');
    return listProjects(db);
  });

  // GET /projects/:id
  app.get('/projects/:id', async (request, reply) => {
    const { getProjectDetail } = await import('../db/operations');
    const id = parseInt((request.params as any).id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid project ID' });

    const project = getProjectDetail(db, id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    return project;
  });

  // POST /projects/:id/stop
  app.post('/projects/:id/stop', async (request, reply) => {
    const { getProject, updateProject } = await import('../db/operations');
    const id = parseInt((request.params as any).id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid project ID' });

    const project = getProject(db, id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    if (project.status !== 'active') {
      return reply.status(400).send({ error: `Project is ${project.status}, not active` });
    }

    const ts = new Date().toISOString();
    updateProject(db, id, { status: 'stopped' }, ts);

    const { stopContainer } = await import('../docker/manager');
    stopContainer(id).catch(() => {});
    return reply.header('HX-Trigger', 'projectUpdated').send({ status: 'stopped' });
  });

  // POST /projects/:id/push
  app.post('/projects/:id/push', async (request, reply) => {
    const { getProject, updateProject, insertNode } = await import('../db/operations');
    const id = parseInt((request.params as any).id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid project ID' });

    const project = getProject(db, id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    if (project.status === 'active') {
      // Don't interrupt, just add nodes if provided
      const parsed = pushProjectSchema.safeParse(request.body || {});
      if (parsed.success) {
        const ts = new Date().toISOString();
        for (const node of parsed.data.nodes) {
          insertNode(db, id, node.description, 'human', null, ts);
        }
      }
      return reply.header('HX-Trigger', 'projectPushed').send({ status: 'active', message: 'Nodes added, current batch continues' });
    }

    // Non-active → resume
    const ts = new Date().toISOString();
    const parsed = pushProjectSchema.safeParse(request.body || {});

    if (parsed.success && parsed.data.nodes.length > 0) {
      for (const node of parsed.data.nodes) {
        insertNode(db, id, node.description, 'human', null, ts);
      }
    }

    updateProject(db, id, {
      status: 'active',
      lastPlanAt: null,
      failureCount: 0,
      summary: null,
      evidenceNodeIds: null,
    }, ts);

    return reply.header('HX-Trigger', 'projectPushed').send({ status: 'active', message: 'Project resumed' });
  });

  // GET /projects/:id/edges
  app.get('/projects/:id/edges', async (request, reply) => {
    const { getEdgeStatuses, getProject } = await import('../db/operations');
    const id = parseInt((request.params as any).id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid project ID' });

    const project = getProject(db, id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    return getEdgeStatuses(db, id);
  });
}
