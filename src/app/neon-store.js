import { paymentEvent, redactPayment } from './neon-events.js';
import { EXCERPTS } from './neon-excerpts.generated.js';
/* Neon checkout client. Redirects are UI signals only; query the server for ownership. Manually entering purchase=return must never grant an item. */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const POLL_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 1500;

const TOKEN_KEY = 'cd_neon_player';

/* An optional API origin supports separate static-game and payment-service
 * hosting; empty means same origin. A shared link may carry ?api=<origin> so
 * the hosted Pages build talks to a deployed payment service directly — the
 * CSP connect-src allowlist is the enforcement that keeps any other value
 * inert, and return URLs from the server carry the parameter back. */
function resolveApiBase() {
  const param = new URLSearchParams(location.search).get('api') || '';
  if (/^https?:\/\/[\w.-]+(:\d+)?$/.test(param)) return param.replace(/\/$/, '');
  return (document.querySelector('meta[name="neon-api-base"]')?.content || '').replace(/\/$/, '');
}
const API_BASE = resolveApiBase();

/* Always send persisted bearer identity for native/cross-origin compatibility, even when same-origin cookies also work. */
function playerToken() {
  try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}

function rememberPlayer(id) {
  try { if (id) localStorage.setItem(TOKEN_KEY, id); } catch { /* Storage unavailable: same-origin cookies remain a fallback. */ }
}

/* The dedicated gateway reuses this identity so purchases made through the
 * server belong to the same account as client-mode purchases. */
export const knownPlayerToken = () => playerToken();
export const adoptPlayerIdentity = (id) => rememberPlayer(id);

/* Default wire: direct HTTP to the payment API. The dedicated viewer swaps
 * this for a WebSocket transport so the game server is the only endpoint the
 * client talks to; everything above the transport is unchanged either way. */
async function httpTransport(path, options = {}) {
  const token = playerToken();
  const headers = { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: API_BASE ? 'omit' : 'same-origin',
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, data };
}

let activeTransport = httpTransport;

async function request(path, options = {}) {
  const { status, ok, data } = await activeTransport(path, options);
  paymentEvent('request', { path, method: options.method || 'GET', status, request: options.body ? redactPayment(JSON.parse(options.body)) : null, response: redactPayment(data) });
  if (!ok) throw new Error(data.error || `Store request failed (${status})`);
  return data;
}

function postJson(path, payload) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function copy(locale) {
  return locale === 'en' ? {
    title: 'Celestial Store', buy: 'Buy with Neon', owned: 'Owned', close: 'Close',
    pending: 'Confirming your purchase…', error: 'The store is temporarily unavailable.',
    cosmetic: 'Cosmetic only · no gameplay advantage', region: 'Billing region',
    slow: 'This is taking longer than usual. Your purchase is safe.', retry: 'Check again',
    mock: 'Mock mode · no payment is taken', already_owned: 'You already own this.',
    account: 'This device', transfer: 'Get transfer code', useCode: 'Use a code',
    codeShown: 'Write this down. It is shown once and works once, for 24 hours.',
    codePrompt: 'Enter a transfer code from your other device',
    invalid_code: 'That code is not valid — it may be used or expired.',
    moved: 'This device now uses that account.',
  } : {
    title: '별빛 상점', buy: 'Neon으로 구매', owned: '보유 중', close: '닫기',
    pending: '구매 완료를 확인하고 있어요…', error: '상점을 잠시 이용할 수 없어요.',
    cosmetic: '치장 전용 · 전투 능력에 영향 없음', region: '결제 지역',
    slow: '확인이 평소보다 늦어지고 있어요. 구매는 안전하게 기록돼 있어요.', retry: '다시 확인',
    mock: '모의 모드 · 실제 결제가 일어나지 않아요', already_owned: '이미 가지고 있어요.',
    account: '이 기기', transfer: '인계 코드 받기', useCode: '코드 입력',
    codeShown: '적어 두세요. 한 번만 보여 주고, 한 번만 쓰이고, 24시간 뒤 만료됩니다.',
    codePrompt: '다른 기기에서 받은 인계 코드를 입력하세요',
    invalid_code: '쓸 수 없는 코드입니다 — 이미 사용됐거나 만료됐어요.',
    moved: '이 기기가 그 계정을 씁니다.',
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  /* Render server-provided product text with textContent, never innerHTML. */
  if (text !== undefined) node.textContent = text;
  return node;
}

export function initNeonStore({ locale = 'ko', onEntitlements = () => {}, onPreview = () => {}, transport = null } = {}) {
  if (transport) activeTransport = transport;
  const button = document.querySelector('#neonStoreBtn');
  const modal = document.querySelector('#neonStoreModal');
  if (!button || !modal) return;
  const title = modal.querySelector('#neonStoreTitle');
  const product = modal.querySelector('#neonProduct');
  const status = modal.querySelector('#neonStoreStatus');
  const close = modal.querySelector('#neonStoreClose');
  const words = copy(locale);
  let catalog = null;
  let entitlements = {};
  let busy = false;
  let selectedSku = null;
  let pending = null;
  let lastReference = null;
  let polling = false;
  /* Live progress of a hosted-mode real refund: stage 1 request sent,
   * 3 Neon accepted (waiting for the webhook), 5 revoked and gone. */
  let refundFlow = null;

  title.textContent = `✦ ${words.title}`;
  close.textContent = words.close;
  close.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.classList.add('hidden'); });
  button.addEventListener('click', () => { modal.classList.remove('hidden'); paymentEvent('store'); });

  function renderRegion() {
    if (!catalog || catalog.markets.length < 2) return null;
    const row = element('label', 'neon-region');
    row.append(element('span', null, words.region));
    const select = element('select');
    for (const market of catalog.markets) {
      const option = element('option', null, `${market.code} · ${market.currency}`);
      option.value = market.code;
      if (market.code === catalog.country) option.selected = true;
      select.append(option);
    }
    /* Only explicit billing selection changes country; game language must not alter tax or payment methods. */
    select.addEventListener('change', async () => {
      try {
        await postJson('/api/store/market', { country: select.value });
        await loadCatalog();
      } catch (error) { status.textContent = error.message; }
    });
    row.append(select);
    return row;
  }

  /* Account transfer moves device-held identity; the code is shown only once when issued. */
  function renderAccount() {
    const row = element('div', 'neon-account');
    row.append(element('span', null, words.account));

    const getCode = element('button', 'neon-linkish', words.transfer);
    getCode.addEventListener('click', async () => {
      try {
        const { code } = await postJson('/api/account/transfer-code', {});
        status.replaceChildren();
        const shown = element('code', 'neon-code', code);
        status.append(shown, element('small', 'neon-code-note', words.codeShown));
      } catch (error) { status.textContent = words[error.message] || error.message; }
    });

    const useCode = element('button', 'neon-linkish', words.useCode);
    useCode.addEventListener('click', async () => {
      /* The demo uses prompt for transfer-code entry; a production title should provide a dedicated account screen. */
      const entered = window.prompt(words.codePrompt);
      if (!entered) return;
      try {
        const { accountId } = await postJson('/api/account/claim', { code: entered });
        rememberPlayer(accountId);
        status.textContent = words.moved;
        await loadCatalog();
        await refreshEntitlements();
      } catch (error) { status.textContent = words[error.message] || error.message; }
    });

    row.append(getCode, useCode);
    return row;
  }

  const label = (en, ko) => locale === 'en' ? en : ko;
  const owns = (item) => Boolean(entitlements[item.entitlement]);
  function action(text, run, className = 'neon-linkish') {
    const node = element('button', className, text);
    node.disabled = busy;
    node.addEventListener('click', async () => {
      busy = true; render();
      try { await run(); } catch (error) { status.textContent = words[error.message] || error.message; }
      finally { busy = false; render(); }
    });
    return node;
  }
  function render() {
    if (!catalog) return;
    product.replaceChildren();
    const icons = ['🚩', '💎', '🛡'];
    for (const [index, item] of catalog.items.entries()) {
      const card = element('article', 'neon-item');
      card.dataset.sku = item.sku;
      const art = element('div', 'neon-product-art', icons[index] || '✦');
      art.setAttribute('aria-hidden', 'true');
      const body = element('div', 'neon-product-copy');
      body.append(element('b', null, item.name), element('small', null, item.subtitle));
      const buy = action(owns(item) ? words.owned : `${words.buy} · ${item.displayPrice}`, () => startCheckout(item), 'big amber');
      buy.dataset.buy = item.sku;
      if (index === 0) buy.id = 'neonBuyBtn';
      buy.disabled = busy || owns(item) || Boolean(pending);
      card.append(art, body, buy); product.append(card);
    }
    product.append(element('small', null, words.cosmetic));
    if (catalog.checkoutMode === 'mock') {
      product.append(element('small', 'neon-mock', words.mock));
      if (pending) {
        const panel = element('section', 'neon-checkout');
        panel.append(element('b', null, label('Mock checkout — your confirmation', '모의 결제 — 구매 확인')),
          element('p', null, `${pending.item.name} · ${pending.item.displayPrice}`),
          element('small', null, label('No hosted page or signature is simulated here. Confirm calls the real fulfillment ledger. Keep this pending to demonstrate delayed delivery.', '호스팅 화면·서명을 흉내 내지 않습니다. 확인하면 실제 지급 원장을 호출합니다. 지연 지급을 보려면 대기 상태로 두세요.')));
        panel.append(action(label('Confirm test purchase', '테스트 구매 확인'), async () => {
          await postJson('/api/store/mock-complete', { reference: pending.reference });
          pending = null; await refreshEntitlements();
          status.textContent = label('Delivered. Close the store to see your castle.', '지급 완료. 상점을 닫고 성을 확인하세요.');
          paymentEvent('fulfilled');
        }, 'big amber'), action(label('Cancel / leave unpaid', '취소 / 미결제 유지'), () => {
          pending = null; status.textContent = label('Unpaid checkout: nothing granted.', '미결제 상태: 지급되지 않았습니다.'); paymentEvent('cancelled');
        }));
        product.append(panel);
      }
      const inventory = element('section', 'neon-inventory');
      inventory.append(element('b', null, label('Test inventory & refunds', '테스트 보관함 · 환불')),
        element('small', null, label('Refund removes only that decoration. You can buy it again. No money moves.', '선택한 장식만 회수하고 재구매할 수 있습니다. 실제 돈은 이동하지 않습니다.')));
      let count = 0;
      for (const item of catalog.items.filter(owns)) {
        const purchaseId = entitlements[item.entitlement].purchaseId;
        if (!purchaseId?.startsWith('mock-purchase-')) continue;
        count++;
        const row = element('div', 'neon-refund-row');
        row.append(element('span', null, item.name), action(label('Test refund', '테스트 환불'), async () => {
          lastReference = purchaseId.slice('mock-purchase-'.length);
          await postJson('/api/store/mock-refund', { reference: lastReference });
          await refreshEntitlements(); paymentEvent('refunded', { sku: item.sku });
          status.textContent = label('Refunded. Decoration removed; other items remain.', '환불 완료. 다른 아이템은 유지됩니다.');
        }));
        inventory.append(row);
      }
      if (!count) inventory.append(element('p', null, label('No mock purchases to refund yet.', '환불할 모의 구매가 없습니다.')));
      const failures = element('details', 'neon-failures');
      failures.append(element('summary', null, label('Try delivery failure cases', '지급 실패 사례 테스트')));
      failures.append(action(label('Send forged webhook (expect 403)', '위조 웹훅 전송 (403 예상)'), async () => {
        try { await postJson('/api/webhooks/neon', { id: 'inspector-forgery', type: 'purchase.completed' }); }
        catch (error) { status.textContent = error.message; }
        await refreshEntitlements();
      }));
      if (lastReference) failures.append(action(label('Replay last delivery', '마지막 지급 재전송'), async () => {
        const result = await postJson('/api/store/mock-complete', { reference: lastReference, distinct: true });
        await refreshEntitlements();
        status.textContent = JSON.stringify(result);
        paymentEvent('replayed');
      }));
      inventory.append(failures);
      product.append(inventory);
    } else {
      /* Hosted mode: the shared demo can walk the real refund lifecycle too —
       * request → Neon 201 → refund.processed webhook → ledger revoke → Owned
       * gone. The button only asks; the webhook is the truth this page polls. */
      const ownedItems = catalog.items.filter(owns);
      if (ownedItems.length || refundFlow) {
        const inventory = element('section', 'neon-inventory');
        inventory.append(element('b', null, label('Inventory — real sandbox refund', '보관함 — 실 샌드박스 환불')),
          element('small', null, label('Item-level request to Neon; only the signed refund.processed webhook revokes. This page watches for it.', 'Neon에 item 단위로 요청하고, 회수는 서명된 refund.processed 웹훅으로만 일어납니다. 이 화면이 그 도착을 지켜봅니다.')));
        for (const item of ownedItems) {
          const row = element('div', 'neon-refund-row');
          row.append(element('span', null, item.name),
            action(label('Refund (real sandbox)', '환불 (실 샌드박스)'), () => { void startRealRefund(item); }));
          inventory.append(row);
        }
        if (refundFlow) inventory.append(renderRefundFlow());
        product.append(inventory);
      }
    }
    const region = renderRegion();
    if (region) product.append(region);
    product.append(renderAccount());
    document.querySelector('#paidCosmeticBadge')?.classList.toggle('hidden', !Object.keys(entitlements).length);
  }

  async function refreshEntitlements() {
    const data = await request('/api/store/entitlements');
    entitlements = data.entitlements || {};
    onEntitlements(entitlements);
    render();
    paymentEvent('inventory', { items: Object.keys(entitlements) });
    return entitlements;
  }

  async function loadCatalog() {
    catalog = await request(`/api/store/catalog?locale=${locale}`);
    rememberPlayer(catalog.playerId);
    render();
  }

  /* The return redirect may precede the webhook. Poll ownership and offer a retry when delivery takes longer; the return itself grants nothing. */
  async function pollEntitlements() {
    if (polling) return;
    polling = true;
    status.textContent = words.pending;
    try {
      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
        await refreshEntitlements();
        const item = catalog.items.find(item => item.sku === selectedSku);
        if (item && owns(item)) {
          status.replaceChildren(document.createTextNode(words.owned));
          /* Polling observed the webhook's grant — the hosted-mode
           * counterpart of the mock confirm's fulfilled announcement. */
          paymentEvent('fulfilled', { sku: item.sku });
          return;
        }
        await sleep(POLL_INTERVAL_MS);
      }
      status.replaceChildren(document.createTextNode(`${words.slow} `));
      const retry = element('button', 'neon-retry', words.retry);
      retry.addEventListener('click', () => { polling = false; pollEntitlements().catch(error => { status.textContent = error.message; }); });
      status.append(retry);
    } finally {
      polling = false;
    }
  }

  function renderRefundFlow() {
    const flow = element('div', 'neon-flow');
    const steps = [
      label('Refund requested from this page', '이 화면에서 환불 요청'),
      label('Server asks Neon (item-level) → 201 refund created', '서버가 Neon에 item 단위 요청 → 201 환불 생성'),
      label('Signed refund.processed webhook arrives', '서명된 refund.processed 웹훅 도착'),
      label('Ledger revokes the entitlement', '원장이 권리를 회수'),
      label('Owned disappears — buyable again', 'Owned가 사라지고 다시 구매 가능'),
    ];
    const list = element('ol', 'neon-flow-steps');
    steps.forEach((text, index) => {
      const stage = index + 1;
      const li = element('li', null, text);
      li.dataset.state = refundFlow.error && stage > refundFlow.stage ? 'fail'
        : stage <= refundFlow.stage ? 'done'
          : stage === refundFlow.stage + 1 ? 'run' : 'wait';
      list.append(li);
    });
    flow.append(element('b', null, `${refundFlow.name}`), list);
    if (refundFlow.error) flow.append(element('p', 'neon-flow-error', refundFlow.error));
    if (refundFlow.stage >= 5) flow.append(element('p', 'neon-flow-done', label('Revoked by the webhook — the castle lost the decoration and the item is buyable again.', '웹훅으로 회수 완료 — 성에서 장식이 사라지고 다시 구매할 수 있습니다.')));
    const code = element('details', 'neon-flow-code');
    code.append(element('summary', null, label('The code this ran', '방금 실행된 코드')));
    for (const key of ['refundRequest', 'refund']) {
      const excerpt = EXCERPTS[key];
      code.append(element('code', null, `${excerpt.file}:${excerpt.line}`), element('pre', null, excerpt.code));
    }
    flow.append(code);
    return flow;
  }

  async function startRealRefund(item) {
    refundFlow = { sku: item.sku, name: item.name, stage: 0, error: null };
    render();
    try {
      await postJson('/api/store/refund', { sku: item.sku });
      refundFlow.stage = 2;                       // Request accepted; Neon created the refund.
      render();
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await sleep(POLL_INTERVAL_MS);
        await refreshEntitlements();
        if (!owns(item)) {
          refundFlow.stage = 5;                   // Webhook landed and the ledger revoked.
          paymentEvent('refunded', { sku: item.sku });
          render();
          return;
        }
      }
      refundFlow.error = label('Still owned — the refund webhook has not arrived yet. Reopen the store to check again.', '아직 보유 중입니다 — 환불 웹훅이 아직 도착하지 않았습니다. 상점을 다시 열어 확인하세요.');
    } catch (error) {
      refundFlow.error = words[error.message] || error.message;
    }
    render();
  }

  async function startCheckout(item) {
    status.textContent = '';
    selectedSku = item.sku;
    /* returnPath lets the server rebuild this page's address for the
     * post-payment redirect (a Pages project site lives under a path the
     * Origin header cannot carry), including view parameters like the
     * spectate demo and inspector so the return resumes the same mode.
     * The server validates both parts; it re-appends lang/api itself. */
    const keep = new URLSearchParams(location.search);
    for (const drop of ['purchase', 'reference', 'sku', 'api', 'lang']) keep.delete(drop);
    const query = keep.toString();
    const returnPath = location.pathname + (query ? `?${query}` : '');
    const data = await postJson('/api/store/checkout', { sku: item.sku, locale, returnPath });
    if (catalog.checkoutMode === 'mock') {
      const reference = new URL(data.redirectUrl).searchParams.get('reference');
      if (!reference) throw new Error('Missing mock checkout reference');
      pending = { reference, item };
      lastReference = reference;
      paymentEvent('checkout', { sku: item.sku });
      status.textContent = label('Checkout created. No entitlement until you confirm.', '결제 생성 완료. 확인 전에는 지급되지 않습니다.');
    } else {
      /* Announce the created intent before leaving so the inspector can
       * caption stage 3 on the hosted path too. */
      paymentEvent('checkout', { sku: item.sku });
      location.assign(data.redirectUrl);
    }
  }

  async function boot() {
    try {
      await loadCatalog();
      onPreview(modal.querySelector('#neonCastlePreview'));
      button.classList.remove('hidden');
      await refreshEntitlements();
      const params = new URLSearchParams(location.search);
      const outcome = params.get('purchase');
      selectedSku = params.get('sku') || catalog.items[0]?.sku;
      if (outcome === 'mock' && params.get('reference')) {
        await postJson('/api/store/mock-complete', { reference: params.get('reference') });
      }
      if (outcome === 'cancelled') status.textContent = label('Checkout cancelled. No item granted by the return URL.', '결제가 취소되었습니다. 복귀 주소로 지급되지 않습니다.');
      if (params.get('store') === '1') modal.classList.remove('hidden');
      if (outcome === 'mock' || outcome === 'return') {
        modal.classList.remove('hidden');
        params.delete('purchase');
        params.delete('reference');
        params.delete('sku');
        history.replaceState({}, '', `${location.pathname}?${params}${location.hash}`);
        await pollEntitlements();
      }
    } catch {
      /* Hide the unavailable store on static-only deployments such as GitHub Pages. */
      button.classList.add('hidden');
      status.textContent = words.error;
    }
  }
  boot();

  /* Expose store controls to the inspector so demonstration actions use the same UI and request paths. */
  return {
    open: () => { modal.classList.remove('hidden'); paymentEvent('store'); },
    close: () => modal.classList.add('hidden'),
    isOpen: () => !modal.classList.contains('hidden'),
    refresh: () => refreshEntitlements().catch(() => {}),
  };
}
