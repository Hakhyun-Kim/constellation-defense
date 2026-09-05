/* =====================================================
 * 개발용 정적 서버
 * 포트는 PORT 환경변수를 따른다(없으면 8642). 하드코딩하지 않는 이유는
 * 같은 프로젝트를 여러 세션에서 동시에 열 때 포트가 겹치기 때문이다.
 *   node scripts/serve.mjs
 *
 * 결제 API 를 같은 포트에 얹어 준다 — 로컬에서 게임과 상점을 한 주소로 열기
 * 위해서다. 배포는 그렇게 하지 않는다: server/index.mjs 가 API 만 서빙하는
 * 독립 진입점이고, 게임 번들은 정적 호스팅으로 간다.
 *
 * 설정 문제는 여기서 전부 경고로만 처리하고 계속 간다. 자격 증명 없이 모의
 * 모드로 여는 것이 개발의 정상 경로이기 때문 — 서비스 쪽은 같은 문제로 죽는다.
 * ===================================================== */
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

    /* 루트 밖으로 나가는 경로는 거부한다 (../ 트래버설) */
    const full = normalize(join(root, rel));
    if (full !== root && !full.startsWith(root + sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    const info = await stat(full);
    const body = await readFile(info.isDirectory() ? join(full, 'index.html') : full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      /* 개발 중에는 항상 최신 파일을 본다 — 캐시된 번들 때문에 헛디버깅하는 일이 잦다 */
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
}).listen(config.port, config.host, () => {
  log.info(`Constellation Defense → http://localhost:${server.address().port}/`, { ledger: backend });
});
