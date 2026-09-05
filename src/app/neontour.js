/* 안내 투어 — 게임 화면만 보고 결제 통합을 이해할 수 있게 한다.
 *
 * 구성이 "게임 설명 + 결제 설명"이 아니라 "판이 무너진 뒤의 결제 수명 전체"인
 * 이유: 결제 회사가 보고 싶은 것은 잘 되는 한 번이 아니라 잘못될 수 있는
 * 모든 경우다. 그래서 앞은 짧게 몰아붙여 끝내고, 뒤에서 위조 서명·재전송·
 * 이중 구매·환불·환불 뒤 뒤늦은 지급을 하나씩 실제로 던져 본다.
 *
 * 각 단계는 진짜 요청을 보내고 응답을 그대로 찍는다. 화면의 값은 전부 방금
 * 서버가 준 것이고, 지급과 회수는 서명된 웹훅이 지나는 같은 함수를 지난다.
 *
 * 파는 물건이 치장품이라는 점은 일부러 짚는다. 판이 무너진 직후는 힘을 파는
 * 자리이기 쉬운데, 여기서 파는 것은 전투에 영향이 없고 그래서 지급 여부를
 * 눈으로 증명할 수 있다. */

const DEFAULT_MS = 8000;
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
const line = (status, body) => `← ${status}  ${typeof body === 'string' ? body : pretty(body)}`;

const TEXT = {
  ko: {
    controls: { prev: '◀', next: '▶', pause: '⏸ 멈춤', resume: '▶ 계속', exit: '✕' },
    needServer: (message) => `이 단계는 로컬 서버가 필요합니다 (npm run serve) — ${message}`,
    noIntent: '결제 의도가 없습니다 — 앞 단계를 먼저 실행하세요.',
    sameCode: '같은 상품, 같은 코드. 자릿수는 통화가 정합니다.',
    steps: [
      ['판이 어려워집니다',
        '이미 만들어 배포한 3D 게임입니다. 봇이 사람과 같은 조작으로 실제 플레이하고 있고, 지금 후반 웨이브로 밀어 보스가 섞인 편성을 부릅니다.'],
      ['성이 무너졌습니다',
        '여기가 대부분의 게임이 힘을 파는 자리입니다. 이 게임이 파는 것은 전투에 아무 영향이 없는 치장품이고, 그래서 지급됐는지 아닌지를 눈으로 증명할 수 있습니다 — 화폐 묶음이었다면 "지급이 됐는가"와 "경제에 반영됐는가"가 뒤섞입니다.'],
      ['가격은 서버가 정합니다',
        '상점을 열면 카탈로그를 받아옵니다. 가격·통화·청구 국가가 전부 서버 응답에 있습니다. 청구 국가는 게임 언어가 아니라 명시적 선택·지리 헤더·브라우저 지역 순으로 서버가 정합니다.'],
      ['₩4,900이 490000으로 나갑니다',
        'Neon은 가격을 기본 단위의 100배 정수로 받습니다. 원화는 보조 단위가 없어 이 숫자가 100배 오류처럼 보입니다. 배수는 상수 표 한 곳에만 두고 표시 문자열은 Intl로 파생시킵니다.'],
      ['클라이언트가 보내는 것은 SKU와 언어뿐입니다',
        '가격도, 통화도, 국가도 보내지 않습니다. 서버가 허용 목록에서 값을 붙이고, 비밀 키로 Neon을 호출하고, 플레이어가 떠나기 전에 결제 의도를 원장에 기록합니다.'],
      ['① 위조된 웹훅 — 403',
        '웹훅 주소는 인터넷에 열려 있습니다. 누구나 던질 수 있으니, 서명이 유일한 문지기입니다. 지금 브라우저에서 가짜 서명으로 직접 던져 보겠습니다.'],
      ['② 진짜 지급',
        '서명을 원문 그대로 검증하고, 기록해 둔 결제 의도와 계정·SKU·수량·금액을 대조한 뒤에야 권리를 씁니다.'],
      ['구매는 기기가 아니라 계정에 붙습니다',
        '지금까지 신원은 브라우저 하나에 묶인 소지자 자격이었습니다 — 기기를 바꾸면 산 것이 따라오지 않습니다. 인계 코드가 그걸 옮깁니다. 쿠키도 토큰도 없는 기기가 코드를 넣고 권리를 물려받는 것을 지금 보겠습니다.'],
      ['③ 같은 이벤트가 또 오면',
        'Neon은 2xx가 아닌 응답을 최대 36시간 재시도합니다. 재전송은 오류가 아니라 정상 트래픽이라, 같은 이벤트 id는 한 번만 지급됩니다.'],
      ['④ 이미 가진 것을 또 사려 하면 — 409',
        '상점 버튼은 비활성이지만 UI는 신뢰 경계 밖입니다. 영구 아이템을 두 번 파는 것은 플레이어를 두 번 청구하는 일이라 API가 직접 막습니다.'],
      ['⑤ 환불 — 회수',
        '환불 이벤트는 externalReferenceId가 비어 올 수 있어 purchaseId로 결제 의도를 되찾습니다. 권리는 지우고 구매 기록은 남깁니다.'],
      ['⑥ 환불 뒤 뒤늦게 도착한 지급',
        '웹훅 순서는 보장되지 않습니다. 환불된 결제에 지급 이벤트가 뒤늦게 닿으면 회수가 되살아나므로, 결제 의도가 pending이 아니면 거절합니다.'],
      ['서버는 클라이언트 종류를 가리지 않습니다',
        '결제 API는 게임 파일과 분리된 독립 서비스입니다. 신원은 쿠키보다 Bearer 토큰을 먼저 봅니다 — Unity·Unreal에는 쿠키 항아리가 없고, 게임이 CDN에 있으면 SameSite 때문에 쿠키가 끊깁니다.'],
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
      ['The run gets hard',
        'A 3D game that was already built and published. A bot is playing it for real, through the same inputs a person uses — and the tour has just pushed the run into late waves, where bosses join the formation.'],
      ['The citadel falls',
        'This is the moment most games sell power. What this one sells is a cosmetic with no effect on combat, which is exactly why fulfillment is provable by eye — a currency pack would blur "did the grant land" with "did the economy apply it".'],
      ['The server decides the price',
        'Opening the store fetches a catalogue. Price, currency and billing country all come from the server. Billing country is never the game language: an explicit choice, then a platform geo header, then the browser region.'],
      ['₩4,900 travels as 490000',
        'Neon takes prices as integers, 100× the base unit. The won has no subunit, so that number reads like a 100×-off bug. The multiplier lives in one frozen table and the display string is derived with Intl.'],
      ['The client sends a SKU and a language. Nothing else.',
        'No price, no currency, no country. The server looks the SKU up in an allowlist, calls Neon with the secret key, and records the intent in the ledger before the player leaves.'],
      ['① A forged webhook — 403',
        'The webhook endpoint is open to the internet; anyone can post to it, so the signature is the only gatekeeper. Watch the browser post one with a fake digest right now.'],
      ['② The real grant',
        'The signature is verified over the raw body, then account, SKU, quantity and amount are matched against the recorded intent before anything is written.'],
      ['The purchase belongs to an account, not this device',
        'Identity used to be a bearer credential bound to one browser — change device and the purchase does not follow. A transfer code moves it, the way Korean and Japanese mobile games have always done it. Watch a device with no cookie and no token claim the code and inherit the entitlement.'],
      ['③ The same event, delivered again',
        'Neon retries any non-2xx for up to 36 hours, so redelivery is ordinary traffic rather than an error. The same event id grants exactly once.'],
      ['④ Buying what you already own — 409',
        'The store button is disabled, but the button is on the far side of the trust boundary. Selling a permanent item twice means charging the player twice, so the API refuses it directly.'],
      ['⑤ Refund — the item comes back',
        'Refund events can arrive with externalReferenceId null, so the checkout is found by purchaseId. The entitlement is removed and the purchase record is kept.'],
      ['⑥ A grant arriving after the refund',
        'Webhook ordering is not guaranteed. A purchase event landing after a refund would resurrect what was revoked, so any checkout that is no longer pending is refused.'],
      ['The server does not care what kind of client is calling',
        'The payment API is a service of its own, separate from the game files. Identity reads a bearer token before falling back to a cookie, because Unity and Unreal have no cookie jar and a game on a CDN loses cookies to SameSite.'],
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

function buildSteps(ctx, text) {
  const s = text.steps;
  const card = ([title, body]) => ({ title, body });

  return [
    {
      ...card(s[0]),
      ms: 6000,
      run: async () => {
        ctx.stage.hurry(24);
        return `wave → ${ctx.stage.wave()}`;
      },
    },
    {
      ...card(s[1]),
      ms: 6000,
      run: async () => { ctx.stage.fall(); return 'GAME OVER'; },
    },
    {
      ...card(s[2]),
      run: async () => {
        ctx.openStore();
        await post('/api/store/market', { country: 'KR' });
        const { data } = await api(`/api/store/catalog?locale=${ctx.locale}`);
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
      ...card(s[3]),
      run: async () => {
        await post('/api/store/market', { country: 'US' });
        const us = await api(`/api/store/catalog?locale=${ctx.locale}`);
        await post('/api/store/market', { country: 'KR' });
        const kr = await api(`/api/store/catalog?locale=${ctx.locale}`);
        ctx.refreshStore();
        const row = (r) => `${r.data.country}  price ${String(r.data.items[0].price).padStart(6)}  →  ${r.data.items[0].displayPrice}`;
        return `${row(kr)}\n${row(us)}\n\n${text.sameCode}`;
      },
    },
    {
      ...card(s[4]),
      run: async () => {
        const { status, data } = await post('/api/store/checkout', { sku: 'CELESTIAL_BANNER', locale: ctx.locale });
        ctx.redirectUrl = data.redirectUrl || '';
        ctx.reference = new URLSearchParams(ctx.redirectUrl.split('?')[1] || '').get('reference');
        return `→ ${pretty({ sku: 'CELESTIAL_BANNER', locale: ctx.locale })}\n${line(status, ctx.reference ? 'redirectUrl issued' : data)}`;
      },
    },
    {
      ...card(s[5]),
      /* 브라우저에는 웹훅 시크릿이 없다 — 그게 요점이다. 가짜 서명은 누구나
       * 만들 수 있고, 서버는 그걸 알아본다. */
      run: async () => {
        const forged = await api('/api/webhooks/neon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-neon-digest': 'deadbeef' },
          body: JSON.stringify({ type: 'purchase.completed', version: 2, isSandbox: true }),
        });
        return `→ x-neon-digest: deadbeef\n${line(forged.status, forged.data)}`;
      },
    },
    {
      ...card(s[6]),
      run: async () => {
        if (!ctx.reference) return text.noIntent;
        const granted = await post('/api/store/mock-complete', { reference: ctx.reference });
        const owned = await api('/api/store/entitlements');
        ctx.refreshStore();
        return `${line(granted.status, granted.data)}\n\n${pretty(owned.data.entitlements)}`;
      },
    },
    {
      ...card(s[7]),
      /* credentials:'omit' 이 곧 "다른 기기"다 — 쿠키도 토큰도 실리지 않는다. */
      run: async () => {
        const issued = await post('/api/account/transfer-code', {});
        const code = issued.data.code;
        const strangerBefore = await fetch('/api/store/entitlements', { credentials: 'omit' }).then((r) => r.json());
        const claimed = await fetch('/api/account/claim', {
          method: 'POST', credentials: 'omit',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
        }).then((r) => r.json());
        const strangerAfter = await fetch('/api/store/entitlements', {
          credentials: 'omit', headers: { Authorization: `Bearer ${claimed.accountId}` },
        }).then((r) => r.json());
        return [
          `code    ${code}`,
          `before  ${JSON.stringify(strangerBefore.entitlements)}   (new device)`,
          `after   ${JSON.stringify(Object.keys(strangerAfter.entitlements))}`,
        ].join('\n');
      },
    },
    {
      ...card(s[8]),
      run: async () => {
        if (!ctx.reference) return text.noIntent;
        const again = await post('/api/store/mock-complete', { reference: ctx.reference });
        const owned = await api('/api/store/entitlements');
        return `${line(again.status, again.data)}\n\npurchases: ${Object.keys(owned.data.entitlements).length}`;
      },
      diagram: 'codes',
    },
    {
      ...card(s[9]),
      run: async () => {
        const blocked = await post('/api/store/checkout', { sku: 'CELESTIAL_BANNER', locale: ctx.locale });
        return line(blocked.status, blocked.data);
      },
    },
    {
      ...card(s[10]),
      run: async () => {
        if (!ctx.reference) return text.noIntent;
        const refund = await post('/api/store/mock-refund', { reference: ctx.reference });
        const after = await api('/api/store/entitlements');
        ctx.refreshStore();
        return `${line(refund.status, refund.data)}\n\n${pretty(after.data.entitlements)}`;
      },
    },
    {
      ...card(s[11]),
      /* distinct: 같은 이벤트의 재전송이 아니라 "다른 지급 이벤트"로 보낸다.
       * 재전송이면 멱등성 원장이 먼저 잡아 버려서, 정작 보여주려는 방어선
       * (환불된 결제 의도는 지급하지 않는다)을 지나가지 못한다. */
      run: async () => {
        if (!ctx.reference) return text.noIntent;
        const late = await post('/api/store/mock-complete', { reference: ctx.reference, distinct: true });
        const owned = await api('/api/store/entitlements');
        return `${line(late.status, late.data)}\n\n${pretty(owned.data.entitlements)}`;
      },
    },
    { ...card(s[12]), diagram: 'architecture' },
  ];
}

export function initNeonTour({ locale = 'ko', openStore, closeStore, refreshStore, stage } = {}) {
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

  const noop = () => {};
  const ctx = {
    locale,
    openStore: openStore || noop,
    closeStore: closeStore || noop,
    refreshStore: refreshStore || noop,
    stage: { hurry: noop, fall: noop, wave: () => 0, ...(stage || {}) },
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
      live = step.run ? await step.run() : '';
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
    timer = setTimeout(() => { show(index + 1).then(schedule); }, script[index]?.ms || DEFAULT_MS);
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
   * 결제 단계를 막으므로, 투어는 시작 전에 자기가 만든 상태를 되돌린다.
   * 되돌리는 것도 실제 회수 경로를 지난다 — 데모용 지름길이 아니다. */
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
