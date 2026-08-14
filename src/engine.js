/* =====================================================
 * 게임 엔진 (순수 로직, DOM/렌더링 없음) — 모듈 허브
 * 모든 소비자(main/ui/bot/scripts)는 이 파일 하나만 import 한다.
 *   engine/state.js    상태 생성 · 저장/불러오기
 *   engine/champion.js 별지기 능력치/성장/스킬
 *   engine/roster.js   용사 소환/조합/배치/판매/잔치
 *   engine/economy.js  성 업그레이드
 *   engine/effects.js  피해 · 상태 이상 공통 규칙
 *   engine/combat.js   웨이브 생성 · 전투 틱 · 별지기 마법
 *   engine/tactics.js  퍼즐 입력을 모르는 방어선 전술 해소
 * ===================================================== */
export * from './engine/state.js';
export * from './engine/champion.js';
export * from './engine/squad.js';
export * from './engine/hero-actives.js';
export * from './engine/blueprints.js';
export * from './engine/constellation-aid.js';
export * from './engine/journey.js';
export * from './engine/roster.js';
export * from './engine/economy.js';
export * from './engine/resonance.js';
export * from './engine/combat.js';
export * from './engine/tactics.js';
export * from './engine/run-memory.js';
