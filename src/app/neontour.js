/* 안내 투어 — 게임 화면만 보고 결제 통합을 이해할 수 있게 한다.
 *
 * 문서를 읽지 않고, 영상을 따로 틀지 않고, 게임이 자동으로 도는 동안 옆 패널이
 * 무엇이 만들어졌는지 설명한다. 설명만 하면 슬라이드와 다를 게 없으므로, 각
 * 단계는 가능한 한 실제 요청을 보내고 그 응답을 그대로 보여준다 — 화면의 숫자는
 * 전부 방금 서버가 준 값이다.
 *
 * 두 가지가 이 파일의 형태를 정했다.
 *  · 볼 사람이 한국어 화자라는 보장이 없다. 그래서 게임과 같은 ko/en 두 벌.
 *  · 면접관은 새로고침한다. 그래서 투어는 시작할 때 자기 상태를 되돌린다 —
 *    안 그러면 두 번째 실행에서 이중청구 방지에 막혀 4단계부터 멈춘다. */

const STEP_MS = 8000;
const BANNER = 'cosmetic.celestial_banner';

async function api(path, options) {
  const token = (() => { try { return localStorage.getItem('cd_neon_player'); } catch { return null; } })();
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options?.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

const post = (path, payload) => api(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
});

const pretty = (value) => JSON.stringify(value, null, 2);

const TEXT = {
  ko: {
    controls: { prev: '◀', next: '▶', pause: '⏸ 멈춤', resume: '▶ 계속', exit: '✕' },
    needServer: (message) => `이 단계는 로컬 서버가 필요합니다 (npm run serve) — ${message}`,
    noIntent: '결제 의도가 없습니다 — 앞 단계를 먼저 실행하세요.',
    sameCode: '같은 상품, 같은 코드. 자릿수는 통화가 정합니다.',
    steps: [
      ['이 게임에 Neon 결제를 붙였습니다',
        '이미 만들어 배포한 3D 게임입니다. 서버가 전혀 없던 정적 빌드에, 결제만을 위한 첫 서버 권한 영역을 더했습니다. 뒤에서 도는 전투는 봇이 사람과 같은 조작으로 실제 플레이하는 화면입니다.',
        '판매 품목: 별빛 개척자 깃발 — 전투 능력에 영향 없는 영구 치장품'],
      ['가격은 서버가 정합니다',
        '상점을 열면 클라이언트는 카탈로그를 받아옵니다. 가격·통화·청구 국가가 전부 서버 응답에 들어 있습니다. 청구 국가는 게임 언어가 아니라 명시적 선택·지리 헤더·브라우저 지역 순으로 서버가 정합니다 — 이 투어는 한국 시장을 보여주려고 KR을 명시적으로 고릅니다.'],
      ['₩4,900이 490000으로 나갑니다',
        'Neon은 가격을 통화 기본 단위의 100배 정수로 받습니다. 원화는 보조 단위가 없어서 이 숫자가 한국 개발자 눈에는 100배 오류처럼 보입니다. 배수는 상수 표 한 곳에만 두고, 표시 문자열은 Intl로 파생시킵니다 — 손으로 적지 않습니다.'],
      ['클라이언트가 보내는 것은 SKU와 언어뿐입니다',
        '구매를 누르면 이 본문이 서버로 갑니다. 가격도, 통화도, 국가도 없습니다. 서버가 허용 목록에서 값을 붙이고, 비밀 키로 Neon을 호출하고, 플레이어가 떠나기 전에 결제 의도를 원장에 기록합니다.'],
      ['실제로는 여기서 Neon 결제 화면으로 갑니다',
        '샌드박스에서 확인한 결제 수단은 카드 · Google Pay · Samsung Pay · Kakao Pay · Naver Pay 였습니다. 페이지는 languageLocale로 보낸 ko-KR을 따라 한국어로 뜨고, 총계는 ₩4,900에 부가세 ₩445가 포함됩니다. 이 투어는 서버를 떠나지 않는 모의 모드로 돕니다.',
        '실거래 2건 완료 — orderNumber 9BKP-47RY-KJLL (네이버페이), 29QS-Y3S5-VW7H (카드)'],
      ['돌아온 리다이렉트는 아무 권한이 없습니다',
        'Neon 문서가 명시합니다 — 플레이어가 successUrl에 도착하는 것이 웹훅보다 빠를 수 있습니다. 그래서 리다이렉트는 모달을 열고 폴링을 시작할 뿐이고, 지급은 서명이 검증된 웹훅만 합니다. 주소창에 ?purchase=return을 직접 쳐도 아무 일도 일어나지 않습니다.',
        '지급 경로는 하나뿐입니다: purchase.completed + x-neon-digest (HMAC-SHA256)'],
      ['웹훅이 지급합니다',
        '서명을 원문 그대로 검증하고, 기록해 둔 결제 의도와 계정·SKU·수량·금액을 대조한 뒤에야 권리를 씁니다. 지금 이 투어에서도 같은 함수(repository.fulfill)를 지나갑니다.'],
      ['같은 이벤트가 두 번 와도 한 번만 줍니다',
        'Neon은 2xx가 아닌 응답을 최대 36시간 재시도합니다. 그래서 재시도로 절대 풀리지 않는 경우 — 모르는 참조, 처리하지 않는 이벤트 종류, 환경 불일치, 금액·계정 불일치 — 는 사유를 로그에 남기고 200으로 받습니다. 서명 실패만 403으로 남깁니다. 그건 설정 오류라서 조용하면 안 됩니다.'],
      ['환불하면 회수합니다',
        '환불 이벤트는 externalReferenceId가 비어 올 수 있어서 purchaseId로 결제 의도를 되찾습니다. 권리는 지우고 구매 기록은 남깁니다 — 환불하면 사라지는 감사 기록은 감사 기록이 아닙니다.'],
      ['서버는 클라이언트 종류를 가리지 않습니다',
        '결제 API는 게임 파일과 분리된 독립 서비스입니다. 신원은 쿠키보다 Bearer 토큰을 먼저 봅니다 — Unity·Unreal에는 쿠키 항아리가 없고, 게임이 CDN에 있으면 SameSite 때문에 쿠키가 끊기기 때문입니다. 그래서 웹·게임 클라이언트·런처가 같은 이 주소를 봅니다.'],
    ],
    codes: [
      ['서명 실패', '403', '설정 오류 — 시끄러워야 한다'],
      ['재시도로 못 푸는 경우', '200 ignored', '사유를 로그에 남기고 삼킨다'],
      ['저장 실패', '5xx', '재시도가 실제로 도움이 된다'],
      ['정상 지급', '200', '멱등 — 두 번 와도 한 번'],
    ],
    architecture: [
      ['게임 클라이언트', '웹 · Unity · Unreal', 'SKU와 언어만 보낸다'],
      ['결제 서비스', 'server/index.mjs', '가격 · 국가 · 권리 · 비밀 키'],
      ['원장', 'repository.mjs', '멱등성 · 의도 대조 · 트랜잭션'],
      ['Neon', 'POST /checkout · 웹훅', '호스팅 결제 · 서명된 이벤트'],
    ],
  },
  en: {
    controls: { prev: '◀', next: '▶', pause: '⏸ Pause', resume: '▶ Resume', exit: '✕' },
    needServer: (message) => `This step needs the local server (npm run serve) — ${message}`,
    noIntent: 'No checkout intent yet — run the earlier step first.',
    sameCode: 'Same product, same code. The currency decides the decimals.',
    steps: [
      ['A Neon checkout, added to a shipped game',
        'This 3D game was already built and published as a static bundle with no server at all. The checkout adds its first server-authoritative surface. The battle running behind this panel is a bot playing for real, through the same inputs a person uses.',
        'For sale: Celestial Pioneer Banner — a permanent cosmetic with no gameplay effect'],
      ['The server decides the price',
        'Opening the store fetches a catalogue. Price, currency and billing country all come from the server. Billing country is never taken from the game language: it is an explicit choice, then a platform geo header, then the browser region. This tour picks KR explicitly to show the Korean market.'],
      ['₩4,900 travels as 490000',
        'Neon takes prices as integers, 100× the base unit of the currency. The won has no subunit, so that number looks like a 100×-off bug to every Korean engineer who reads it. The multiplier lives in one frozen table and the display string is derived with Intl — never typed by hand.'],
      ['The client sends a SKU and a language. Nothing else.',
        'Pressing buy sends this body. No price, no currency, no country. The server looks the SKU up in an allowlist, calls Neon with the secret key, and records the intent in the ledger before the player leaves.'],
      ['In production this is where Neon’s hosted page opens',
        'The payment methods confirmed in the sandbox were card, Google Pay, Samsung Pay, Kakao Pay and Naver Pay. The page renders in Korean because we sent languageLocale ko-KR, and the total shows ₩4,900 with ₩445 of tax included. This tour runs in mock mode and never leaves the server.',
        'Two real sandbox purchases — orderNumber 9BKP-47RY-KJLL (Naver Pay), 29QS-Y3S5-VW7H (card)'],
      ['The redirect back grants nothing',
        'Neon’s documentation is explicit: the player can reach successUrl before the webhook arrives. So the redirect only opens this modal and starts polling, and the entitlement is written by a verified webhook alone. Typing ?purchase=return by hand gets you a spinner.',
        'One path can grant: purchase.completed with x-neon-digest (HMAC-SHA256)'],
      ['The webhook is what grants',
        'The signature is verified over the raw body, then the account, SKU, quantity and amount are matched against the recorded intent before anything is written. This tour goes through the same function — repository.fulfill.'],
      ['Delivered twice, granted once',
        'Neon retries any non-2xx response for up to 36 hours. So anything a retry could never fix — an unknown reference, an event type we do not handle, an environment mismatch, a wrong amount or account — is answered 200 with the reason logged. Only a bad signature gets a 403, because that is a misconfiguration and it should be noisy.'],
      ['A refund takes the item back',
        'Refund events can arrive with externalReferenceId null, so the checkout is found by purchaseId instead. The entitlement is removed and the purchase record is kept — an audit trail that disappears on refund is not an audit trail.'],
      ['The server does not care what kind of client is calling',
        'The payment API is a service of its own, separate from the game files. Identity reads a bearer token before falling back to a cookie, because Unity and Unreal have no cookie jar and a game on a CDN loses cookies to SameSite. Web, game client and launcher all reach the same address.'],
    ],
    codes: [
      ['Bad signature', '403', 'a misconfiguration — stay noisy'],
      ['A retry cannot fix it', '200 ignored', 'swallowed, with the reason logged'],
      ['Storage failed', '5xx', 'a retry genuinely helps'],
      ['Granted', '200', 'idempotent — twice in, once out'],
    ],
    architecture: [
      ['Game client', 'web · Unity · Unreal', 'sends a SKU and a language'],
      ['Payment service', 'server/index.mjs', 'price · country · entitlements · secret key'],
      ['Ledger', 'repository.mjs', 'idempotency · intent matching · transactions'],
      ['Neon', 'POST /checkout · webhooks', 'hosted checkout · signed events'],
    ],
  },
};

/* 각 단계는 설명과, 화면에 띄울 "방금 실제로 일어난 일"을 함께 만든다.
 * run() 이 반환하는 문자열이 라이브 패널에 그대로 붙는다. */
function buildSteps(ctx, text) {
  const [s0, s1, s2, s3, s4, s5, s6, s7, s8, s9] = text.steps;
  const card = ([title, body, live]) => ({ title, body, live: live ? () => live : undefined });

  return [
    card(s0),
    {
      ...card(s1),
      run: async () => {
        ctx.openStore();
        await post('/api/store/market', { country: 'KR' });
        const { data } = await api('/api/store/catalog?locale=' + ctx.locale);
        ctx.refreshStore();
        return pretty({
          playerId: data.playerId,
          price: data.items?.[0]?.price,
          displayPrice: data.items?.[0]?.displayPrice,
          currency: data.currency,
          country: data.country,
        });
      },
    },
    {
      ...card(s2),
      /* 같은 카탈로그를 두 시장으로 불러 온다. 통화별 자릿수까지 서버가
       * 파생시킨다는 것을 나란히 놓고 보여주기 위해서다. */
      run: async () => {
        await post('/api/store/market', { country: 'US' });
        const us = await api('/api/store/catalog?locale=' + ctx.locale);
        await post('/api/store/market', { country: 'KR' });
        const kr = await api('/api/store/catalog?locale=' + ctx.locale);
        ctx.refreshStore();
        const line = (r) => `${r.data.country}  price ${String(r.data.items[0].price).padStart(6)}  →  ${r.data.items[0].displayPrice}`;
        return `${line(kr)}\n${line(us)}\n\n${text.sameCode}`;
      },
    },
    {
      ...card(s3),
      run: async () => {
        const { status, data } = await post('/api/store/checkout', { sku: 'CELESTIAL_BANNER', locale: ctx.locale });
        ctx.redirectUrl = data.redirectUrl || '';
        ctx.reference = new URLSearchParams(ctx.redirectUrl.split('?')[1] || '').get('reference');
        const sent = pretty({ sku: 'CELESTIAL_BANNER', locale: ctx.locale });
        return `→ ${sent}\n← ${status} ${ctx.reference ? 'redirectUrl issued' : pretty(data)}`;
      },
    },
    card(s4),
    card(s5),
    {
      ...card(s6),
      run: async () => {
        if (!ctx.reference) return text.noIntent;
        await post('/api/store/mock-complete', { reference: ctx.reference });
        const { data } = await api('/api/store/entitlements');
        ctx.refreshStore();
        return pretty(data.entitlements);
      },
    },
    { ...card(s7), diagram: 'codes' },
    {
      ...card(s8),
      run: async () => {
        if (!ctx.reference) return text.noIntent;
        const { data } = await post('/api/store/mock-refund', { reference: ctx.reference });
        const after = await api('/api/store/entitlements');
        ctx.refreshStore();
        return `${pretty(data)}\n\n${pretty(after.data.entitlements)}`;
      },
    },
    { ...card(s9), diagram: 'architecture' },
  ];
}

export function initNeonTour({ locale = 'ko', openStore, closeStore, refreshStore } = {}) {
  const panel = document.querySelector('#neonTour');
  if (!panel) return null;

  const text = TEXT[locale === 'en' ? 'en' : 'ko'];
  const titleEl = panel.querySelector('#tourTitle');
  const bodyEl = panel.querySelector('#tourBody');
  const liveEl = panel.querySelector('#tourLive');
  const diagramEl = panel.querySelector('#tourDiagram');
  const stepEl = panel.querySelector('#tourStep');
  const pauseBtn = panel.querySelector('#tourPause');
  const nextBtn = panel.querySelector('#tourNext');
  const prevBtn = panel.querySelector('#tourPrev');
  const exitBtn = panel.querySelector('#tourExit');

  const ctx = {
    locale,
    openStore: openStore || (() => {}),
    closeStore: closeStore || (() => {}),
    refreshStore: refreshStore || (() => {}),
  };
  const script = buildSteps(ctx, text);
  let index = -1;
  let timer = 0;
  let paused = false;
  /* show() 는 비동기다. 자동 진행과 사람의 클릭이 겹치면 늦게 끝난 단계가
   * 다음 단계의 라이브 칸을 덮어쓸 수 있어, 자기 차례인지 확인하고 그린다. */
  let ticket = 0;

  prevBtn.textContent = text.controls.prev;
  nextBtn.textContent = text.controls.next;
  pauseBtn.textContent = text.controls.pause;
  exitBtn.textContent = text.controls.exit;

  function renderDiagram(kind) {
    diagramEl.replaceChildren();
    diagramEl.classList.toggle('hidden', !kind);
    if (!kind) return;
    for (const [label, value, note] of text[kind]) {
      const box = document.createElement('div');
      box.className = 'tour-box';
      const strong = document.createElement('b');
      strong.textContent = label;
      const code = document.createElement('code');
      code.textContent = value;
      const small = document.createElement('small');
      small.textContent = note;
      box.append(strong, code, small);
      diagramEl.append(box);
    }
  }

  async function show(next) {
    const mine = ++ticket;
    index = (next + script.length) % script.length;
    const step = script[index];
    stepEl.textContent = `${index + 1} / ${script.length}`;
    titleEl.textContent = step.title;
    bodyEl.textContent = step.body;
    renderDiagram(step.diagram);
    liveEl.textContent = '';
    liveEl.classList.add('hidden');
    let live = '';
    try {
      live = step.run ? await step.run() : (step.live ? step.live() : '');
    } catch (error) {
      /* 서버 없이 열린 경우(정적 배포)에는 라이브 단계가 실패한다. 투어를
       * 멈추지 않고, 왜 비어 있는지만 말한다. */
      live = text.needServer(error.message);
    }
    if (mine !== ticket) return;
    if (live) {
      liveEl.textContent = live;
      liveEl.classList.remove('hidden');
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (paused) return;
    timer = setTimeout(() => { show(index + 1).then(schedule); }, STEP_MS);
  }

  const go = (next) => { show(next).then(schedule); };

  prevBtn.addEventListener('click', () => go(index - 1));
  nextBtn.addEventListener('click', () => go(index + 1));
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? text.controls.resume : text.controls.pause;
    if (paused) clearTimeout(timer); else schedule();
  });
  exitBtn.addEventListener('click', () => {
    clearTimeout(timer);
    ticket += 1;
    panel.classList.add('hidden');
    document.body.classList.remove('tour-on');
  });

  /* 면접관은 새로고침한다. 이미 보유한 상태로 다시 시작하면 이중청구 방지가
   * 4단계를 막으므로, 투어는 시작 전에 자기가 만든 상태를 되돌린다. 되돌리는
   * 것도 실제 회수 경로를 지난다 — 데모용 지름길이 아니다. */
  async function resetOwnState() {
    try {
      const { data } = await api('/api/store/entitlements');
      if (!data.entitlements?.[BANNER]) return;
      const purchaseId = data.entitlements[BANNER].purchaseId;
      const reference = String(purchaseId || '').replace(/^mock-purchase-/, '');
      if (reference && reference !== purchaseId) await post('/api/store/mock-refund', { reference });
      ctx.refreshStore();
    } catch { /* 서버가 없으면 되돌릴 상태도 없다 */ }
  }

  panel.classList.remove('hidden');
  document.body.classList.add('tour-on');
  resetOwnState().then(() => go(0));
  return { next: () => go(index + 1), stop: () => { clearTimeout(timer); ticket += 1; } };
}
