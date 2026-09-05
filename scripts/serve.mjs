/* Development static server. PORT defaults to 8642; override it for concurrent workspaces. Mount the payment API here for local same-origin use. Production uses server/index.mjs for API-only hosting and a separate static game host. Development reports configuration problems without exiting, allowing credential-free mock use. Usage: node scripts/serve.mjs */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadConfig } from '../server/config.mjs';
import { createLogger } from '../server/logger.mjs';
import { createRepository } from '../server/repository-factory.mjs';
import { createStoreApi } from '../server/store-api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { config, problems } = loadConfig(process.env, { role: 'dev' });
const log = createLogger({ format: config.logFormat });

for (const problem of problems) log.warn(problem.message);

const { repository, backend } = await createRepository({
  backend: config.backend,
  dataDir: join(root, '.data'),
  environment: config.environment,
  projectId: config.projectId,
});
const storeApi = createStoreApi({ repository, config, log });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (await storeApi(req, res, url)) return;
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';

    // This used to serve the entire repository, including payment credentials
    // and bearer identities in the ledger. Only the game's public build is served.
    if (!/^\/(?:index\.html|(?:assets|css|dist)\/[^\\:]+)$/.test(rel)
        || rel.split('/').some((part) => part.startsWith('.'))) {
      res.writeHead(404).end('404');
      return;
    }

    /* Reject paths escaping the root directory. */
    const full = normalize(join(root, rel));
    if (full !== root && !full.startsWith(root + sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    const info = await stat(full);
    const body = await readFile(info.isDirectory() ? join(full, 'index.html') : full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      /* Disable development caching to avoid debugging stale bundles. */
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
}).listen(config.port, config.host, () => {
  log.info(`Constellation Defense → http://localhost:${server.address().port}/`, { ledger: backend });
});
