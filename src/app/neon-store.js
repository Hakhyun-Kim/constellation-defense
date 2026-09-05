/* Neon 체크아웃 클라이언트.
 *
 * 이 파일은 아무것도 "지급"하지 않는다 — 결제 후 돌아온 리다이렉트는 UI 신호일
 * 뿐이고, 소유 여부는 항상 서버에 물어본다. 주소창에 ?purchase=return 을 직접
 * 쳐 넣어도 아무 일도 일어나지 않아야 한다. */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const POLL_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 1500;
const BANNER_ENTITLEMENT = 'cosmetic.celestial_banner';
const TOKEN_KEY = 'cd_neon_player';

/* API 가 다른 도메인에 있을 수 있다 — 게임을 정적 호스팅에 두고 결제 API 만
 * 따로 두는 구성이 흔하다. 비어 있으면 같은 오리진을 쓴다. */
const API_BASE = (document.querySelector('meta[name="neon-api-base"]')?.content || '').replace(/\/$/, '');

/* 신원 토큰. 같은 오리진이면 서버가 쿠키로도 알아보지만, 교차 오리진이나
 * 네이티브 클라이언트에서는 이것만 동작한다 — 그래서 항상 같이 보낸다. */
function playerToken() {
  try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}

function rememberPlayer(id) {
  try { if (id) localStorage.setItem(TOKEN_KEY, id); } catch { /* 사생활 보호 모드 — 쿠키로 버틴다 */ }
}

async function request(path, options = {}) {
  const token = playerToken();
  const headers = { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: API_BASE ? 'omit' : 'same-origin',
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Store request failed (${response.status})`);
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
  /* 상품명·소개는 서버가 준 값이다. 지금은 서버 상수라 안전하지만 결제 화면에
   * innerHTML을 쓰지 않는 규칙을 여기서부터 지킨다. */
  if (text !== undefined) node.textContent = text;
  return node;
}

export function initNeonStore({ locale = 'ko' } = {}) {
  const button = document.querySelector('#neonStoreBtn');
  const modal = document.querySelector('#neonStoreModal');
  if (!button || !modal) return;
  const title = modal.querySelector('#neonStoreTitle');
  const product = modal.querySelector('#neonProduct');
  const status = modal.querySelector('#neonStoreStatus');
  const close = modal.querySelector('#neonStoreClose');
  const words = copy(locale);
  let catalog = null;
  let owned = false;
  let polling = false;

  title.textContent = `✦ ${words.title}`;
  close.textContent = words.close;
  close.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.classList.add('hidden'); });
  button.addEventListener('click', () => modal.classList.remove('hidden'));

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
    /* 국가는 여기서만 바뀐다 — 게임 언어를 바꾼다고 청구 국가가 따라가면
     * 세금과 결제수단이 틀어진다. 서버도 언어에서 국가를 유추하지 않는다. */
    select.addEventListener('change', async () => {
      try {
        await postJson('/api/store/market', { country: select.value });
        await loadCatalog();
      } catch (error) { status.textContent = error.message; }
    });
    row.append(select);
    return row;
  }

  /* 계정 인계. 이 통합의 가장 정직한 약점이 "신원이 기기에 묶여 있다"였고,
   * 여기가 그것을 계정으로 옮기는 자리다. 코드는 발급 순간 한 번만 보인다. */
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
      /* prompt 를 쓰는 이유: 이 데모에서 필요한 것은 코드가 계정을 옮긴다는
       * 사실이지 입력 폼의 완성도가 아니다. 실제 타이틀이라면 화면이 따로 있다. */
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

  function render() {
    if (!catalog) return;
    const item = catalog.items[0];
    product.replaceChildren();
    const art = element('div', 'neon-product-art', '🚩');
    art.setAttribute('aria-hidden', 'true');
    const body = element('div', 'neon-product-copy');
    body.append(element('b', null, item.name), element('small', null, item.subtitle), element('em', null, words.cosmetic));
    if (catalog.checkoutMode === 'mock') body.append(element('em', 'neon-mock', words.mock));
    const buy = element('button', 'big amber', owned ? words.owned : `${words.buy} · ${item.displayPrice}`);
    buy.id = 'neonBuyBtn';
    buy.disabled = owned;
    buy.addEventListener('click', startCheckout);
    product.append(art, body, buy);
    const region = renderRegion();
    if (region) product.append(region);
    product.append(renderAccount());
    document.querySelector('#paidCosmeticBadge')?.classList.toggle('hidden', !owned);
  }

  async function refreshEntitlements() {
    const data = await request('/api/store/entitlements');
    owned = Boolean(data.entitlements?.[BANNER_ENTITLEMENT]);
    render();
    return owned;
  }

  async function loadCatalog() {
    catalog = await request(`/api/store/catalog?locale=${locale}`);
    rememberPlayer(catalog.playerId);
    render();
  }

  /* 리다이렉트가 웹훅보다 먼저 도착할 수 있다고 Neon 문서가 명시한다. 그래서
   * 돌아온 뒤에는 기다리며 물어보고, 그래도 늦으면 사라지지 말고 다시 확인할
   * 방법을 남긴다 — 지급 자체는 이미 서버에 안전하게 기록돼 있다. */
  async function pollEntitlements() {
    if (polling) return;
    polling = true;
    status.textContent = words.pending;
    try {
      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
        if (await refreshEntitlements()) {
          status.replaceChildren(document.createTextNode(words.owned));
          return;
        }
        await sleep(POLL_INTERVAL_MS);
      }
      status.replaceChildren(document.createTextNode(`${words.slow} `));
      const retry = element('button', 'neon-retry', words.retry);
      retry.addEventListener('click', () => { polling = false; pollEntitlements(); });
      status.append(retry);
    } finally {
      polling = false;
    }
  }

  async function startCheckout() {
    status.textContent = '';
    try {
      /* 서버로 보내는 것은 SKU와 표시 언어뿐이다. 가격도, 국가도 보내지 않는다. */
      const data = await postJson('/api/store/checkout', { sku: catalog.items[0].sku, locale });
      location.assign(data.redirectUrl);
    } catch (error) { status.textContent = words[error.message] || error.message; }
  }

  async function boot() {
    try {
      await loadCatalog();
      button.classList.remove('hidden');
      await refreshEntitlements();
      const params = new URLSearchParams(location.search);
      const outcome = params.get('purchase');
      if (outcome === 'mock' && params.get('reference')) {
        await postJson('/api/store/mock-complete', { reference: params.get('reference') });
      }
      if (params.get('store') === '1') modal.classList.remove('hidden');
      if (outcome === 'mock' || outcome === 'return') {
        modal.classList.remove('hidden');
        params.delete('purchase');
        params.delete('reference');
        history.replaceState({}, '', `${location.pathname}?${params}${location.hash}`);
        await pollEntitlements();
      }
    } catch {
      /* 서버가 없는 정적 배포(GitHub Pages)에서는 상점이 조용히 사라진다. */
      button.classList.add('hidden');
      status.textContent = words.error;
    }
  }
  boot();

  /* 안내 투어가 상점을 실제로 조작할 수 있게 손잡이를 넘긴다 — 투어가
   * 설명만 하지 않고 같은 코드 경로를 지나게 하기 위해서다. */
  return {
    open: () => modal.classList.remove('hidden'),
    close: () => modal.classList.add('hidden'),
    refresh: () => refreshEntitlements().catch(() => {}),
  };
}
