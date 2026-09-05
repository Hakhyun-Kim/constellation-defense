/* Standalone payment API, with no static file serving. Usage: node server/index.mjs. Development mounts it alongside game files via scripts/serve.mjs; production separates cacheable game assets from the credential-bearing API. Web and native clients share this service. */
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadConfig, isFatal } from './config.mjs';
import { createLogger } from './logger.mjs';
import { createRepository } from './repository-factory.mjs';
import { createStoreApi } from './store-api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function startService({ env = process.env, out = console } = {}) {
  const { config, problems } = loadConfig(env, { role: 'service' });
  const log = createLogger({ format: config.logFormat }, out);

  for (const problem of problems) log[problem.level === 'fatal' ? 'error' : 'warn'](problem.message);
  /* Reject bad configuration before accepting traffic rather than failing only when the player starts checkout. */
  if (isFatal(problems)) {
    log.error('refusing to start with a configuration that cannot serve payments');
    return { ok: false, problems };
  }

  const { repository, backend } = await createRepository({
    backend: config.backend,
    dataDir: join(root, '.data'),
    environment: config.environment,
    projectId: config.projectId,
  });

  const storeApi = createStoreApi({ repository, config, log });

  /* Drop readiness on SIGTERM and let in-flight webhooks finish while the load balancer stops sending new requests. */
  let ready = true;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://service.local');
    try {
      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname === '/readyz') {
        if (!ready) {
          res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, reason: 'shutting down' }));
          return;
        }
        await repository.healthy();
        res.writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ ok: true, backend, environment: config.environment }));
        return;
      }
      if (await storeApi(req, res, url)) return;
      res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
    } catch (error) {
      log.error(error, { path: url.pathname });
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'unavailable' }));
      }
    }
  });

  /* Report binding errors immediately; otherwise an occupied port can leave startup waiting until health checks time out. */
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => { server.off('error', reject); resolve(); });
    });
  } catch (error) {
    log.error(`cannot listen on ${config.host}:${config.port} — ${error.message}`);
    return { ok: false, problems: [{ level: 'fatal', message: error.message }] };
  }
  log.info('store service listening', {
    port: server.address().port,
    backend,
    environment: config.environment,
    mock: config.mock,
  });

  const close = async () => {
    ready = false;
    await new Promise((resolve) => server.close(resolve));
  };

  return { ok: true, server, close, config, backend, log, port: server.address().port };
}

/* Install signal handlers only when executed directly, not when imported by tests. */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const service = await startService();
  if (!service.ok) process.exit(1);
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      service.log.info(`${signal} received, draining`);
      await service.close();
      process.exit(0);
    });
  }
}
