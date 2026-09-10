/* Read and validate configuration once. Fatal issues prevent production startup; warnings describe usable but noteworthy settings. Development reports both and continues to allow credential-free mock operation, avoiding late surprises at checkout. */

const trueish = (value) => value === '1' || value === 'true';

export function loadConfig(env = process.env, { role = 'service' } = {}) {
  const mock = trueish(env.NEON_MOCK_CHECKOUT);
  const environment = env.NEON_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  const backend = env.STORE_BACKEND === 'firestore' ? 'firestore' : 'json';

  /* PORT=0 requests an available port; Number(value) || default would incorrectly discard zero. */
  const rawPort = env.PORT === undefined || env.PORT === '' ? null : Number(env.PORT);
  const config = {
    role,
    port: Number.isInteger(rawPort) && rawPort >= 0 && rawPort <= 65535 ? rawPort : 8642,
    /* Containers bind all interfaces; local development defaults to loopback to avoid accidental network exposure. */
    host: env.HOST || (role === 'service' ? '0.0.0.0' : '127.0.0.1'),
    logFormat: env.LOG_FORMAT === 'json' ? 'json' : 'text',
    backend,
    projectId: env.GOOGLE_CLOUD_PROJECT || null,
    environment,
    mock,
    apiKey: env.NEON_API_KEY || '',
    apiUrl: env.NEON_API_URL || 'https://api.neonpay.com',
    webhookSecret: env.NEON_WEBHOOK_SECRET || '',
    /* When unset, use the request origin to preserve cookies across localhost versus 127.0.0.1. Production specifies a public URL. */
    publicUrl: env.PUBLIC_URL || '',
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
    /* Only a proxy that sets the geography header and strips the client's own copy makes it a signal; without one it is caller-supplied input. */
    trustGeoHeaders: trueish(env.TRUST_GEO_HEADERS),
    /* A front end (Cloud Run's) that appends the client address to X-Forwarded-For. Without one the socket peer is the client, and the header is caller-supplied. */
    trustProxy: trueish(env.TRUST_PROXY),
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
    /* Production needs its public address; development can use the request origin. */
    if (!config.publicUrl) {
      if (role === 'service') fatal('PUBLIC_URL is missing — successUrl and cancelUrl would point nowhere reachable (the webhook URL is registered in the Neon Console, not derived from it)');
      else warn('PUBLIC_URL is empty — falling back to the origin each request arrives on');
    }
    if (environment === 'sandbox') warn('NEON_ENVIRONMENT=sandbox — production webhooks (isSandbox=false) are ignored');
  }

  if (role === 'service' && !mock && !config.trustGeoHeaders && !config.trustProxy) {
    warn('neither TRUST_PROXY nor TRUST_GEO_HEADERS is set — the client address is the socket peer, so behind a proxy nobody is geolocated and a player without a selection is billed in the default market');
  }
  if (role === 'service' && mock) {
    warn('mock mode — no IP geolocation or pricing-sheet prices (Neon is not called); prices are server/catalog.mjs rows');
  }

  if (backend === 'json' && role === 'service') {
    warn('STORE_BACKEND=json — the ledger is a local file, which does not survive more than one instance');
  }

  return { config, problems };
}

export const isFatal = (problems) => problems.some((problem) => problem.level === 'fatal');
