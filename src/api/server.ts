import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { registerRoutes } from './routes';

export function createServer(db: Database.Database, useDocker = false) {
  const app = Fastify({ logger: false });

  app.register(fastifyStatic, {
    root: join(process.cwd(), 'static'),
    prefix: '/',
    decorateReply: false,
  });

  registerRoutes(app, db, useDocker);

  return app;
}

export async function startServer(db: Database.Database, port: number = 3000, useDocker = false) {
  const app = createServer(db, useDocker);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`HTTP server listening on http://0.0.0.0:${port}`);
  return app;
}
