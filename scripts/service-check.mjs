/* 결제 API 를 독립 서비스로 세웠을 때의 계약 검증.
 *
 * store-server-check 가 "API 가 옳게 동작하는가"라면, 여기는 "배포 가능한
 * 서비스인가"를 본다 — 설정이 틀렸을 때 트래픽을 받기 전에 죽는가, 헬스체크가
 * 진실을 말하는가, 종료 신호에 준비 해제가 먼저 오는가, 정적 파일을 서빙하지
 * 않는가. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, isFatal } from '../server/config.mjs';
import { createLogger } from '../server/logger.mjs';
import { startService } from '../server/index.mjs';

const quiet = { log() {}, warn() {}, error() {} };
const base = {
  NEON_MOCK_CHECKOUT: '1',
  NEON_ENVIRONMENT: 'sandbox',
  PUBLIC_URL: 'https://store.example.test',
  HOST: '127.0.0.1',
  PORT: '0',
};

// --- 설정 판정: 결제를 할 수 없는 구성으로는 뜨지 않는다 ---
{
  const live = { ...base, NEON_MOCK_CHECKOUT: '0' };
  const { problems } = loadConfig(live, { role: 'service' });
  assert.ok(isFatal(problems), '실결제 모드에 키가 없으면 치명적');
  const reasons = problems.filter((p) => p.level === 'fatal').map((p) => p.message).join(' | ');
  assert.match(reasons, /NEON_API_KEY/, '무엇이 없어서 못 뜨는지 말해준다');
  assert.match(reasons, /NEON_WEBHOOK_SECRET/);

  const contradiction = loadConfig({ ...base, NEON_ENVIRONMENT: 'production' }, { role: 'service' });
  assert.ok(isFatal(contradiction.problems), '운영 환경에서 모의 결제는 모순');

  /* 같은 구성이라도 개발 서버는 계속 간다 — 자격 증명 없이 여는 것이 정상 경로다. */
  const dev = loadConfig({ NEON_MOCK_CHECKOUT: '1' }, { role: 'dev' });
  assert.equal(isFatal(dev.problems), false, '개발 서버는 같은 설정으로 죽지 않는다');
  assert.equal(dev.config.host, '127.0.0.1', '개발 기본값은 루프백');
  assert.equal(loadConfig({}, { role: 'service' }).config.host, '0.0.0.0', '서비스 기본값은 모든 인터페이스');

  /* PORT=0 은 "빈 포트를 아무거나"다. 0 을 falsy 로 흘려보내면 기본 포트로
   * 튀어 이미 쓰는 포트에 부딪히고, listen 이 조용히 멈춘다. 둘 다 실제로
   * 겪은 실패라 여기 못 박아 둔다. */
  assert.equal(loadConfig({ PORT: '0' }, { role: 'service' }).config.port, 0, 'PORT=0 은 그대로 0');
  assert.equal(loadConfig({}, { role: 'service' }).config.port, 8642, '없으면 기본 포트');
  assert.equal(loadConfig({ PORT: 'nonsense' }, { role: 'service' }).config.port, 8642, '이상한 값은 기본 포트');
  assert.equal(loadConfig({ PORT: '70000' }, { role: 'service' }).config.port, 8642, '범위 밖도 기본 포트');
}

// --- 로거: 형식만 바꾸면 수집기가 읽는다 ---
{
  const lines = [];
  const json = createLogger({ format: 'json' }, { log: (l) => lines.push(l), warn() {}, error() {} });
  json.info('granted', { accountId: 'acc-1', purchaseId: 'p-1' });
  const record = JSON.parse(lines[0]);
  assert.equal(record.severity, 'INFO');
  assert.equal(record.message, 'granted');
  assert.equal(record.accountId, 'acc-1', '나중에 캐물을 필드는 구조화해서 남긴다');
  assert.ok(record.time);

  const text = [];
  createLogger({ format: 'text' }, { log: (l) => text.push(l), warn() {}, error() {} }).info('granted', { accountId: 'acc-1' });
  assert.match(text[0], /\[store\] granted accountId=acc-1/, '사람이 읽는 형식도 필드를 잃지 않는다');
}

// --- 살아 있는 서비스 ---
const temporary = await mkdtemp(join(tmpdir(), 'constellation-service-'));
const service = await startService({ env: { ...base, STORE_BACKEND: 'json' }, out: quiet });
try {
  assert.ok(service.ok, '올바른 설정이면 뜬다');
  const at = `http://127.0.0.1:${service.port}`;

  const health = await fetch(`${at}/healthz`);
  assert.equal(health.status, 200);

  const ready = await fetch(`${at}/readyz`).then((r) => r.json());
  assert.equal(ready.ok, true);
  assert.equal(ready.backend, 'json', '준비 응답이 어떤 원장을 쓰는지 말해준다');
  assert.equal(ready.environment, 'sandbox');

  const catalog = await fetch(`${at}/api/store/catalog?locale=ko`);
  assert.equal(catalog.status, 200, '결제 API 는 그대로 붙어 있다');

  /* 서비스는 게임 파일을 서빙하지 않는다. 이게 갈라 놓은 이유의 절반이다 —
   * 번들은 캐시되는 정적 자산이고 이 프로세스는 비밀을 들고 있다. */
  for (const path of ['/', '/index.html', '/dist/game.js']) {
    assert.equal((await fetch(`${at}${path}`)).status, 404, `${path} 는 서비스가 서빙하지 않는다`);
  }

  /* 종료 신호가 오면 준비 해제가 먼저다. 로드밸런서가 새 요청을 끊는 동안
   * 진행 중인 지급은 끝까지 가야 한다. */
  await service.close();
  await assert.rejects(fetch(`${at}/healthz`), '닫힌 뒤에는 연결을 받지 않는다');

  console.log('service check: 설정 판정·헬스체크·로그 형식·정적 파일 분리·종료 통과');
} finally {
  if (!service.ok) process.exitCode = 1;
  await rm(temporary, { recursive: true, force: true });
}
