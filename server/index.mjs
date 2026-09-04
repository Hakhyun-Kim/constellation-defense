/* 결제 API 서비스 — 정적 파일을 서빙하지 않는 독립 진입점.
 *
 *   node server/index.mjs
 *
 * scripts/serve.mjs 는 개발 편의로 이 API 를 게임 파일과 같은 포트에 얹어 준다.
 * 배포에서 그러면 안 되는 이유는 둘의 수명이 다르기 때문이다 — 게임 번들은
 * 정적 호스팅에 올라가 캐시되고, 이 API 는 비밀을 들고 살아 있어야 한다.
 * 그래서 갈라 두고, Unity·Unreal·다른 도메인의 웹이 전부 같은 이 주소를 본다. */
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
  /* 설정이 틀렸으면 트래픽을 받기 전에 죽는다. 결제에서 "떠 있지만 일은 못 하는"
   * 상태가 제일 나쁘다 — 플레이어가 결제를 누른 뒤에야 드러나기 때문이다. */
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

  /* SIGTERM 이 오면 곧바로 준비 해제한다. 로드밸런서가 새 요청을 그만 보내는
   * 동안 진행 중인 웹훅 처리는 끝까지 간다 — 지급을 쓰다 만 채로 죽으면 안 된다. */
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

  /* 바인딩 실패는 즉시 드러나야 한다. 오류 처리 없이 listen 을 기다리면 포트가
   * 이미 쓰이고 있을 때 프로세스가 조용히 멈춰 선다 — 컨테이너에서는 헬스체크
   * 시간이 다 지나야 알게 되는 종류의 실패다. */
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

/* 직접 실행됐을 때만 신호를 잡는다 — 테스트에서 import 할 때는 붙이지 않는다. */
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
