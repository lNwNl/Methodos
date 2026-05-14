import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { registerRoutes } from './routes';

export function createServer(db: Database.Database) {
  const app = Fastify({ logger: false });

  // Static files for Web UI (future)
  app.register(fastifyStatic, {
    root: join(process.cwd(), 'static'),
    prefix: '/',
    decorateReply: false,
  });

  registerRoutes(app, db);

  return app;
}

export async function startServer(db: Database.Database, port: number = 3000) {
  const app = createServer(db);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`HTTP server listening on http://0.0.0.0:${port}`);
  return app;
}
