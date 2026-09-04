/* =====================================================
 * 개발용 정적 서버
 * 포트는 PORT 환경변수를 따른다(없으면 8642). 하드코딩하지 않는 이유는
 * 같은 프로젝트를 여러 세션에서 동시에 열 때 포트가 겹치기 때문이다.
 *   node scripts/serve.mjs
 * ===================================================== */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createRepository } from '../server/repository-factory.mjs';
import { createStoreApi } from '../server/store-api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 8642;
/* Cloud Run 같은 컨테이너 환경은 모든 인터페이스에 바인딩해야 트래픽이 들어온다.
 * 기본값은 로컬 개발이 안전하도록 루프백으로 남겨 둔다. */
const host = process.env.HOST || '127.0.0.1';
/* 비워 두면 요청이 들어온 오리진을 그대로 쓴다 — localhost로 열었는데
 * 127.0.0.1로 돌려보내면 쿠키가 끊긴다. 샌드박스에서는 터널 주소를 지정한다. */
const publicUrl = process.env.PUBLIC_URL || '';
/* 기본값을 sandbox로 두는 이유: 과제·개발 환경이 기본이고, 운영 키를 쓰면서
 * 이 값을 안 바꾸면 아래 경고가 시작할 때 눈에 띄게 남는다. */
const environment = process.env.NEON_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
const mock = process.env.NEON_MOCK_CHECKOUT === '1';
const { repository, backend } = await createRepository({
  backend: process.env.STORE_BACKEND,
  dataDir: join(root, '.data'),
  environment: process.env.NEON_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
});
const storeApi = createStoreApi({
  repository,
  config: {
    apiKey: process.env.NEON_API_KEY,
    apiUrl: process.env.NEON_API_URL || 'https://api.neonpay.com',
    webhookSecret: process.env.NEON_WEBHOOK_SECRET,
    publicUrl,
    environment,
    mock,
    /* 게임을 CDN 에 두고 API 만 여기에 둘 때 필요하다. 비워 두면 교차 오리진 요청은 거절된다. */
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
  },
});

if (mock) {
  console.log('[store] 모의 체크아웃 모드 — Neon을 호출하지 않습니다.');
} else if (!process.env.NEON_API_KEY) {
  console.warn('[store] NEON_API_KEY가 없습니다. 체크아웃 생성이 실패합니다 (NEON_MOCK_CHECKOUT=1 로 모의 실행 가능).');
} else if (environment === 'sandbox') {
  console.warn('[store] NEON_ENVIRONMENT=sandbox 입니다. 운영 웹훅(isSandbox=false)은 무시됩니다.');
}
if (!mock && !process.env.NEON_WEBHOOK_SECRET) {
  console.warn('[store] NEON_WEBHOOK_SECRET이 없습니다. 모든 웹훅이 403으로 거절됩니다.');
}
if (!mock && !publicUrl) {
  console.warn('[store] PUBLIC_URL이 없습니다. 요청 오리진을 사용하지만, Neon이 닿을 수 있는 공개 주소를 지정해야 합니다.');
}

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

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (await storeApi(req, res, url)) return;
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';

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
}).listen(port, host, () => {
  console.log(`Constellation Defense → http://localhost:${port}/  (원장: ${backend})`);
});
