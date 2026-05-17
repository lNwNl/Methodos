import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { registerRoutes } from './routes';

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', agent_type TEXT NOT NULL, image_tag TEXT NOT NULL, last_plan_at TEXT, plan_round INTEGER NOT NULL DEFAULT 0, failure_count INTEGER NOT NULL DEFAULT 0, summary TEXT, evidence_node_ids TEXT, plan_started_at TEXT, plan_completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE nodes (project_id INTEGER NOT NULL, id INTEGER NOT NULL, title TEXT, description TEXT NOT NULL, created_by TEXT NOT NULL, edge_id INTEGER, created_at TEXT NOT NULL, PRIMARY KEY (project_id, id));
    CREATE TABLE edges (project_id INTEGER NOT NULL, id INTEGER NOT NULL, from_node_ids TEXT NOT NULL DEFAULT '[]', to_node_ids TEXT NOT NULL DEFAULT '[]', claimed_at TEXT, title TEXT, direction_description TEXT NOT NULL, failure_count INTEGER NOT NULL DEFAULT 0, priority REAL NOT NULL DEFAULT 1.0, created_at TEXT NOT NULL, PRIMARY KEY (project_id, id));
  `);
  return sqlite;
}

describe('API Routes', () => {
  let app: ReturnType<typeof Fastify>;
  let db: Database.Database;

  beforeAll(async () => {
    db = createTestDb();
    app = Fastify();
    registerRoutes(app, db);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /projects creates a project', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: { title: 'test', agent_type: 'mock', image_tag: 'mock:v1' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(1);
    expect(body.status).toBe('active');
  });

  it('GET /projects lists projects', async () => {
    const res = await app.inject({ method: 'GET', url: '/projects' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toBeInstanceOf(Array);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /projects/:id returns project detail', async () => {
    const res = await app.inject({ method: 'GET', url: '/projects/1' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(1);
    expect(body.nodes).toBeInstanceOf(Array);
    expect(body.edges).toBeInstanceOf(Array);
  });

  it('POST /projects/:id/stop stops an active project', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/projects/1/stop',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('stopped');
  });

  it('POST /projects/:id/push resumes a stopped project', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/projects/1/push',
      payload: { nodes: [{ description: 'new info' }] },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('active');
  });

  it('POST /projects/:id/push fails for active project but adds nodes', async () => {
    // Project 1 is now active from previous test
    const res = await app.inject({
      method: 'POST',
      url: '/projects/1/push',
      payload: { nodes: [{ description: 'another info' }] },
    });
    expect(res.statusCode).toBe(200);

    const detail = await app.inject({ method: 'GET', url: '/projects/1' });
    const body = JSON.parse(detail.body);
    const humanNodes = body.nodes.filter((n: any) => n.created_by === 'human');
    expect(humanNodes.length).toBeGreaterThanOrEqual(3); // original + new + another
  });

  it('GET /projects/:id/edges returns edge statuses', async () => {
    const res = await app.inject({ method: 'GET', url: '/projects/1/edges' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toBeInstanceOf(Array);
  });

  it('returns 404 for non-existent project', async () => {
    const res = await app.inject({ method: 'GET', url: '/projects/999' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for invalid project ID', async () => {
    const res = await app.inject({ method: 'GET', url: '/projects/abc' });
    expect(res.statusCode).toBe(400);
  });
});
