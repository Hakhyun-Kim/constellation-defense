/* 설정을 한 번에 읽고, 한 번에 판정한다.
 *
 * 전에는 serve.mjs 가 환경변수를 읽으면서 그때그때 경고를 찍었다. 개발용으로는
 * 괜찮지만 서비스로는 곤란하다 — 키가 없어도 서버가 멀쩡히 뜨고, 플레이어가
 * 처음 결제를 누를 때가 되어서야 실패한다. 결제에서 그건 가장 비싼 순간이다.
 *
 * 그래서 문제를 두 등급으로 나눈다. fatal 은 "이 상태로는 일을 할 수 없다"이고
 * 서비스는 뜨기 전에 죽는다. warn 은 "돌아가지만 알고는 있어라"다. 개발 서버는
 * 둘 다 출력만 하고 계속 간다 — 자격 증명 없이 모의 모드로 여는 게 정상이므로. */

const trueish = (value) => value === '1' || value === 'true';

export function loadConfig(env = process.env, { role = 'service' } = {}) {
  const mock = trueish(env.NEON_MOCK_CHECKOUT);
  const environment = env.NEON_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  const backend = env.STORE_BACKEND === 'firestore' ? 'firestore' : 'json';

  const config = {
    role,
    port: Number(env.PORT) || 8642,
    /* 컨테이너는 모든 인터페이스에 바인딩해야 트래픽이 들어온다. 로컬 기본값은
     * 루프백으로 둬서 개발 중에 실수로 네트워크에 열리지 않게 한다. */
    host: env.HOST || (role === 'service' ? '0.0.0.0' : '127.0.0.1'),
    logFormat: env.LOG_FORMAT === 'json' ? 'json' : 'text',
    backend,
    projectId: env.GOOGLE_CLOUD_PROJECT || null,
    environment,
    mock,
    apiKey: env.NEON_API_KEY || '',
    apiUrl: env.NEON_API_URL || 'https://api.neonpay.com',
    webhookSecret: env.NEON_WEBHOOK_SECRET || '',
    /* 비워 두면 요청이 들어온 오리진을 쓴다 — localhost 로 열었는데 127.0.0.1 로
     * 돌려보내면 쿠키가 끊긴다. 배포에서는 공개 주소를 지정한다. */
    publicUrl: env.PUBLIC_URL || '',
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
  };

  const problems = [];
  const fatal = (message) => problems.push({ level: 'fatal', message });
  const warn = (message) => problems.push({ level: 'warn', message });

  if (mock && environment === 'production') {
    fatal('NEON_MOCK_CHECKOUT=1 with NEON_ENVIRONMENT=production: refusing to fake payments in production');
  }

  if (mock) {
    warn('mock checkout mode — Neon is never called');
  } else {
    if (!config.apiKey) fatal('NEON_API_KEY is missing — checkout creation cannot work');
    if (!config.webhookSecret) fatal('NEON_WEBHOOK_SECRET is missing — every webhook would be rejected with 403');
    /* 서비스는 자기 공개 주소를 알아야 한다. 개발 서버는 요청 오리진으로 때울 수 있다. */
    if (!config.publicUrl) {
      if (role === 'service') fatal('PUBLIC_URL is missing — successUrl and the webhook target would point nowhere reachable');
      else warn('PUBLIC_URL is empty — falling back to the origin each request arrives on');
    }
    if (environment === 'sandbox') warn('NEON_ENVIRONMENT=sandbox — production webhooks (isSandbox=false) are ignored');
  }

  if (backend === 'json' && role === 'service') {
    warn('STORE_BACKEND=json — the ledger is a local file, which does not survive more than one instance');
  }

  return { config, problems };
}

export const isFatal = (problems) => problems.some((problem) => problem.level === 'fatal');
