import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { createProjectSchema, pushProjectSchema } from './schemas';

export function registerRoutes(app: FastifyInstance, db: Database.Database) {
  // POST /projects/
  app.post('/projects', async (request, reply) => {
    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues });
    }

    const { title, agent_type, image_tag } = parsed.data;
    const ts = new Date().toISOString();

    const { createProject } = await import('../db/operations');
    const projectId = createProject(db, title, agent_type, image_tag, ts);

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
    return reply.status(201).send(project);
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

    return { status: 'stopped' };
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
      return { status: 'active', message: 'Nodes added, current batch continues' };
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

    return { status: 'active', message: 'Project resumed' };
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
