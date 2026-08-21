/* =====================================================
 * 데모 모드 — AI가 게임을 실제로 플레이하는 것을 구경한다
 *
 * dungeon100의 시연은 하드코딩된 각본이지만, 이 게임은 이미
 * 밸런스 봇이라는 "제대로 판단하는 뇌"를 갖고 있다. 그래서 데모는
 * 각본을 따르지 않고 **봇의 판단(src/bot.js)을 그대로 써서 진짜로 논다.**
 * 덕분에 각본을 유지보수할 필요가 없고, 게임이 바뀌면 데모도 따라 바뀐다.
 *
 * 조작은 전부 사람이 쓰는 경로로 흘린다(doSummon·doPlace·combine·tacticSwap…).
 * 데모 전용 지름길을 만들면 데모에서만 되는 버그가 생긴다.
 * ===================================================== */
import * as Bot from './bot.js';
import { laneForGroup } from './tactics/board.js';

const TACTIC_LABEL = { flare: '유성', tide: '서리', bloom: '수호' };
const LANE_LABEL = ['왼쪽', '가운데', '오른쪽'];

/* Video-ready opening cards.  They explain the real loop before the bot takes
 * control, so a submitted recording remains understandable without voiceover. */
export const DEMO_TOUR = Object.freeze([
  Object.freeze({ duration: 2.6, text: 'CONSTELLATION DEFENSE · 실시간 방어와 별자리 퍼즐이 한 전장에서 이어집니다' }),
  Object.freeze({ duration: 2.8, text: '① 별을 누르거나 밀어 3개를 연결하면, 색에 맞는 영웅 전술이 선택한 길에 발동됩니다' }),
  Object.freeze({ duration: 2.8, text: '② 4·5매치는 영웅 액티브를 빠르게 충전하고, 완성한 성좌는 보스전까지 저장할 수 있습니다' }),
]);

/* 관전자는 봇의 실제 판단을 읽을 수 있어야 한다. 이 함수는 이미 고른 합법 스왑을
 * 설명할 뿐, 점수나 결과를 바꾸지 않는다. */
export function describeTacticMove(move) {
  const group = move.groups?.[0];
  if (!group) return '🌌 별자리를 이어 전술을 준비합니다';
  const kind = move.cells[group[0]];
  const lane = laneForGroup(group);
  const extra = move.groups.length > 1 ? ` + ${move.groups.length - 1}연쇄` : '';
  return `🌌 ${LANE_LABEL[lane]} 길 · ${TACTIC_LABEL[kind] || '별자리'} ${group.length}매치${extra}`;
}

/* 사람이 보기 좋은 속도. 너무 빠르면 뭘 하는지 안 보이고, 느리면 지루하다 */
const PACE = {
  prep: 0.55,        // 준비 단계 행동 사이 (초)
  tactic: 0.45,      // 전술 스왑 뒤 다음 판단까지
  afterWave: 1.2,    // 웨이브를 깬 뒤 숨 고르기
  restart: 12.0,     // 회고와 공유 카드를 읽은 뒤 다시 시작할 시간
};

export const demo = {
  active: false,
  profileName: '고수',
  t: 0,              // 다음 행동까지 남은 시간
  midT: 0,           // 전투 중 판단 주기
  api: null,
  caption: '',
  overSeen: false,
  tourIndex: -1,
  tourT: 0,

  /* main.js가 자기 함수들을 넘겨 준다 — 데모는 게임 내부를 직접 만지지 않는다 */
  attach(api) { this.api = api; },

  /* 링크로 공유될 때 한글이 인코딩돼 깨질 수 있으니 영문 별칭도 받는다 */
  resolveProfile(name) {
    if (!name) return null;
    if (Bot.PROFILES[name]) return name;
    const alias = { novice: '초보', beginner: '초보', easy: '초보',
                    normal: '보통', mid: '보통',
                    expert: '고수', pro: '고수', hard: '고수' };
    return alias[String(name).toLowerCase()] || null;
  },

  start(profileName) {
    if (!this.api) return false;
    const p = this.resolveProfile(profileName);
    if (p) this.profileName = p;
    this.active = true;
    this.t = 0.6;
    this.midT = 0;
    this.overSeen = false;
    this.tourIndex = 0;
    this.tourT = DEMO_TOUR[0].duration;
    this.api.onStart(this.profileName, Bot.PROFILES[this.profileName]);
    this.say(DEMO_TOUR[0].text);
    return true;
  },

  stop() {
    if (!this.active) return;
    this.active = false;
    this.tourIndex = -1;
    this.tourT = 0;
    this.api.onStop();
  },

  toggle(profileName) { this.active ? this.stop() : this.start(profileName); },

  say(text) {
    this.caption = text;
    if (this.api) this.api.onCaption(text);
  },

  /* 매 프레임 호출된다. */
  step(dt) {
    if (!this.active || !this.api) return;
    const A = this.api;
    const state = A.getState();
    const P = Bot.PROFILES[this.profileName];
    this.t -= dt;

    /* The explanatory opening behaves like subtitles over the live engine.
     * Gameplay starts only after the viewer has had time to read each card. */
    if (this.tourIndex >= 0) {
      this.tourT -= dt;
      if (this.tourT <= 0) {
        this.tourIndex++;
        if (this.tourIndex >= DEMO_TOUR.length) {
          this.tourIndex = -1;
          this.t = .6;
          this.say(`🎬 ${this.profileName} 플레이어의 실제 규칙 자동 플레이를 시작합니다`);
        } else {
          const scene = DEMO_TOUR[this.tourIndex];
          this.tourT = scene.duration;
          this.say(scene.text);
        }
      }
      return;
    }

    /* ① 막간 이야기가 떠 있으면 읽고 넘긴다 (이야기가 열려 있으면 웨이브가 시작되지 않는다) */
    if (A.isStoryOpen()) {
      if (this.t <= 0) { A.closeStory(); this.t = 0.5; }
      return;
    }
    /* ② 전설·신화 연출은 스스로 닫히므로 기다리기만 한다 */
    if (A.isRevealOpen()) return;

    /* ③ 게임오버 — 잠깐 보여 주고 새 판 */
    if (state.phase === 'over') {
      if (!this.overSeen) {
        this.overSeen = true;
        this.t = PACE.restart;
        this.say(`🎬 ${state.wave}웨이브 수호의 기억 — 결과를 확인해 보세요`);
        return;
      }
      if (this.t <= 0) {
        this.say(`🎬 ${state.wave}웨이브에서 성이 무너졌어요 — 다시 시작합니다`);
        A.newGame();
        this.overSeen = false;
        this.t = 1.0;
      }
      return;
    }
    this.overSeen = false;

    /* ④ 준비 단계 — 봇의 판단을 하나씩 소비한다 */
    if (state.phase === 'journey') {
      if (this.t > 0) return;
      if (state.journey?.complete) {
        if (A.journeyNext?.()) this.say('▤ 원정의 성장과 기록을 지닌 채 다음 장을 펼칩니다');
        else {
          const ending = Bot.nextJourneyEnding(state);
          if (ending && A.journeyEnding?.(ending)) this.say('✎ 영웅과 몬스터가 함께 쓰는 결말을 선택합니다');
        }
      } else if (state.journey?.pendingRecruit) {
        const key = Bot.nextJourneyRecruit(state);
        if (key) {
          this.say(`✦ ${key} 영웅을 원정대에 맞이합니다`);
          A.journeyRecruit(key);
        }
      } else {
        const path = Bot.nextJourneyPath(state);
        if (path) {
          this.say(`${path.icon} ${path.name}의 설명을 따릅니다`);
          A.journeyPath?.(path.key);
          this.t = 1.05;
          return;
        }
        const heroSkill = Bot.nextJourneyHeroSkill(state);
        if (heroSkill) {
          this.doAction({ type: 'heroSkill', ...heroSkill }, state);
        } else {
          const node = Bot.nextJourneyNode(state);
          if (node) {
            this.say(`🧭 ${node.name}(으)로 별길을 따라갑니다`);
            A.journeyTravel(node.id);
          }
        }
      }
      this.t = 1.05;
      return;
    }

    if (state.phase === 'prep') {
      if (this.t > 0) return;
      const act = Bot.nextPrepAction(state, P, state.rng || Math.random);
      if (!act) {
        this.say(`⚔️ ${state.wave}웨이브 시작!`);
        A.startWave();
        this.t = 0.8;
        return;
      }
      this.doAction(act, state);
      this.t = PACE.prep;
      return;
    }

    /* ⑤ 전투 중 — 실제 전술 스왑 + 별지기 마법 + 여유 골드로 소환·배치 */
    this.midT -= dt;
    if (this.midT <= 0) {
      this.midT = 2;
      const move = Bot.chooseTacticSwap(state, A.getTacticBoard(), P, state.rng || Math.random);
      if (move) {
        this.say(describeTacticMove(move));
        A.tacticSwap(move.from, move.to);
        this.t = PACE.tactic;
        return;
      }
      /* 별지기 마법 — 봇과 같은 판단 (bot.js) */
      if (Bot.wantsUlt(state, P)) {
        this.say('🌌 은하수! 하늘의 별을 전부 쏟아붓습니다');
        A.ult();
        return;
      }
      if (Bot.wantsStar(state, P)) {
        this.say('☄️ 별똥별로 지원 사격!');
        A.spell();
        return;
      }
      const blueprint = Bot.nextMonsterBlueprint(state, P, state.rng || Math.random);
      if (blueprint) {
        this.say(`${blueprint.spec.emoji} ${blueprint.spec.summonName}, ${['왼쪽', '가운데', '오른쪽'][blueprint.route]} 길 지원!`);
        A.monsterBlueprint();
        return;
      }
      const heroActive = Bot.nextHeroActive(state, P, state.rng || Math.random);
      if (heroActive) {
        this.say(`${heroActive.spec.emoji} ${heroActive.hero.name} · ${heroActive.spec.name}!`);
        A.heroActive(heroActive.heroId);
        return;
      }
      const act = Bot.midWaveAction(state, P);
      if (act) this.doAction(act, state);
      else {
        const h = Bot.benchOrder(state)[0];
        if (h) {
          const pad = Bot.pickPad(state, h, P.sloppy || 0, state.rng || Math.random);
          if (pad != null) this.doAction({ type: 'place', heroId: h.id, pad, hero: h }, state);
        }
      }
    }
  },

  doAction(act, state) {
    const A = this.api;
    switch (act.type) {
      case 'summon':
        this.say('🎲 용사를 소환합니다');
        A.summon();
        break;
      case 'combine': {
        const name = A.comboLabel(act.combo);
        this.say(`⚗️ ${name} 조합을 실행합니다`);
        A.combine(act.action);
        break;
      }
      case 'place':
        this.say(`📍 ${A.heroLabel(act.hero)}를 좋은 자리에 배치`);
        A.place(act.heroId, act.pad);
        break;
      case 'castle':
        this.say(`🏰 성을 강화합니다 (${act.key})`);
        A.castle(act.key);
        break;
      case 'skill':
        this.say(`✨ 별지기의 별자리를 잇습니다 — [${act.skill.name}]`);
        A.skill(act.key);
        break;
      case 'heroSkill':
        this.say(`✦ ${A.heroLabel(act.hero)} specialization: ${act.skill.name}`);
        A.heroSkill(act.heroId, act.key);
        break;
      case 'feast':
        this.say('🎉 남는 골드로 잔치를 벌입니다 — 누가 승급할까요?');
        A.feast();
        break;
    }
  },
};
