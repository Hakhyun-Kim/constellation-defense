import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonRepository } from '../server/repository.mjs';
import { createNeonCheckout } from '../server/neon-client.mjs';

await assert.rejects(createNeonCheckout({ apiKey: 'test', payload: {}, timeoutMs: 10,
  fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response('{}')), 1000);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }),
}), { name: 'TimeoutError' });
await assert.rejects(createNeonCheckout({ apiKey: 'test', payload: {},
  fetchImpl: async () => new Response(JSON.stringify({ checkoutId: 'id', token: 'token' })),
}), /incomplete hosted checkout/);

const dir = await mkdtemp(join(tmpdir(), 'neon-commit-check-'));
try {
  const path = join(dir, 'ledger.json');
  const repo = new JsonRepository(path);
  await repo.recordCheckout({ externalReferenceId: 'ref', accountId: 'account', sku: 'sku',
    entitlement: 'banner', price: 100, currency: 'USD', status: 'pending' });
  const event = { eventId: 'event', externalReferenceId: 'ref', accountId: 'account',
    purchaseId: 'purchase', sku: 'sku', quantity: 1, price: 100, currency: 'USD' };
  // Force a real filesystem failure after the operation, before commit.
  await mkdir(`${path}.tmp`);
  await assert.rejects(repo.fulfill(event));
  assert.deepEqual(await repo.entitlements('account'), {}, 'failed writes grant nothing in memory');
  assert.deepEqual(await new JsonRepository(path).entitlements('account'), {}, 'disk agrees');
  await rm(`${path}.tmp`, { recursive: true });
  assert.equal((await repo.fulfill(event)).duplicate, false, 'retry commits instead of acknowledging lost data');
  assert.ok((await new JsonRepository(path).entitlements('account')).banner);
  assert.equal((await repo.fulfill(event)).duplicate, true);
  console.log('store regression check: failed disk commit stays retryable; restart preserves grant');
} finally {
  await rm(dir, { recursive: true, force: true });
}
