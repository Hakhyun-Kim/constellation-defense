import { observePayments } from './neon-events.js';
import { EXCERPTS } from './neon-excerpts.generated.js';

// An observer, not a second checkout implementation. Every purchase uses the store.
export function initNeonTour(ctx) {
  const root = document.querySelector('#neonTour');
  if (!root) return;
  const en = ctx.locale === 'en';
  const text = (english, korean) => en ? english : korean;
  const get = id => root.querySelector(`#${id}`);
  const events = [];
  let lastPhase;
  let closed = false;
  document.body.classList.add('tour-on');
  root.classList.remove('hidden');
  get('tourTitle').textContent = text('From defense to delivery', '방어에서 지급까지');
  get('tourBody').textContent = text('Play a defense, then give your castle a new identity. Defeat opens the store; cosmetics never improve your odds. You control every purchase and refund.', '방어를 플레이한 뒤 성을 꾸며 보세요. 패배하면 상점이 열립니다. 장식은 승률을 바꾸지 않으며 모든 구매와 환불은 직접 조작합니다.');
  get('tourPlay').textContent = text('Play / retry a defense', '방어 플레이 / 재도전');
  get('tourRisk').textContent = text('Risky defense (new run)', '위험한 방어 (새 게임)');
  get('tourShop').textContent = text('Explore cosmetics', '장식 살펴보기');
  get('tourExport').textContent = text('Export redacted evidence', '민감정보 제외 기록 저장');
  get('tourExit').textContent = text('Close inspector', '설명 닫기');
  get('tourCodeLabel').textContent = text('Actual source · built from this checkout', '실제 소스 · 현재 빌드에서 추출');
  get('tourTraceLabel').textContent = text('Live HTTP evidence', '실시간 HTTP 기록');
  get('tourBoundary').textContent = text('Game → SKU + locale → Payment API → Neon Hosted → signed webhook → ledger → castle. The return URL grants nothing. Mock confirmation bypasses the hosted page and signature, but uses the same ledger.', '게임 → SKU·언어 → 결제 API → Neon 호스팅 → 서명 웹훅 → 원장 → 성. 복귀 URL은 지급하지 않습니다. 모의 확인은 호스팅·서명을 생략하고 같은 원장을 사용합니다.');
  function showCode(key) {
    const entry = EXCERPTS[key];
    get('tourSource').textContent = `${entry.file}:${entry.line}`;
    get('tourCode').textContent = entry.code;
  }
  for (const [key, caption] of [['checkout', 'Checkout'], ['hosted', 'Neon adapter'], ['fulfill', 'Fulfillment'], ['refund', 'Refund'], ['visuals', '3D delivery']]) {
    const button = document.createElement('button');
    button.textContent = caption;
    button.addEventListener('click', () => showCode(key));
    get('tourCodeTabs').append(button);
  }
  showCode('checkout');
  function stage(number, message, code) {
    get('tourStep').textContent = `${number} / 5`;
    get('tourTask').textContent = message;
    if (code) showCode(code);
  }
  stage(1, text('1. Play, or open the shop whenever you are ready.', '1. 플레이하거나 준비되면 상점을 여세요.'));
  get('tourPlay').addEventListener('click', () => { ctx.closeStore(); ctx.play(); });
  get('tourRisk').addEventListener('click', () => { ctx.closeStore(); ctx.riskyDefense(); stage(1, text('Both heroes defend the left. Watch the exposed lanes at 2× speed, or intervene with tactics. This uses normal movement and damage rules.', '두 영웅이 왼쪽만 방어합니다. 2배속으로 지켜보거나 전술로 개입하세요. 일반 이동·피해 규칙을 사용합니다.')); });
  get('tourShop').addEventListener('click', () => ctx.openStore());
  const unsubscribe = observePayments(event => {
    if (event.type === 'request') {
      events.push({ at: new Date().toISOString(), ...event });
      if (events.length > 40) events.shift();
      get('tourLive').textContent = events.slice(-3).map(({ method, path, status, request, response }) =>
        `${method} ${path} → ${status}\n${JSON.stringify({ request, response }, null, 2)}`).join('\n\n');
    }
    if (event.type === 'store') stage(2, text('2. Choose one of three decorations. Prices come from the server.', '2. 세 가지 장식 중 선택하세요. 가격은 서버 값입니다.'), 'checkout');
    if (event.type === 'checkout') stage(3, text('3. Checkout exists, but nothing is owned. Leave it pending, cancel, or confirm in the store.', '3. 결제는 생성됐지만 보유하지 않습니다. 상점에서 대기·취소·확인하세요.'), 'fulfill');
    if (event.type === 'fulfilled') stage(4, text('4. Close the store: the castle now wears your purchase. Buy more to combine decorations.', '4. 상점을 닫고 성을 확인하세요. 장식을 추가 구매해 함께 표시할 수 있습니다.'), 'visuals');
    if (event.type === 'refunded') stage(5, text('5. One decoration removed. Others stay. Rebuy it to repeat the lifecycle.', '5. 선택한 장식만 제거됐습니다. 재구매해 수명주기를 반복하세요.'), 'refund');
  });
  const clock = setInterval(() => {
    const state = ctx.stage.snapshot();
    get('tourGame').textContent = text(`Live game · wave ${state.wave} · castle ${Math.ceil(state.hp)}/${state.maxHp} · ${state.phase}`, `실제 게임 · 웨이브 ${state.wave} · 성 ${Math.ceil(state.hp)}/${state.maxHp} · ${state.phase}`);
    if (state.phase === 'over' && lastPhase !== 'over') {
      ctx.openStore();
      stage(2, text('Defense lost. A fresh look for the next attempt? These purchases are cosmetic, not a cure for defeat.', '방어에 실패했습니다. 다음 도전에 새 장식을 써 볼까요? 구매로 전투가 쉬워지지는 않습니다.'), 'checkout');
    }
    lastPhase = state.phase;
  }, 500);
  get('tourExport').addEventListener('click', () => {
    const report = { mode: 'observed-client-evidence', note: 'HTTP responses observed in this browser; not proof of a real payment or a signed webhook.', events };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'checkout-evidence.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  function close() {
    if (closed) return;
    closed = true; unsubscribe(); clearInterval(clock);
    root.classList.add('hidden'); document.body.classList.remove('tour-on');
  }
  get('tourExit').addEventListener('click', close);
  window.addEventListener('pagehide', close, { once: true });
  return { close };
}
