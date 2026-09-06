import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SUPPORTED_LOCALES,
  normalizeLocale,
  setLocale,
  translateKnownText,
  translationEntries,
} from '../src/app/i18n.js';
import { BEATS, beat } from '../src/story.js';

assert.deepEqual(SUPPORTED_LOCALES, ['ko', 'en']);
assert.equal(normalizeLocale('en-US'), 'en');
assert.equal(normalizeLocale('ko-KR'), 'ko');
assert.equal(normalizeLocale('unknown'), 'ko');
assert.equal(setLocale('en'), 'en');
assert.equal(translateKnownText('설정'), 'Settings');
assert.equal(translateKnownText('⚙️ 설정'), '⚙️ Settings');
assert.equal(translateKnownText('  푸른 초원  '), '  Verdant Meadow  ');
assert.equal(translateKnownText('▶ 7웨이브 시작!'), '▶ Start Wave 7!');
assert.equal(translateKnownText('설정', 'ko'), '설정');

/* Village and journey screens are rendered from Korean templates and localized
 * through this dictionary, so they are asserted here rather than in the UI tests. */
assert.equal(translateKnownText('시설을 방문하거나 지도에서 다음 별길로 출발하세요.'),
  'Visit a facility, or set out on the next star road from the map.');
assert.equal(translateKnownText('☾ 별빛 신전 근처입니다. Enter 또는 대화 버튼을 누르세요.'),
  '☾ Near Starlight Temple. Press Enter or the talk button.');
assert.equal(translateKnownText('☾ 별빛 신전 방문'), '☾ Visit Starlight Temple');
assert.equal(translateKnownText('🏹 세라 영입하기'), '🏹 Recruit Sera');
assert.equal(translateKnownText('세라와 대화'), 'Talk with Sera');
assert.equal(translateKnownText('치명타 +12% · Flare +8% · 포인트 1 · 0/2'), 'Crit +12% · Flare +8% · 1 point · 0/2');
assert.equal(translateKnownText('마도사의 별자리 전문화를 엽니다. 전투에서 얻은 전문화 포인트는 이곳에서만 사용합니다.'),
  'Opens constellation specializations for mages. Specialization points earned in battle are spent only here.');
assert.equal(translateKnownText('보물 · 보급 +80'), 'Treasure · Supply +80');
assert.equal(translateKnownText('갈림길 마을 3D 광장'), 'Crossroads Village 3D plaza');
assert.equal(translateKnownText('👥 구조 12명'), '👥 12 rescued');
assert.equal(translateKnownText('여명의 성도 완수'), 'Pilgrimage of Dawn complete');
assert.equal(translateKnownText('봉합 엔딩'), 'Sealing Ending');
assert.equal(translateKnownText('⌁ 누구의 설명을 기록할까'), '⌁ Whose account will you record?');
assert.equal(translateKnownText('여백 주석 01'), 'Margin Note 01');
assert.equal(translateKnownText('보스 · 방어 1/5'), 'Boss · Defense 1/5');
assert.equal(translateKnownText(' · ⚔️ 보통 난이도 · 🧍 용사 3명'), ' · ⚔️ Normal difficulty · 🧍 3 heroes');
assert.equal(translateKnownText('3개 수집'), '3 collected');
/* The village 3D scene draws its labels into canvas textures, which the DOM
 * observer cannot reach; gfx/village.js must translate them at creation. */
const villageScene = fs.readFileSync(new URL('../src/gfx/village.js', import.meta.url), 'utf8');
assert.match(villageScene, /import \{ translateKnownText \} from '\.\.\/app\/i18n\.js'/);
assert.match(villageScene, /const text = translateKnownText\(source\)/);
for (const sign of ['별무기 대장간', '별빛 신전', '탐험가 길드', '아린 · 수호단장']) {
  assert.ok(villageScene.includes(sign), `village scene still names ${sign}`);
  assert.notEqual(translateKnownText(sign), sign, `${sign} has an English sprite label`);
}

const entries = translationEntries();
assert.ok(entries.length >= 120, 'critical demo catalog has broad Korean/English coverage');
assert.equal(new Set(entries.map(([source]) => source)).size, entries.length, 'source phrases are unique');
assert.ok(entries.every(([source, target]) => source.trim() && target.trim()), 'translations are non-empty');

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(html, /id="settingsLanguage"/);
assert.match(html, /<option value="ko">한국어<\/option>/);
assert.match(html, /<option value="en">English<\/option>/);
assert.equal(beat('prologue', 'en').title, 'The Book Read You First');
assert.equal(beat('prologue', 'ko'), BEATS.prologue);
assert.doesNotMatch(JSON.stringify(BEATS), /수학|계산 문제|셈을/);

console.log(`✅ ko/en locale normalization, ${entries.length} critical translations, village/journey screens, patterns, and language selector passed.`);
