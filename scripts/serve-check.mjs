import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const child = spawn(process.execPath, ['scripts/serve.mjs'], {
  cwd: new URL('../', import.meta.url),
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1', NEON_MOCK_CHECKOUT: '1',
    NEON_ENVIRONMENT: 'sandbox', STORE_BACKEND: 'json', LOG_FORMAT: 'text' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dev server did not start')), 10000);
    child.once('exit', () => { clearTimeout(timer); reject(new Error('dev server exited')); });
    child.once('error', reject);
    child.stdout.on('data', (chunk) => {
      const match = String(chunk).match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  for (const path of ['/.env', '/.data/neon-store.json', '/.git/config', '/server/config.mjs',
    '/package.json', '/assets/../.env', '/assets/%2eenv', '/assets/foo%5c..%5c..%5c.env']) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    assert.equal(response.status, 404, `private path blocked: ${path}`);
  }
  for (const path of ['/', '/dist/game.js', '/css/style.css', '/assets/branding/icon.png']) {
    assert.equal((await fetch(`http://127.0.0.1:${port}${path}`)).status, 200, `public asset: ${path}`);
  }
  console.log('dev server check: public assets load; credentials, ledger and source are blocked');
} finally {
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}
