/* Development static server. PORT defaults to 8642; override it for concurrent workspaces. Usage: node scripts/serve.mjs */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/* PORT=0 asks the OS for a free port (used by serve-check). */
const port = process.env.PORT != null && process.env.PORT !== '' ? Number(process.env.PORT) : 8642;
const host = process.env.HOST || '127.0.0.1';

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
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';

    // Only the game's public build is served, never the repository around it.
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
}).listen(port, host, () => {
  console.log(`Constellation Defense → http://localhost:${server.address().port}/`);
});
