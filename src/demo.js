/* The live demo reuses src/bot.js decisions rather than maintaining a scripted game. Execute every action through normal player command paths so the demo remains representative as rules change. */
import * as Bot from './bot.js';
import { findLegalSwaps, laneForGroup, tacticSizeForGroup } from './tactics/board.js';

const TACTIC_LABEL = { flare: '유성', tide: '서리', bloom: '수호' };
const TACTIC_EFFECT = { flare: '집중 피해', tide: '길 전체 감속', bloom: '성 회복·적 후퇴' };
const TACTIC_HERO = { flare: '아린·세라', tide: '루나·유나', bloom: '도윤' };
const LANE_LABEL = ['왼쪽', '가운데', '오른쪽'];
const HERO_LABEL = { arin: '아린', luna: '루나', doyun: '도윤', sera: '세라', yuna: '유나' };

/* The shared live-demo URL should show the same teachable opening every time.
 * Seed 3 starts with a legal T-shaped Hero Sigil opportunity; it is still
 * completed through the normal adjacent-swap and engine command paths. */
export const DEMO_SEED = 3;

/* Two-line opening cards make the live link understandable without voiceover.
 * They stay short because the useful evidence is the real play that follows. */
export const DEMO_TOUR = Object.freeze([
  Object.freeze({ duration: 2.5, tone: 'guide', title: '🎬 CONSTELLATION DEFENSE · 보드가 곧 전장입니다', detail: '3D 방어는 멈추지 않습니다. 오른쪽 별자리판을 실시간으로 바꿔 세 길에 명령합니다.' }),
  Object.freeze({ duration: 2.6, tone: 'guide', title: '① 위치가 길을, 색이 명령을 고릅니다', detail: '왼쪽·가운데·오른쪽 열은 방어로를, Flare·Tide·Bloom은 피해·감속·회복을 정합니다.' }),
  Object.freeze({ duration: 2.6, tone: 'guide', title: '② 퍼즐은 영웅 기술의 충전 장치입니다', detail: '매치 색과 연결된 아린·루나·도윤·세라·유나의 액티브가 더 빨리 돌아옵니다.' }),
  Object.freeze({ duration: 2.8, tone: 'sigil', title: '③ ㄱ·T·십자 5칸 = HERO SIGIL', detail: '영웅 액티브 8초 충전 · 강화 전술 · 보스까지 아껴 쓸 성좌 수호자 3/3을 한 번에 완성합니다.' }),
]);

export const DEMO_GUIDES = Object.freeze({
  journey: Object.freeze({ duration: 3.6, tone: 'guide', title: '🧭 같은 영웅단이 별자리 원정을 계속합니다', detail: '전투 사이에는 길과 마을을 고르고, 동료 영입과 전문화 선택을 다음 방어까지 이어 갑니다.' }),
  prep: Object.freeze({ duration: 3.4, tone: 'guide', title: '🛡 전투 전 준비도 짧고 의미 있게', detail: '고정 영웅단의 위치·전문화·성 강화를 정한 뒤 카운트다운이 다음 방어를 자동 시작합니다.' }),
  battle: Object.freeze({ duration: 3.4, tone: 'guide', title: '⚔ 실시간 방어 시작 · 퍼즐 중에도 적은 전진합니다', detail: '가장 위험한 길을 읽고, 그 순간 필요한 색과 문양을 선택해야 합니다.' }),
  firstTactic: Object.freeze({ duration: 3.8, tone: 'guide', title: '🌌 실제 인접 스왑이 전장 명령으로 이어졌습니다', detail: '열의 평균 위치가 대상 길을 정하고, 맞춘 별의 색과 개수가 효과를 정합니다.' }),
  heroSigil: Object.freeze({ duration: 4.8, tone: 'sigil', title: '✦ HERO SIGIL · 영웅 성좌 문양 완성!', detail: '실제 합법 스왑으로 가로·세로 3칸이 교차했습니다. 액티브 -8초 · 성좌 수호자 즉시 3/3.' }),
  heroActive: Object.freeze({ duration: 4.0, tone: 'hero', title: '⚡ 퍼즐과 연결된 영웅 액티브를 사용합니다', detail: '매치는 남은 쿨다운을 되돌립니다. 준비된 고유 기술은 전투를 멈추지 않고 아래 퀵바에서 즉시 사용합니다.' }),
  guardian: Object.freeze({ duration: 4.4, tone: 'sigil', title: '✦ 저장해 둔 성좌 수호자를 지금 호출합니다', detail: '큰 매치의 보상은 즉시 소모되지 않습니다. 보스나 무너지는 길을 기다렸다 집중 지원합니다.' }),
  waveFlow: Object.freeze({ duration: 4.0, tone: 'guide', title: 'VICTORY · 다음 방어까지 긴장을 이어 갑니다', detail: '짧은 승리 확인과 눈에 보이는 카운트다운 뒤, 같은 지역의 다음 방어가 자동으로 시작됩니다.' }),
  boss: Object.freeze({ duration: 4.4, tone: 'boss', title: '🐉 라이브 액터 보스 컷인', detail: '컷인 속 모델이 그대로 전장에 진입합니다. 모아 둔 문양·영웅 액티브·성좌 지원을 겹쳐 쓸 순간입니다.' }),
});

/* Explain an already-selected legal swap without changing its score or result. */
export function describeTacticMove(move) {
  const group = move.groups?.find(candidate => tacticSizeForGroup(candidate) === 6) || move.groups?.[0];
  if (!group) return '🌌 별자리를 이어 전술을 준비합니다';
  const kind = move.cells[group[0]];
  const lane = laneForGroup(group);
  const extra = move.groups.length > 1 ? ` + ${move.groups.length - 1}연쇄` : '';
  const match = tacticSizeForGroup(group) === 6 ? '영웅 성좌 문양' : `${group.length}매치`;
  return `🌌 ${LANE_LABEL[lane]} 길 · ${TACTIC_LABEL[kind] || '별자리'} ${match}${extra}`;
}

export function describeTacticDetail(move) {
  const group = move.groups?.find(candidate => tacticSizeForGroup(candidate) === 6) || move.groups?.[0];
  if (!group) return '실제 보드에서 가능한 인접 스왑만 사용합니다.';
  const kind = move.cells[group[0]];
  if (tacticSizeForGroup(group) === 6) {
    return `${TACTIC_HERO[kind]} 액티브 -8초 · ${TACTIC_EFFECT[kind]} 강화 · 성좌 수호자 3/3`;
  }
  return `위치 → ${LANE_LABEL[laneForGroup(group)]} 길 · 색 → ${TACTIC_EFFECT[kind]} · ${TACTIC_HERO[kind]} 액티브 충전`;
}

/* Until the feature has been shown once, preserve and take a legal Sigil move
 * when its mapped lane contains a target. No board mutation or combat shortcut
 * is introduced; after the lesson the normal threat policy resumes. */
export function chooseDemoTacticMove(state, cells, profile, rng, teachSigil = true) {
  if (teachSigil) {
    const sigilMoves = findLegalSwaps(cells).filter(move => move.groups
      .some(group => tacticSizeForGroup(group) === 6));
    if (sigilMoves.length) {
      return sigilMoves.find(move => move.groups.some(group => tacticSizeForGroup(group) === 6
        && state.enemies.some(enemy => !enemy.dead && enemy.route === laneForGroup(group)))) || null;
    }
  }
  return Bot.chooseTacticSwap(state, cells, profile, rng);
}

/* Pace actions slowly enough to read without making the demo drag. */
const PACE = {
  prep: 0.55,        // Seconds between preparation actions.
  tactic: 0.45,      // Delay after a tactic swap before the next decision.
  afterWave: 1.2,    // Pause after clearing a wave.
  restart: 12.0,     // Allow time to read the retrospective and share card before restarting.
};

export const demo = {
  active: false,
  profileName: '고수',
  t: 0,              // Time remaining until the next action.
  midT: 0,           // Combat decision interval.
  api: null,
  caption: '',
  detail: '',
  tone: 'action',
  captionHold: 0,
  guidesSeen: new Set(),
  overSeen: false,
  tourIndex: -1,
  tourT: 0,

  /* main.js injects player command functions; the demo never directly edits game internals. */
  attach(api) { this.api = api; },

  /* Accept English profile aliases for robust shared URLs. */
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
    this.captionHold = 0;
    this.guidesSeen = new Set();
    this.overSeen = false;
    this.tourIndex = 0;
    this.tourT = DEMO_TOUR[0].duration;
    this.api.onStart(this.profileName, Bot.PROFILES[this.profileName]);
    this.present(DEMO_TOUR[0], true);
    return true;
  },

  stop() {
    if (!this.active) return;
    this.active = false;
    this.tourIndex = -1;
    this.tourT = 0;
    this.captionHold = 0;
    this.api.onStop();
  },

  toggle(profileName) { this.active ? this.stop() : this.start(profileName); },

  say(title, detail = '', tone = 'action', force = false) {
    if (!force && this.captionHold > 0) return false;
    this.caption = title;
    this.detail = detail;
    this.tone = tone;
    if (this.api) this.api.onCaption(title, detail, tone);
    return true;
  },

  present(scene, force = false) {
    return this.say(scene.title, scene.detail, scene.tone, force);
  },

  guide(key, scene = DEMO_GUIDES[key]) {
    if (!scene || this.guidesSeen.has(key)) return false;
    this.guidesSeen.add(key);
    this.captionHold = Math.max(this.captionHold, scene.duration || 3.6);
    return this.present(scene, true);
  },

  onTacticCast(kind, lane, size) {
    if (!this.active) return;
    if (size === 6) {
      this.guide('heroSigil', {
        ...DEMO_GUIDES.heroSigil,
        title: `✦ HERO SIGIL · ${TACTIC_LABEL[kind]} 영웅 성좌 문양!`,
        detail: `${LANE_LABEL[lane]} 길 ${TACTIC_EFFECT[kind]} 강화 · ${TACTIC_HERO[kind]} 액티브 -8초 · 성좌 수호자 3/3`,
      });
    } else this.guide('firstTactic');
  },

  /* Called every frame. */
  step(dt) {
    if (!this.active || !this.api) return;
    const A = this.api;
    const state = A.getState();
    const P = Bot.PROFILES[this.profileName];
    this.t -= dt;
    this.captionHold = Math.max(0, this.captionHold - dt);

    /* The explanatory opening behaves like subtitles over the live engine.
     * Gameplay starts only after the viewer has had time to read each card. */
    if (this.tourIndex >= 0) {
      this.tourT -= dt;
      if (this.tourT <= 0) {
        this.tourIndex++;
        if (this.tourIndex >= DEMO_TOUR.length) {
          this.tourIndex = -1;
          this.t = .6;
          this.say(`🎬 ${this.profileName} 플레이어의 실제 자동 플레이를 시작합니다`,
            '이후 모든 이동·스왑·시전은 플레이어와 같은 공개 정보와 게임 명령을 사용합니다.', 'guide', true);
        } else {
          const scene = DEMO_TOUR[this.tourIndex];
          this.tourT = scene.duration;
          this.present(scene, true);
        }
      }
      return;
    }

    /* Read and dismiss interludes; an open story prevents wave startup. */
    if (A.isStoryOpen()) {
      if (this.t <= 0) { A.closeStory(); this.t = 0.5; }
      return;
    }
    /* Wait for legendary/mythic reveals to close themselves. */
    if (A.isRevealOpen()) return;

    /* Show defeat briefly, then start another run. */
    if (state.phase === 'over') {
      if (!this.overSeen) {
        this.overSeen = true;
        this.t = PACE.restart;
        this.say(`🎬 ${state.wave}웨이브 수호의 기억 — 결과를 확인해 보세요`,
          '가장 큰 문양·집중 방어로·결정적 회복이 실제 플레이 기록으로 남습니다.', 'guide', true);
        return;
      }
      if (this.t <= 0) {
        this.say(`🎬 ${state.wave}웨이브에서 성이 무너졌어요 — 다시 시작합니다`,
          '같은 설명형 시드로 다시 시작해 관전 흐름을 반복합니다.', 'guide', true);
        A.newGame();
        this.overSeen = false;
        this.t = 1.0;
      }
      return;
    }
    this.overSeen = false;

    /* Consume preparation decisions one at a time. */
    if (state.phase === 'journey') {
      this.guide('journey');
      if (this.t > 0) return;
      if (state.journey?.complete) {
        if (A.journeyNext?.()) this.say('▤ 원정의 성장과 기록을 지닌 채 다음 장을 펼칩니다',
          '한 장의 선택과 동료 성장이 다음 지역의 전투 규칙으로 이어집니다.');
        else {
          const ending = Bot.nextJourneyEnding(state);
          if (ending && A.journeyEnding?.(ending)) this.say('✎ 영웅과 몬스터가 함께 쓰는 결말을 선택합니다');
        }
      } else if (state.journey?.pendingRecruit) {
        const key = Bot.nextJourneyRecruit(state);
        if (key) {
          this.say(`✦ ${HERO_LABEL[key] || key} 영웅을 원정대에 맞이합니다`,
            '영입한 동료는 이후 전투의 카드·액티브·연결 퍼즐에 계속 등장합니다.');
          A.journeyRecruit(key);
        }
      } else {
        const path = Bot.nextJourneyPath(state);
        if (path) {
          this.say(`${path.icon} ${path.name}의 길을 선택합니다`,
            '원정 분기는 영입·보급·지원 기술을 바꾸지만 같은 영웅단의 성장은 유지됩니다.');
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
            this.say(`🧭 ${node.name}(으)로 별길을 따라갑니다`,
              '별자리 지도에서 다음 마을이나 짧은 방어전을 직접 선택합니다.');
            A.journeyTravel(node.id);
          }
        }
      }
      this.t = 1.05;
      return;
    }

    if (state.phase === 'prep') {
      this.guide('prep');
      if (this.t > 0) return;
      const act = Bot.nextPrepAction(state, P, state.rng || Math.random);
      if (!act) {
        this.say(`⚔️ ${state.wave}웨이브 시작!`,
          '배치가 끝났습니다. 적이 움직이는 동안 퍼즐과 영웅 기술을 함께 운용합니다.');
        A.startWave();
        this.t = 0.8;
        return;
      }
      this.doAction(act, state);
      this.t = PACE.prep;
      return;
    }

    /* During combat, use legal tactic swaps, champion spells and surplus-gold summons/placement. */
    this.guide('battle');
    this.midT -= dt;
    if (this.midT <= 0) {
      this.midT = 2;
      const move = chooseDemoTacticMove(state, A.getTacticBoard(), P, state.rng || Math.random,
        !this.guidesSeen.has('heroSigil'));
      if (move) {
        this.say(describeTacticMove(move), describeTacticDetail(move),
          move.groups.some(group => tacticSizeForGroup(group) === 6) ? 'sigil' : 'action');
        A.tacticSwap(move.from, move.to);
        this.t = PACE.tactic;
        return;
      }
      /* Champion spells use the shared bot.js policy. */
      if (Bot.wantsUlt(state, P)) {
        this.say('🌌 은하수! 하늘의 별을 전부 쏟아붓습니다',
          '별지기의 궁극기는 퍼즐 전술과 별개로 전장 전체의 위기를 정리합니다.', 'hero');
        A.ult();
        return;
      }
      if (Bot.wantsStar(state, P)) {
        this.say('☄️ 별지기의 별똥별로 지원 사격!',
          '실시간 전투 명령은 퍼즐·영웅 액티브·별지기 마법의 세 층으로 구성됩니다.', 'hero');
        A.spell();
        return;
      }
      const constellationAid = Bot.nextConstellationAid(state, P, state.rng || Math.random);
      if (constellationAid) {
        this.guide('guardian');
        A.constellationAid();
        return;
      }
      const blueprint = Bot.nextMonsterBlueprint(state, P, state.rng || Math.random);
      if (blueprint) {
        this.say(`${blueprint.spec.emoji} ${blueprint.spec.summonName}, ${LANE_LABEL[blueprint.route]} 길 지원!`,
          '원정 분기에서 얻은 지원도 가장 위험한 길을 읽고 실제 전투 명령으로 사용합니다.');
        A.monsterBlueprint();
        return;
      }
      const heroActive = Bot.nextHeroActive(state, P, state.rng || Math.random);
      if (heroActive) {
        this.guide('heroActive', {
          ...DEMO_GUIDES.heroActive,
          title: `${heroActive.spec.emoji} ${heroActive.hero.name} · ${heroActive.spec.name}!`,
        });
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
        this.say('🎲 용사를 소환합니다', '준비 단계의 자원 선택이 다음 실시간 방어의 배치 폭을 정합니다.');
        A.summon();
        break;
      case 'combine': {
        const name = A.comboLabel(act.combo);
        this.say(`⚗️ ${name} 조합을 실행합니다`, '같은 등급의 용사를 결합해 한 자리를 더 강한 전투력으로 압축합니다.');
        A.combine(act.action);
        break;
      }
      case 'place':
        this.say(`📍 ${A.heroLabel(act.hero)}를 좋은 자리에 배치`, '영웅의 공격 범위와 세 방어로의 압력을 함께 보고 위치를 정합니다.');
        A.place(act.heroId, act.pad);
        break;
      case 'castle':
        this.say(`🏰 성을 강화합니다 (${act.key})`, '회복·성벽·포탑 중 이번 원정에 필요한 장기 방어 투자를 고릅니다.');
        A.castle(act.key);
        break;
      case 'skill':
        this.say(`✨ 별지기의 별자리를 잇습니다 — [${act.skill.name}]`, '전투에서 얻은 성장이 다음 방어의 별지기 명령을 바꿉니다.');
        A.skill(act.key);
        break;
      case 'heroSkill':
        this.say(`✦ ${A.heroLabel(act.hero)} 전문화 · ${act.skill.name}`, '마을의 성장 선택이 해당 영웅의 전투 역할과 연결 퍼즐 효과를 강화합니다.');
        A.heroSkill(act.heroId, act.key);
        break;
      case 'feast':
        this.say('🎉 남는 골드로 잔치를 벌입니다 — 누가 승급할까요?', '남은 자원을 다음 방어 전에 확률형 전력 상승으로 전환합니다.');
        A.feast();
        break;
    }
  },
};
