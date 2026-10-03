import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './app';
import { dataDir, repoRoot } from './db';
import { init } from './store';

init();

const webDist = resolve(repoRoot, 'apps/web/dist');
app.use('/photos/*', serveStatic({ root: dataDir }));
if (existsSync(webDist)) {
  app.use('/*', serveStatic({ root: webDist }));
  const index = readFileSync(resolve(webDist, 'index.html'), 'utf8');
  app.get('*', (c) => c.html(index));
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => console.log(`API na http://localhost:${port}`));
