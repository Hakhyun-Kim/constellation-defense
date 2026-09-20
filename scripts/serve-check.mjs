import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const child = spawn(process.execPath, ['scripts/serve.mjs'], {
  cwd: new URL('../', import.meta.url),
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
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
  for (const path of ['/.env', '/.git/config', '/src/main.js',
    '/package.json', '/assets/../.env', '/assets/%2eenv', '/assets/foo%5c..%5c..%5c.env']) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    assert.equal(response.status, 404, `private path blocked: ${path}`);
  }
  for (const path of ['/', '/dist/game.js', '/css/style.css', '/assets/branding/icon.png']) {
    assert.equal((await fetch(`http://127.0.0.1:${port}${path}`)).status, 200, `public asset: ${path}`);
  }
  console.log('dev server check: public assets load; dotfiles, source and repository files are blocked');
} finally {
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}
