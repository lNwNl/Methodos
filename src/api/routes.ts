import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { createProjectSchema, pushProjectSchema, settingsSchema } from './schemas';

export function registerRoutes(app: FastifyInstance, db: Database.Database, useDocker = false) {
  // GET /health
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

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
      return reply.status(400).send({ error: 'OpenCode requires Docker mode. Remove --mock flag.' });
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
          insertNode(db, id, null, node.description, 'human', null, ts);
        }
      }
      return reply.header('HX-Trigger', 'projectPushed').send({ status: 'active', message: 'Nodes added, current batch continues' });
    }

    // Non-active → resume
    const ts = new Date().toISOString();
    const parsed = pushProjectSchema.safeParse(request.body || {});

    if (parsed.success && parsed.data.nodes.length > 0) {
      for (const node of parsed.data.nodes) {
        insertNode(db, id, null, node.description, 'human', null, ts);
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

  // GET /settings
  app.get('/settings', async (_request, _reply) => {
    const { getSettings } = await import('../db/operations');
    return getSettings(db);
  });

  // PUT /settings
  app.put('/settings', async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues });
    }

    const { getSettings, updateSettings } = await import('../db/operations');
    const { reloadConfig } = await import('../config');

    const ts = new Date().toISOString();
    updateSettings(db, parsed.data as Record<string, string>, ts);
    reloadConfig(db);

    return reply.header('HX-Trigger', 'settingsUpdated').send(getSettings(db));
  });
}
