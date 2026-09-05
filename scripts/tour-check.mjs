/* 안내 투어가 조용히 깨지지 않도록 지킨다.
 *
 * 이 투어는 면접관이 문서 없이 보는 화면이다. 번역 한 줄이 빠지거나 패널의 id
 * 하나가 바뀌면 설명이 사라지는데, 게임은 멀쩡히 돌기 때문에 눈치채기 어렵다.
 * 그래서 두 언어의 대칭성과 DOM 계약을 여기서 확인한다. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/neontour.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');

/* 모듈은 DOM 을 만지므로 Node 에서 import 할 수 없다. 대신 TEXT 표만 떼어
 * 평가한다 — 검사하려는 것이 문구의 대칭성이지 렌더링이 아니기 때문.
 * 끝은 주석이 아니라 표 자체의 닫는 괄호로 찾는다: 주석은 옮겨지지만
 * 최상위에서 열 없이 붙은 `};` 는 표의 끝일 수밖에 없다. */
const start = source.indexOf('const TEXT = {');
const end = source.indexOf('\n};\n', start);
if (start < 0 || end < 0) { console.error('TEXT 표를 찾지 못했습니다'); process.exit(1); }
const table = source.slice(start, end + 3);
const TEXT = new Function(`${table}; return TEXT;`)();

const locales = Object.keys(TEXT);
assert.deepEqual(locales.sort(), ['en', 'ko'], '투어는 게임과 같은 두 언어를 지원한다');

const [ko, en] = [TEXT.ko, TEXT.en];
assert.equal(ko.steps.length, en.steps.length, '두 언어의 단계 수가 같다');
assert.ok(ko.steps.length >= 8, '설명이 흐름을 담을 만큼은 있다');

for (const locale of locales) {
  const text = TEXT[locale];
  text.steps.forEach(([title, body, live], index) => {
    assert.ok(title && title.trim(), `${locale} ${index + 1}단계에 제목이 있다`);
    assert.ok(body && body.trim().length > 40, `${locale} ${index + 1}단계 설명이 비어 있지 않다`);
    if (live !== undefined) assert.ok(String(live).trim(), `${locale} ${index + 1}단계 라이브 문구가 비어 있지 않다`);
  });
  for (const key of ['codes', 'architecture']) {
    assert.ok(Array.isArray(text[key]) && text[key].length, `${locale} 에 ${key} 도식이 있다`);
    for (const row of text[key]) assert.equal(row.length, 3, `${key} 항목은 라벨·값·설명 세 칸`);
  }
  for (const key of ['prev', 'next', 'pause', 'resume', 'exit']) {
    assert.ok(text.controls[key], `${locale} 조작 버튼 문구 ${key}`);
  }
  assert.equal(typeof text.needServer, 'function', `${locale} 는 서버가 없을 때의 안내를 갖는다`);
}

/* 모듈이 찾는 id 가 실제로 문서에 있어야 한다. 하나라도 없으면 투어가 통째로
 * 뜨지 않거나 빈 칸이 남는다. */
for (const id of ['neonTour', 'tourStep', 'tourTitle', 'tourBody', 'tourLive', 'tourDiagram',
  'tourPrev', 'tourNext', 'tourPause', 'tourExit']) {
  assert.ok(source.includes(`#${id}`), `모듈이 #${id} 를 참조한다`);
  assert.match(html, new RegExp(`id="${id}"`), `index.html 에 #${id} 가 있다`);
}

/* 해설자는 하나다 — 투어가 켜지면 관전 자막은 숨는다. */
assert.match(css, /body\.tour-on #demoBar\s*\{\s*display:\s*none/, '투어 중에는 관전 자막을 숨긴다');
assert.match(css, /#neonTour\s*\{/, '투어 패널 스타일이 있다');

/* 투어는 실제 코드 경로를 지나야 의미가 있다. 지급과 회수 모두 서버를 부른다. */
for (const endpoint of ['/api/store/catalog', '/api/store/market', '/api/store/checkout',
  '/api/store/mock-complete', '/api/store/mock-refund', '/api/store/entitlements']) {
  assert.ok(source.includes(endpoint), `투어가 ${endpoint} 를 실제로 호출한다`);
}
/* 면접관은 새로고침한다 — 시작할 때 자기 상태를 되돌리지 않으면 두 번째
 * 실행이 이중청구 방지에 막혀 결제 단계에서 멈춘다. */
assert.match(source, /resetOwnState/, '투어는 시작 전에 자기가 만든 보유 상태를 되돌린다');

console.log(`tour check: ${ko.steps.length}단계 × ${locales.length}개 언어 · DOM 계약 · 실제 호출 경로 통과`);
