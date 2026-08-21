/* =====================================================
 * UI (DOM 패널/모달) — 상태를 그리고, 입력을 핸들러로 전달
 * ===================================================== */
import * as D from './data.js';
import * as E from './engine.js';
import { heroCardClass, heroCardMarkup } from './app/hero-card.js';
import { combatLanePressure } from './app/combat-focus.js';
import { VILLAGE_FACILITY_SPOTS, VILLAGE_RECRUITER_SPOTS, VILLAGE_START, advanceVillage, isNearVillageTarget, villageWalkPoint } from './app/village-layout.js';
import { getLocale } from './app/i18n.js';

const $ = (id) => document.getElementById(id);

/* 사거리 등급 라벨 — 숫자만으론 감이 안 오니 말로도 알려준다 */
function rangeLabel(range) {
  if (range >= 240) return { text: '초장거리', cls: 'r4' };
  if (range >= 180) return { text: '장거리', cls: 'r3' };
  if (range >= 140) return { text: '중거리', cls: 'r2' };
  return { text: '근접', cls: 'r1' };
}

/* 조합 결과 미리보기용 가상 용사 (상태를 바꾸지 않는다) */
function previewHero(cls, tier, state) {
  const s = D.heroStats(cls, tier);
  return {
    id: -1, cls, tier, padIndex: -1,
    dmg: Math.round(s.dmg * (state ? state.dmgMul : 1)),
  };
}

/* 용사 상세 정보(툴팁/패널 공용) */
export function describeHero(hero, state, preview) {
  const C = D.CLASSES[hero.cls];
  const T = hero.level ? { color: '#7658c7', name: `Lv ${hero.level}` } : D.TIERS[hero.tier];
  const m = E.heroMods(hero);
  const rl = rangeLabel(m.range);
  const rows = [];
  rows.push(`⚔ 공격력 <b>${hero.dmg}</b>${m.hits > 1 ? ` × ${m.hits}타` : ''}`);
  rows.push(`⏱ 공격속도 <b>${m.spd.toFixed(2)}</b>/초 · 초당 <b>${E.heroDps(hero)}</b>`);
  if (m.crit) rows.push(`💥 <b>치명타 ${Math.round(m.crit.chance * 100)}%</b> · 피해 <b>×${m.crit.mul}</b>`);
  if (m.block) rows.push(`🛡️ <b>방패 장벽</b>: ${m.block.period}초마다 사거리 안 적을 <b>${m.block.dur}초 정지</b>`);
  if (m.slowOnHit) rows.push(`❄ 맞은 적 <b>${Math.round((1 - m.slowOnHit.mul) * 100)}% 감속</b> ${m.slowOnHit.dur}초`);
  if (m.aura) rows.push(`❄ <b>결계</b>: 사거리 안 모든 적 상시 ${Math.round((1 - m.aura) * 100)}% 감속`);
  if (m.splash) rows.push(`💥 <b>범위 폭발</b> 반경 ${Math.round(m.splash)}`);
  if (m.splashSlow) rows.push(`🧊 폭발에 맞은 적 ${Math.round((1 - m.splashSlow.mul) * 100)}% 감속`);
  if (m.burn) rows.push(`🔥 <b>화상</b>: 초당 공격력의 ${Math.round(m.burn * 100)}% (${D.BURN_DUR}초)`);
  if (m.pierce > 1) rows.push(`🎯 <b>관통</b> ${m.pierce}명`);
  if (m.cleave) rows.push(`🌀 <b>회전베기</b>: 사거리 안 전부 타격`);
  if (m.healOnKill) rows.push(`💚 처치 시 성 회복 <b>+${m.healOnKill}</b>`);

  const active = D.heroActiveSpec(hero.heroKey);
  const activeMarkup = active
    ? `<div class="tt-active">${active.emoji} <b>${active.name}</b> · ${active.desc} <small>재사용 ${active.cooldown}초</small></div>`
    : '';

  let ability = '';
  const MA = !hero.level && hero.tier >= 4 ? D.MYTHIC_ABILITIES[hero.cls] : null;
  const LA = D.LEGEND_ABILITIES[hero.cls];
  if (MA) ability = `<div class="tt-mythic">🌌 ${MA.name} — ${MA.desc}</div>`;
  else if (hero.tier === 3 && LA) ability = `<div class="tt-legend">⭐ ${LA.name} — ${LA.desc}</div>`;
  let recipe = '';
  if (!hero.level && C.recipe) {
    const [a, b] = C.recipe;
    const label = C.mythic ? '🌌 신화 조합 전용' : '✨ 조합 전용 특수 용사';
    recipe = `<div class="tt-recipe">${label} (${D.CLASSES[a].emoji}+${D.CLASSES[b].emoji})</div>`;
  }
  const barPct = Math.round((m.range / D.RANGE_MAX) * 100);
  const onField = hero.padIndex >= 0;
  const cap = D.maxTierOf(hero.cls);
  const capNote = hero.level
    ? `Level ${hero.level} · specialization points ${hero.sp || 0}`
    : hero.tier >= cap
    ? `🔒 최고 등급(${D.TIERS[cap].name})`
    : `⬆ ${D.TIERS[cap].name}까지 성장 가능`;
  const foot = preview
    ? '🔮 조합하면 이렇게 나와요 (미리보기)'
    : `${onField ? (hero.level ? '배치됨 · 선택 후 액티브 버튼 또는 발판 클릭으로 이동' : '배치됨 · 발판 클릭으로 이동(다른 용사면 교환) · 우클릭 회수') : '벤치 · 발판을 눌러 배치(찬 자리면 교환)'} · ${capNote}`;

  return `
    <div class="tt-head">
      ${preview ? '<span class="tt-preview">미리보기</span>' : ''}
      <span class="tt-emoji">${C.emoji}</span>
      <span class="tt-name">${C.name}</span>
      <span class="tt-tier" style="background:${T.color}">${T.name}</span>
    </div>
    <div class="tt-range">
      <span class="tt-rlabel ${rl.cls}">${rl.text}</span>
      <span class="tt-rnum">🎯 사거리 ${m.range}</span>
      <div class="tt-rbar"><div class="tt-rfill ${rl.cls}" style="width:${barPct}%"></div></div>
    </div>
    <div class="tt-rows">${rows.map(r => `<div>${r}</div>`).join('')}</div>
    ${activeMarkup}${ability}${recipe}
    <div class="tt-desc">${C.desc}</div>
    <div class="tt-foot">${foot}</div>
  `;
}

export class UI {
  constructor() {
    this.el = {};
    [
      'bestWave', 'shards', 'metaBtn', 'castleText', 'castleFill', 'castleGhost',
      'scene3d', 'bossBanner', 'comboChip', 'waveInfo', 'remainN',
      'waveBtn', 'coachChip', 'toasts', 'gold', 'waveNo', 'waveLabel', 'speedBtn',
      'summonBtn', 'benchHint', 'bench', 'combineRows', 'sfxBtn', 'bgmBtn', 'effectsBtn',
      'placeBar', 'placeBarText', 'placeBarCancel',
      'castleRows', 'heroPanel', 'hpTitle', 'hpInfo', 'heroActiveBtn', 'recallBtn', 'sellBtn', 'moveHint',
      'combatHeroBar', 'combatHeroName', 'combatHeroRole', 'combatHeroActiveBtn', 'combatSkillDock',
      'combatBlueprintBar', 'combatBlueprintName', 'combatBlueprintRole', 'combatBlueprintBtn',
      'combatConstellationBar', 'combatConstellationName', 'combatConstellationRole', 'combatConstellationBtn', 'lanePressure',
      'diffRow',
      'storyModal', 'storyIcon', 'storyTitle', 'storyLines', 'storyNext', 'storyOff',
      'demoBtn', 'spectateBtn', 'demoBar', 'demoCaption', 'demoDetail', 'demoExit',
      'revealModal', 'revealCard', 'summonReveal', 'revealTier', 'revealArt', 'revealName', 'revealDesc',
      'wavePreview', 'bossBar', 'bossBarFill', 'bossBarName', 'bossWarnBanner', 'phaseCountdown', 'phaseCountdownNum',
      'saveBtn', 'loadBtn', 'playtestBtn', 'settingsBtn', 'loadFile',
      'settingsModal', 'settingsLanguage', 'settingsGfx', 'settingsEffects', 'settingsApplyNote',
      'settingsSfxBtn', 'settingsBgmBtn', 'settingsKeyRows', 'settingsKeyReset',
      'settingsSavePath', 'settingsClose',
      'sellModeBtn', 'sellInfo', 'sellAllBtn', 'sellGoBtn',
      'startModal', 'continueInfo', 'continueBtn', 'newGameBtn',
      'overModal', 'overStats', 'overShards', 'restartBtn', 'shareBtn', 'overMetaBtn',
      'metaModal', 'metaShards', 'metaRows', 'metaClose', 'tooltip',
      'bookBtn', 'bookDot', 'bookModal', 'bookTabs', 'bookBody', 'bookClose',
      'victoryModal', 'victoryTitle', 'victoryStats', 'victoryShards', 'victoryMsg',
      'victoryTrialBtn', 'victoryContinueBtn', 'victoryShareBtn', 'loopChip',
      'revealCard',
      'tabs', 'heroDot', 'combineDot', 'helpBtn', 'helpBox',
      'champChip', 'champFace', 'champName', 'champLv', 'champKoTag', 'champHpFill', 'champXpFill',
      'spellBtn', 'spellCdFill', 'ultBtn', 'ultFill', 'skillBtn', 'spBadge',
      'skillModal', 'skillTitle', 'skillPts', 'skillCols', 'skillClose',
      'closetModal', 'closetPreview', 'closetName', 'closetRows', 'closetSave', 'closetClose',
    ].forEach(id => this.el[id] = $(id));
    this._lastKnow = -1;
    this._lastProbSig = '';
    const squadTab = [...this.el.tabs.querySelectorAll('button')].find((button) => button.dataset.tab === 'combine');
    const squadPane = document.querySelector('.tabbody .pane[data-pane="combine"]');
    if (squadTab && squadPane) {
      squadTab.dataset.tab = 'squad';
      squadTab.innerHTML = '✦ 영웅 성장<span id="combineDot" class="tabdot hidden"></span>';
      squadPane.dataset.pane = 'squad';
      squadPane.querySelector('h2').innerHTML = '✦ 영웅 성장 <span class="sub">레벨업 때 전문화를 고르세요</span>';
      this.el.combineDot = squadTab.querySelector('#combineDot');
    }
    this._tab = 'squad';
    this._tabBefore = null;
    this.el.summonBtn.classList.add('hidden');
    this.el.helpBox.innerHTML = `
      <p>🛡️ <b>영웅단</b> 아린과 루나로 시작해 원정 중 동료를 영입합니다. 영웅 카드를 눌러 선택한 뒤 빈 발판이나 다른 영웅을 눌러 위치를 옮기거나 교환하세요.</p>
      <p>✦ <b>성장</b> 처치와 웨이브 완료로 영웅 경험치를 얻습니다. 레벨업 포인트가 생기면 <b>영웅 성장</b> 탭에서 그 영웅의 전문화를 고르세요. <b data-shortcut="squad">S</b> 키로 바로 열 수 있어요.</p>
      <p>☄️ <b>별자리 전술</b> 전투 중 6×6 보드에서 이웃 별을 두 번 누르거나 손가락으로 미세요. 유성은 아린·세라, 서리는 루나·유나, 수호는 도윤의 전술과 액티브를 충전하고, 맞춘 열이 대상 길을 정합니다.</p>
      <p>🌠 <b>영웅 액티브</b> 전투 중 영웅 카드를 누른 뒤 용사 패널의 큰 기술 버튼을 누르세요. 다섯 영웅이 서로 다른 처형·폭발·저지·연사·감속 기술을 씁니다.</p>
      <p>👺 <b>몬스터 청사진</b> 2막 지하 시장에서 기록하면 방어마다 한 번, 가장 위험한 길에 고블린 김대리를 소환할 수 있습니다. 버튼 또는 <b data-shortcut="blueprint">G</b>를 누르세요. <b data-shortcut="spectate">D</b>는 밸런스 봇 관전, <b data-shortcut="codex">B</b>는 기록입니다.</p>`;
    document.body.insertAdjacentHTML('beforeend', `
      <section id="journeyModal" class="journey-modal hidden" aria-live="polite">
        <div id="journeyBody" class="journey-shell"></div>
      </section>`);
    this.el.journeyModal = $('journeyModal');
    this.el.journeyBody = $('journeyBody');
    document.body.insertAdjacentHTML('beforeend', `
      <section id="defenseVictory" class="defense-victory hidden" role="status" aria-live="assertive">
        <div class="defense-victory-card"><span>🏆 VICTORY</span><h2 id="defenseVictoryTitle">방어 성공!</h2><p id="defenseVictoryDetail"></p></div>
      </section>`);
    this.el.defenseVictory = $('defenseVictory');
    this.el.defenseVictoryTitle = $('defenseVictoryTitle');
    this.el.defenseVictoryDetail = $('defenseVictoryDetail');
    this._journeyState = null;
    this._village = { open: false, nodeId: null, ...VILLAGE_START, dirX: 0, dirZ: -1, moving: false, destination: null, dialog: null };
    this._villageKeys = new Set();
    this._villagePointerKeys = new Set();
    this._villageKeyDownHandler = (event) => this._handleVillageKey(event, true);
    this._villageKeyUpHandler = (event) => this._handleVillageKey(event, false);
    /* Capture movement keys before the global combat shortcuts.  The village is
     * a presentation layer: all rewards and skill validation remain in engine/. */
    window.addEventListener('keydown', this._villageKeyDownHandler, true);
    window.addEventListener('keyup', this._villageKeyUpHandler, true);
    window.addEventListener('blur', () => {
      this._villageKeys.clear();
      this._villagePointerKeys.clear();
      this._village.moving = false;
    });
  }

  _activeVillageNode(state) {
    const pending = E.journeyNode(state?.journey?.pendingRecruit, state);
    const current = E.journeyNode(state?.journey?.current, state);
    if (pending?.kind === 'town') return pending;
    if (this._village.open && current?.kind === 'town') return current;
    return null;
  }

  _ensureVillage(node) {
    if (this._village.nodeId === node.id) return;
    this._village = { open: true, nodeId: node.id, ...VILLAGE_START, dirX: 0, dirZ: -1, moving: false, destination: null, dialog: null };
  }

  _villageTargets(state, node) {
    const targets = [];
    if (state.journey.pendingRecruit === node.id) {
      for (const key of node.offers || []) {
        if (state.field.some((hero) => hero.heroKey === key)) continue;
        const spec = D.squadSpec(key);
        const C = spec && D.CLASSES[spec.cls];
        const spot = VILLAGE_RECRUITER_SPOTS[key] || { x: 0, z: 0, place: '마을 광장' };
        if (spec && C) targets.push({ id: `recruit:${key}`, type: 'recruit', key, x: spot.x, z: spot.z, place: spot.place, label: spec.name, emoji: C.emoji });
      }
    }
    for (const key of node.facilities || []) {
      const facility = D.HERO_FACILITIES[key];
      const spot = VILLAGE_FACILITY_SPOTS[key];
      if (facility && spot) targets.push({ id: `facility:${key}`, type: 'facility', key, x: spot.x, z: spot.z, label: facility.name, emoji: facility.emoji, desc: facility.desc });
    }
    return targets;
  }

  _nearVillageTarget(target) {
    return isNearVillageTarget(this._village, target);
  }

  _moveVillage(x, z) {
    const next = villageWalkPoint(this._village, { x, z });
    if (next.x === this._village.x && next.z === this._village.z) return;
    const dx = next.x - this._village.x;
    const dz = next.z - this._village.z;
    const length = Math.hypot(dx, dz) || 1;
    this._village.x = next.x;
    this._village.z = next.z;
    this._village.dirX = dx / length;
    this._village.dirZ = dz / length;
    this._village.moving = true;
    this._village.dialog = null;
    this._syncVillagePresentation();
  }

  _setVillageDestination(point) {
    this._village.destination = point ? { x: point.x, z: point.z } : null;
    this._village.dialog = null;
    this._syncVillagePresentation();
  }

  updateVillage(dt) {
    if (!this.isVillageActive()) return;
    if (this._village.dialog) {
      if (this._village.moving) {
        this._village.moving = false;
        this._syncVillagePresentation();
      }
      return;
    }
    const pressed = (key) => this._villageKeys.has(key) || this._villagePointerKeys.has(key);
    let input = {
      x: (pressed('right') ? 1 : 0) - (pressed('left') ? 1 : 0),
      z: (pressed('down') ? 1 : 0) - (pressed('up') ? 1 : 0),
    };
    const manual = input.x !== 0 || input.z !== 0;
    if (manual) this._village.destination = null;
    else if (this._village.destination) {
      const dx = this._village.destination.x - this._village.x;
      const dz = this._village.destination.z - this._village.z;
      if (Math.hypot(dx, dz) <= .16) this._village.destination = null;
      else input = { x: dx, z: dz };
    }
    const wasMoving = this._village.moving;
    const next = advanceVillage(this._village, input, dt);
    this._village.x = next.x;
    this._village.z = next.z;
    this._village.dirX = next.dirX;
    this._village.dirZ = next.dirZ;
    this._village.moving = next.moving;
    if (this._village.destination && !manual && !next.moving) this._village.destination = null;
    if (next.moving || wasMoving !== next.moving) this._syncVillagePresentation();
  }

  _openVillageTarget(target) {
    if (!this._nearVillageTarget(target)) return;
    this._villageKeys.clear();
    this._villagePointerKeys.clear();
    this._village.destination = null;
    this._village.moving = false;
    this._village.dialog = { type: target.type, key: target.key };
    this.renderJourney(this._journeyState);
  }

  isVillageActive() {
    return !!this._activeVillageNode(this._journeyState) && this._village.open;
  }

  _syncVillagePresentation() {
    const state = this._journeyState;
    const node = this._activeVillageNode(state);
    if (!node || !this._village.open) {
      this.h?.onVillagePresentation?.({ active: false });
      return;
    }
    const targets = this._villageTargets(state, node);
    const nearby = targets.find((target) => this._nearVillageTarget(target)) || null;
    const hint = nearby
      ? `${nearby.emoji} ${nearby.label} 근처입니다. Enter 또는 대화 버튼을 누르세요.`
      : 'WASD·방향키 또는 광장을 클릭해 걸어가세요. 빛나는 표식 가까이에서 대화할 수 있습니다.';
    const hintEl = this.el.journeyBody.querySelector('[data-village-hint]');
    if (hintEl) hintEl.textContent = hint;
    const action = this.el.journeyBody.querySelector('[data-village-action]');
    if (action) {
      action.disabled = !nearby;
      action.textContent = nearby ? `${nearby.emoji} ${nearby.type === 'recruit' ? `${nearby.label}와 대화` : `${nearby.label} 방문`}` : '가까운 사람 또는 시설 찾기';
    }
    this.h?.onVillagePresentation?.({
      active: true,
      host: this.el.journeyBody.querySelector('#village3d'),
      player: { x: this._village.x, z: this._village.z },
      motion: { x: this._village.dirX, z: this._village.dirZ, moving: this._village.moving },
      destination: this._village.destination,
      targets,
      nearby,
    });
  }

  _handleVillageKey(event, pressed) {
    const direction = {
      ArrowLeft: 'left', a: 'left', A: 'left',
      ArrowRight: 'right', d: 'right', D: 'right',
      ArrowUp: 'up', w: 'up', W: 'up',
      ArrowDown: 'down', s: 'down', S: 'down',
    }[event.key];
    if (!pressed && direction) this._villageKeys.delete(direction);
    const state = this._journeyState;
    const node = this._activeVillageNode(state);
    if (!node || state?.phase !== 'journey' || !this._village.open) return;
    if (direction) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pressed && !this._village.dialog) {
        this._villageKeys.add(direction);
        this._village.destination = null;
      }
      return;
    }
    if (!pressed) return;
    if (event.key === 'Escape' && this._village.dialog) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this._village.dialog = null;
      this.renderJourney(state);
      return;
    }
    if (this._village.dialog) return;
    if (event.key === 'Escape' && !state.journey.pendingRecruit) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this._village.open = false;
      this.renderJourney(state);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && !this._village.dialog) {
      const target = this._villageTargets(state, node).find((entry) => this._nearVillageTarget(entry));
      if (target) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this._openVillageTarget(target);
      }
    }
  }

  _villageDialogMarkup(state, node) {
    const dialog = this._village.dialog;
    if (!dialog) return '';
    if (dialog.type === 'recruit') {
      const spec = D.squadSpec(dialog.key);
      const C = spec && D.CLASSES[spec.cls];
      if (!spec || !C) return '';
      return `<section class="village-dialog"><button class="village-dialog-close" data-village-close aria-label="대화 닫기">×</button>
        <span class="village-dialog-portrait">${C.emoji}</span><div><p class="village-dialog-kicker">${spec.role}</p><h2>${spec.name}와 대화</h2><p>${spec.name}의 전술을 원정대에 더합니다. 이번 원정에는 한 명만 설득할 수 있습니다.</p>
        <button class="village-dialog-action" data-village-recruit="${spec.key}">${C.emoji} ${spec.name} 영입하기</button></div></section>`;
    }
    const facility = D.HERO_FACILITIES[dialog.key];
    if (!facility) return '';
    const heroes = state.field.filter((hero) => facility.heroes.includes(hero.heroKey));
    const heroRows = heroes.map((hero) => {
      const C = D.CLASSES[hero.cls];
      const skills = Object.entries(D.HERO_SKILLS).filter(([, skill]) => skill.cls === hero.cls).map(([key, skill]) => {
        const rank = hero.skills[key] || 0;
        const locked = hero.level < skill.level;
        const capped = rank >= skill.max;
        const enabled = hero.sp > 0 && !locked && !capped;
        const label = capped ? `완료 ${rank}/${skill.max}` : locked ? `Lv ${skill.level} 필요` : `포인트 1 · ${rank}/${skill.max}`;
        return `<button class="village-skill${enabled ? ' ready' : ''}" data-village-skill="${key}" data-hero-id="${hero.id}" ${enabled ? '' : 'disabled'}><span>${skill.emoji} <b>${skill.name}</b></span><small>${skill.per} · ${label}</small></button>`;
      }).join('');
      return `<div class="village-hero-build"><header><span>${C.emoji} <b>${hero.name}</b></span><small>Lv ${hero.level} · 전문화 ${hero.sp}</small></header>${skills}</div>`;
    }).join('') || '<p class="village-empty">이 시설을 이용할 영웅이 아직 원정대에 없습니다.</p>';
    return `<section class="village-dialog facility"><button class="village-dialog-close" data-village-close aria-label="시설 닫기">×</button>
      <span class="village-dialog-portrait">${facility.emoji}</span><div><p class="village-dialog-kicker">마을 시설</p><h2>${facility.name}</h2><p>${facility.desc} 전투에서 얻은 전문화 포인트는 이곳에서만 사용합니다.</p>${heroRows}</div></section>`;
  }

  _renderVillage(state, node) {
    this._ensureVillage(node);
    const targets = this._villageTargets(state, node);
    const nearby = targets.find((target) => this._nearVillageTarget(target));
    const hint = nearby
      ? `${nearby.emoji} ${nearby.label} 근처입니다. Enter 또는 대화 버튼을 누르세요.`
      : 'WASD·방향키 또는 광장을 클릭해 걸어가세요. 빛나는 표식 가까이에서 대화할 수 있습니다.';
    const locked = state.journey.pendingRecruit === node.id;
    const refuge = node.refugeeStation && state.journey.refuge?.arrived ? state.journey.refuge : null;
    const ally = refuge?.ally === 'guild' ? '헌터 구조대' : refuge?.ally === 'market' ? '몬스터 연락망' : '독립 피난민';
    const refugeStatus = refuge
      ? `<div class="village-refuge-status"><span>👥 구조 ${refuge.survivors}명</span><span>♥ 사기 ${'◆'.repeat(refuge.morale)}${'◇'.repeat(5 - refuge.morale)}</span><span>🤝 ${ally}</span><span>🛡 방어 ${refuge.defenses}회</span></div>`
      : '';
    return `<section class="village-screen">
      <div id="village3d" class="village-3d" aria-label="${node.name} 3D 광장"></div>
      <header class="village-top"><span>CONSTELLATION VILLAGE</span><h1>${node.icon} ${node.name}</h1><p>${refuge ? '이름을 잃지 않도록 구조 기록을 지키고 다음 방어를 준비합니다.' : locked ? '동료 한 명과 대화해야 다음 길이 열립니다.' : '시설을 방문하거나 지도에서 다음 별길로 출발하세요.'}</p>${refugeStatus}</header>
      <div class="village-bottom"><p data-village-hint>${hint}</p><div class="village-controls"><button data-village-action ${nearby ? '' : 'disabled'}>${nearby ? `${nearby.emoji} ${nearby.label} ${nearby.type === 'recruit' ? '와 대화' : '방문'}` : '가까운 사람 또는 시설 찾기'}</button><div class="village-dpad" aria-label="마을 이동"><button data-village-step="up">▲</button><span><button data-village-step="left">◀</button><button data-village-step="down">▼</button><button data-village-step="right">▶</button></span></div>${locked ? '' : '<button class="village-map-exit" data-village-leave>지도 보기</button>'}</div></div>
      ${this._villageDialogMarkup(state, node)}
    </section>`;
  }

  _bindVillageScreen(state, node) {
    const openNearby = () => {
      const target = this._villageTargets(state, node).find((entry) => this._nearVillageTarget(entry));
      if (target) this._openVillageTarget(target);
    };
    this.el.journeyBody.querySelectorAll('[data-village-action]').forEach((button) =>
      button.addEventListener('click', openNearby));
    const steps = { up: [0, -.18], down: [0, .18], left: [-.18, 0], right: [.18, 0] };
    this.el.journeyBody.querySelectorAll('[data-village-step]').forEach((button) => {
      const direction = button.dataset.villageStep;
      const stop = () => this._villagePointerKeys.delete(direction);
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this._village.destination = null;
        this._villagePointerKeys.add(direction);
        const step = steps[direction];
        if (step) this._moveVillage(this._village.x + step[0], this._village.z + step[1]);
        button.setPointerCapture?.(event.pointerId);
      });
      button.addEventListener('pointerup', stop);
      button.addEventListener('pointercancel', stop);
      button.addEventListener('lostpointercapture', stop);
    });
    this.el.journeyBody.querySelectorAll('[data-village-leave]').forEach((button) =>
      button.addEventListener('click', () => {
        this._villageKeys.clear(); this._villagePointerKeys.clear();
        this._village.open = false; this._village.destination = null; this._village.dialog = null; this.renderJourney(state);
      }));
    this.el.journeyBody.querySelectorAll('[data-village-recruit]').forEach((button) =>
      button.addEventListener('click', () => this.h.onJourneyRecruit(button.dataset.villageRecruit)));
    this.el.journeyBody.querySelectorAll('[data-village-skill]').forEach((button) =>
      button.addEventListener('click', () => this.h.onHeroSkill(Number(button.dataset.heroId), button.dataset.villageSkill)));
    this.el.journeyBody.querySelectorAll('[data-village-close]').forEach((button) =>
      button.addEventListener('click', () => { this._village.dialog = null; this.renderJourney(state); }));
    const surface = this.el.journeyBody.querySelector('#village3d');
    surface?.addEventListener('click', (event) => {
      const point = this.h?.onVillagePick?.(event.clientX, event.clientY);
      if (point) this._setVillageDestination(point);
    });
  }

  renderJourney(state) {
    this._journeyState = state;
    const journey = state?.journey;
    if (!journey) { this.el.journeyModal.classList.add('hidden'); return; }
    const chapter = E.journeyChapter(state);
    const nodes = chapter.nodes;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const current = byId.get(journey.current);
    const choices = E.journeyChoices(state);
    const choiceIds = new Set(choices.map((node) => node.id));
    const pending = E.journeyNode(journey.pendingRecruit, journey);
    if (pending?.kind === 'town') this._village.open = true;
    if (current?.kind === 'town' && current.enterOnArrival && this._village.nodeId !== current.id) this._village.open = true;
    if (!pending && current?.kind !== 'town') {
      this._village.open = false;
      this._village.dialog = null;
    }
    const villageNode = this._activeVillageNode(state);
    if (villageNode) {
      this.el.journeyBody.className = 'journey-shell village-shell';
      this.el.journeyBody.innerHTML = this._renderVillage(state, villageNode);
      this._bindVillageScreen(state, villageNode);
      this.el.journeyModal.classList.remove('hidden');
      this.el.journeyModal.classList.add('village-mode');
      this._syncVillagePresentation();
      return;
    }
    this.el.journeyBody.className = 'journey-shell';
    this.el.journeyModal.classList.remove('village-mode');
    this.h?.onVillagePresentation?.({ active: false });
    const party = state.field.map((hero) => {
      const C = D.CLASSES[hero.cls];
      return `<span class="journey-party"><i>${C.emoji}</i><b>${hero.name}</b><small>Lv ${hero.level}</small></span>`;
    }).join('');
    const latestNote = E.latestJourneyAnnotation(state);
    const annotation = latestNote
      ? `<aside class="journey-annotation"><span>✎ ${latestNote.title}</span><p>“${latestNote.text}”</p><b>— ${latestNote.speaker}</b><small>${journey.annotations.length}개 수집</small></aside>`
      : '';
    const paths = nodes.flatMap((node) => node.next.map((id) => {
      const to = byId.get(id);
      if (!to) return '';
      const live = node.id === journey.current && choiceIds.has(id);
      const seen = journey.visited.includes(node.id) && journey.visited.includes(id);
      const mx = (node.x + to.x) / 2;
      const my = (node.y + to.y) / 2 - (node.y === to.y ? 2 : 5);
      return `<path d="M ${node.x} ${node.y} Q ${mx} ${my} ${to.x} ${to.y}" class="journey-path${live ? ' live' : ''}${seen ? ' seen' : ''}"/>`;
    })).join('');
    const pins = nodes.map((node) => {
      const info = D.JOURNEY_KIND[node.kind];
      const isCurrent = node.id === journey.current;
      const classes = `journey-node${isCurrent ? ' current' : ''}${choiceIds.has(node.id) ? ' choice' : ''}${journey.visited.includes(node.id) ? ' visited' : ''}${journey.cleared.includes(node.id) ? ' cleared' : ''}`;
      return `<button class="${classes}" style="--x:${node.x}%;--y:${node.y}%;--node:${info.color}" data-travel="${node.id}" ${choiceIds.has(node.id) ? '' : 'disabled'}>
        <span class="journey-node-icon">${node.icon}</span><b>${node.name}</b><small>${info.label}</small>
      </button>`;
    }).join('');
    let action = '';
    if (villageNode) {
      action = this._renderVillage(state, villageNode);
    } else if (journey.complete && chapter.nextChapter) {
      action = `<button class="journey-choice-card win" data-journey-next><span>▤</span><div><b>${chapter.title} 완수</b><p>붉은 성문 뒤에서 출구가 아닌 다음 장이 열렸습니다. 파티와 성장을 그대로 이어갑니다.</p></div><em>다음 장 펼치기</em></button>`;
    } else if (journey.complete && journey.ending) {
      const ending = D.JOURNEY_ENDINGS[journey.ending];
      action = `<div class="journey-choice-card win"><span>${ending.icon}</span><div><b>${ending.name} 엔딩</b><p>${ending.desc}</p></div><em>선택 완료</em></div>`;
    } else if (journey.complete && chapter.endings?.length) {
      const endings = chapter.endings.map((key) => {
        const ending = D.JOURNEY_ENDINGS[key];
        return `<button class="journey-choice-card" data-journey-ending="${key}"><span>${ending.icon}</span><div><b>${ending.name}</b><p>${ending.desc}</p></div><em>이 결말 선택</em></button>`;
      }).join('');
      action = `<div class="journey-action-title"><b>두 책갈피의 마지막 선택</b><span>이 선택은 현재 원정에 한 번만 기록됩니다.</span></div><div class="journey-offers">${endings}</div>`;
    } else if (pending) {
      const offers = pending.offers.map((key) => {
        const spec = D.squadSpec(key);
        const C = D.CLASSES[spec.cls];
        const owned = state.field.some((hero) => hero.heroKey === key);
        return `<button class="journey-choice-card recruit" data-recruit="${key}" ${owned ? 'disabled' : ''}>
          <span class="journey-offer-icon">${C.emoji}</span><div><b>${spec.name} · ${spec.role}</b><p>${owned ? '이미 함께하고 있습니다.' : '함께 원정에 합류합니다.'}</p></div><em>${owned ? '합류' : '영입'}</em>
        </button>`;
      }).join('');
      action = `<div class="journey-action-title"><b>${pending.icon} ${pending.name}</b><span>${pending.text}</span></div><div class="journey-offers">${offers}</div>`;
    } else if (current?.choices && !journey.flags[current.id]) {
      const routes = current.choices.map((choice) =>
        `<button class="journey-choice-card" data-journey-path="${choice.key}"><span>${choice.icon}</span><div><b>${choice.name}</b><p>${choice.text}</p></div><em>${choice.tag}</em></button>`).join('');
      action = `<div class="journey-action-title"><b>${current.icon} 누구의 설명을 기록할까</b><span>선택은 역촌의 지원 세력과 청사진 권한에 이어집니다.</span></div><div class="journey-offers">${routes}</div>`;
    } else {
      const items = choices.map((node) => {
        const info = D.JOURNEY_KIND[node.kind];
        const suffix = node.waves ? ` · 방어 1/${node.waves}` : node.gold ? ` · 보급 +${node.gold}` : '';
        return `<button class="journey-choice-card" data-travel="${node.id}"><span style="color:${info.color}">${node.icon}</span><div><b>${node.name}</b><p>${node.text}</p></div><em>${info.label}${suffix}</em></button>`;
      }).join('');
      const revisitTown = current?.kind === 'town'
        ? '<button class="journey-choice-card recruit" data-village-enter><span>⌂</span><div><b>마을 광장 다시 둘러보기</b><p>대장간·별빛 신전·탐험가 길드에서 전문화를 정합니다.</p></div><em>시설</em></button>'
        : '';
      action = `<div class="journey-action-title"><b>${current?.icon || '✦'} ${current?.name || '별길'}</b><span>${current?.text || ''}</span></div><div class="journey-offers">${revisitTown}${items || '<p class="journey-quiet">이 별길은 아직 조용합니다.</p>'}</div>`;
    }
    this.el.journeyBody.innerHTML = `
      <header class="journey-header">
        <div><span class="journey-kicker">CONSTELLATION EXPEDITION · CHAPTER ${String(chapter.number || 1).padStart(2, '0')}</span><h1>${chapter.title}</h1><p>${chapter.subtitle}</p></div>
        <div class="journey-resources"><span>🏰 ${Math.ceil(state.castleHp)}/${state.castleMax}</span><span>💰 ${state.gold}</span><span>✦ ${state.field.length}/${D.SQUAD_MAX}</span></div>
      </header>
      <div class="journey-party-row">${party}</div>
      ${annotation}
      <div class="journey-map-wrap">
        <div class="journey-moon"></div><div class="journey-ridge ridge-far"></div><div class="journey-ridge ridge-near"></div>
        <div class="journey-haze haze-a"></div><div class="journey-haze haze-b"></div>
        <svg class="journey-lines" viewBox="0 0 100 100" preserveAspectRatio="none">${paths}</svg>
        <div class="journey-constellation">${pins}</div>
        <div class="journey-map-caption">현재 위치에서 이어진 별길만 선택할 수 있습니다.</div>
      </div>
      <footer class="journey-actions">${action}</footer>`;
    this.el.journeyBody.querySelectorAll('[data-travel]').forEach((button) =>
      button.addEventListener('click', () => this.h.onJourneyTravel(button.dataset.travel)));
    this.el.journeyBody.querySelectorAll('[data-recruit]').forEach((button) =>
      button.addEventListener('click', () => this.h.onJourneyRecruit(button.dataset.recruit)));
    this.el.journeyBody.querySelectorAll('[data-journey-path]').forEach((button) =>
      button.addEventListener('click', () => this.h.onJourneyPath(button.dataset.journeyPath)));
    this.el.journeyBody.querySelectorAll('[data-journey-next]').forEach((button) =>
      button.addEventListener('click', () => this.h.onJourneyNextChapter()));
    this.el.journeyBody.querySelectorAll('[data-journey-ending]').forEach((button) =>
      button.addEventListener('click', () => this.h.onJourneyEnding(button.dataset.journeyEnding)));
    this.el.journeyBody.querySelectorAll('[data-village-talk]').forEach((button) =>
      button.addEventListener('click', () => {
        const target = this._villageTargets(state, villageNode).find((entry) => entry.id === button.dataset.villageTalk);
        if (target) this._openVillageTarget(target);
      }));
    this.el.journeyBody.querySelectorAll('[data-village-recruit]').forEach((button) =>
      button.addEventListener('click', () => this.h.onJourneyRecruit(button.dataset.villageRecruit)));
    this.el.journeyBody.querySelectorAll('[data-village-skill]').forEach((button) =>
      button.addEventListener('click', () => this.h.onHeroSkill(Number(button.dataset.heroId), button.dataset.villageSkill)));
    this.el.journeyBody.querySelectorAll('[data-village-close]').forEach((button) =>
      button.addEventListener('click', () => { this._village.dialog = null; this.renderJourney(state); }));
    this.el.journeyBody.querySelectorAll('[data-village-leave]').forEach((button) =>
      button.addEventListener('click', () => { this._village.open = false; this._village.dialog = null; this.renderJourney(state); }));
    this.el.journeyBody.querySelectorAll('[data-village-enter]').forEach((button) =>
      button.addEventListener('click', () => { this._village.open = true; this._village.dialog = null; this.renderJourney(state); }));
    this.el.journeyBody.querySelectorAll('[data-village-ground]').forEach((ground) =>
      ground.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        const rect = ground.getBoundingClientRect();
        this._moveVillage(((event.clientX - rect.left) / rect.width) * 100, ((event.clientY - rect.top) / rect.height) * 100);
      }));
    this.el.journeyModal.classList.toggle('hidden', state.phase !== 'journey');
  }

  /* ---------- 오른쪽 패널 탭 ----------
   * 세 패널을 세로로 쌓으면 화면 두 배 길이가 된다 — 한 번에 하나만 보여 준다. */
  showTab(name) {
    this._tab = name;
    this.el.tabs.querySelectorAll('button').forEach(b =>
      b.classList.toggle('on', b.dataset.tab === name));
    document.querySelectorAll('.tabbody .pane').forEach(p =>
      p.classList.toggle('hidden', p.dataset.pane !== name));
    if (name === 'hero') this.el.heroDot.classList.add('hidden');
    if (name === 'squad') this.el.combineDot.classList.add('hidden');
  }
  /* ---------- 배치 중 안내 ----------
   * 전장 위 UI(웨이브 버튼 · 별지기 칩)가 하필 아래쪽 발판을 덮고 있어서,
   * 배치하는 동안에는 .placing 으로 비켜 준다. 안내 바는 전장 아래에 둔다 —
   * 위에 얹으면 또 발판을 가리니 안내가 방해가 된다.
   * hero 가 null 이면 배치 중이 아니다. */
  setPlacing(hero, label) {
    const on = !!hero;
    const stage = this.el.scene3d.parentElement;
    if (stage) stage.classList.toggle('placing', on);
    /* 바는 나타났다 사라지지 않는다 — 늘 같은 자리를 차지하고 문구만 바뀐다.
     * 배치할 때만 띄웠더니, 카드를 누르는 순간 벤치가 70px 아래로 밀려
     * 방금 누른 카드가 손가락 밑에서 도망갔다. 고치려던 문제를 새로 만든 셈. */
    this.el.placeBar.classList.toggle('on', on);
    this.el.placeBarText.textContent = on
      ? label
      : '✦ 영웅 카드를 눌러 방어로 옆 발판에 배치하세요';
  }

  /* 용사를 고르면 잠깐 용사 탭으로 넘어갔다가, 선택을 풀면 원래 보던 탭으로 돌아온다 */
  showHeroTab() {
    if (this._tab === 'hero') return;
    this._tabBefore = this._tab;
    this.showTab('hero');
  }
  restoreTab() {
    if (this._tab !== 'hero') return;
    this.showTab(this._tabBefore || 'squad');
    this._tabBefore = null;
  }

  bind(h) {
    this.h = h;
    const el = this.el;
    el.waveBtn.addEventListener('click', h.onWaveStart);
    el.summonBtn.addEventListener('click', h.onSummon);
    el.placeBarCancel.addEventListener('click', h.onCancelPlace);
    el.speedBtn.addEventListener('click', h.onSpeed);
    el.sfxBtn.addEventListener('click', h.onToggleSfx);
    el.bgmBtn.addEventListener('click', h.onToggleBgm);
    el.effectsBtn.addEventListener('click', h.onToggleEffects);
    el.settingsBtn.addEventListener('click', h.onSettingsOpen);
    el.settingsClose.addEventListener('click', h.onSettingsClose);
    el.settingsLanguage.addEventListener('change', () => h.onSettingsLanguage(el.settingsLanguage.value));
    el.settingsGfx.addEventListener('change', () => h.onSettingsGraphics(el.settingsGfx.value));
    el.settingsEffects.addEventListener('change', () => h.onSettingsEffects(el.settingsEffects.value));
    el.settingsSfxBtn.addEventListener('click', h.onToggleSfx);
    el.settingsBgmBtn.addEventListener('click', h.onToggleBgm);
    el.settingsKeyReset.addEventListener('click', h.onSettingsKeyReset);
    el.settingsKeyRows.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-key-action]');
      if (button) h.onSettingsKeyCapture(button.dataset.keyAction);
    });
    el.metaBtn.addEventListener('click', h.onMetaOpen);
    el.overMetaBtn.addEventListener('click', h.onMetaOpen);
    el.metaClose.addEventListener('click', () => this.hideMeta());
    /* 도감·기록 */
    el.bookBtn.addEventListener('click', () => h.onBookOpen());
    el.bookClose.addEventListener('click', () => this.hideBook());
    el.bookTabs.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        this._bookTab = b.dataset.btab;
        el.bookTabs.querySelectorAll('button').forEach(v => v.classList.toggle('on', v === b));
        this._renderBookBody();
      });
    });
    /* 서른 번째 아침 (승리) */
    el.victoryTrialBtn.addEventListener('click', () => h.onTrial());
    el.victoryContinueBtn.addEventListener('click', () => h.onVictoryContinue());
    el.victoryShareBtn.addEventListener('click', h.onShare);
    el.restartBtn.addEventListener('click', h.onRestart);
    el.shareBtn.addEventListener('click', h.onShare);
    el.recallBtn.addEventListener('click', () => h.onRecall());
    el.sellBtn.addEventListener('click', () => h.onSell());
    el.heroActiveBtn.addEventListener('click', () => h.onHeroActive(Number(el.heroActiveBtn.dataset.heroId)));
    el.combatHeroActiveBtn.addEventListener('click', () => h.onHeroActive(Number(el.combatHeroActiveBtn.dataset.heroId)));
    el.combatSkillDock.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-hero-id]');
      if (button) h.onHeroActive(Number(button.dataset.heroId));
    });
    el.combatBlueprintBtn.addEventListener('click', () => h.onMonsterBlueprint());
    el.combatConstellationBtn.addEventListener('click', () => h.onConstellationAid());
    /* 저장/불러오기 — "간단한 파일" 하나로 오간다 */
    el.saveBtn.addEventListener('click', () => h.onSave());
    el.loadBtn.addEventListener('click', () => el.loadFile.click());
    el.playtestBtn.addEventListener('click', () => h.onPlaytestExport());
    el.loadFile.addEventListener('change', () => {
      const f = el.loadFile.files && el.loadFile.files[0];
      el.loadFile.value = '';               // 같은 파일을 다시 골라도 change가 오게
      if (!f) return;
      f.text()
        .then(t => { let d = null; try { d = JSON.parse(t); } catch { /* 형식 오류 */ } h.onLoad(d); })
        .catch(() => h.onLoad(null));
    });
    /* 여러 명 판매 */
    el.sellModeBtn.addEventListener('click', () => h.onSellMode());
    el.sellAllBtn.addEventListener('click', () => h.onSellAll());
    el.sellGoBtn.addEventListener('click', () => h.onSellGo());
    /* 시작 메뉴 (이어하기 / 처음부터) */
    el.continueBtn.addEventListener('click', () => h.onContinue());
    el.newGameBtn.addEventListener('click', () => h.onStartNew());
    /* 별지기 */
    el.spellBtn.addEventListener('click', () => h.onSpell());
    el.ultBtn.addEventListener('click', () => h.onUlt());
    el.skillBtn.addEventListener('click', () => h.onSkillOpen());
    el.skillClose.addEventListener('click', () => this.hideSkills());
    /* 옷장 — 초상을 누르면 열린다 */
    el.champFace.addEventListener('click', () => h.onClosetOpen());
    el.closetSave.addEventListener('click', () => h.onClosetSave());
    el.closetClose.addEventListener('click', () => h.onClosetClose());
    /* 이름 입력창의 키는 게임 단축키로 새면 안 된다 (Esc만 통과시킨다) */
    el.closetName.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') ev.stopPropagation();
      if (ev.key === 'Enter') h.onClosetSave();
    });
    el.demoBtn.addEventListener('click', h.onDemoToggle);
    el.spectateBtn.addEventListener('click', h.onDemoToggle);
    el.demoExit.addEventListener('click', h.onDemoToggle);
    el.storyNext.addEventListener('click', h.onStoryClose);
    el.storyOff.addEventListener('click', h.onStoryOff);
    el.revealModal.addEventListener('click', h.onRevealClose);
    el.diffRow.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => h.onDiff(b.dataset.d));
    });
    el.tabs.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => { this._tabBefore = null; this.showTab(b.dataset.tab); });
    });
    /* 조작법은 접어 둔다 — 필요할 때만 펼치고, 평소엔 전장이 그만큼 커진다 */
    el.helpBtn.addEventListener('click', () => {
      const open = el.helpBox.classList.toggle('hidden');
      el.helpBtn.classList.toggle('on', !open);
    });

    /* 3D 씬 입력 */
    const scene = el.scene3d;
    scene.addEventListener('click', (ev) => {
      /* 드래그를 끝낸 직후에도 click이 한 번 더 온다 — 그건 무시한다 */
      if (this._afterDrag) return;
      h.onSceneClick(ev.clientX, ev.clientY);
    });
    scene.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();                 // 우클릭 = 즉시 회수
      h.onSceneRightClick(ev.clientX, ev.clientY);
    });
    scene.addEventListener('mousemove', (ev) => {
      if (this._drag) return;              // 드래그 중에는 onDragMove가 담당
      h.onSceneMove(ev.clientX, ev.clientY);
    });
    scene.addEventListener('mouseleave', () => { if (!this._drag) h.onSceneMove(null, null); });

    /* --- 끌어서 옮기기 / 자리 바꾸기 ---
     * 배치된 용사를 집어서 다른 발판에 놓으면 이동하고, 이미 용사가 있으면 서로 자리를 바꾼다.
     * pointer 이벤트라 마우스·터치·펜이 모두 같은 코드로 동작한다. */
    scene.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      this._down = { x: ev.clientX, y: ev.clientY, ok: false, moved: false };
    });
    window.addEventListener('pointermove', (ev) => {
      const d = this._down;
      if (!d) return;
      if (!d.moved && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 6) {
        d.moved = true;
        d.ok = h.onDragStart(d.x, d.y);    // 집은 지점 기준으로 판정
        if (d.ok) { this._drag = true; scene.classList.add('dragging'); this.hideTooltip(); }
      }
      if (d.ok) h.onDragMove(ev.clientX, ev.clientY);
    });
    window.addEventListener('pointerup', (ev) => {
      const d = this._down;
      this._down = null;
      if (!d || !d.ok) return;
      this._drag = false;
      scene.classList.remove('dragging');
      h.onDragEnd(ev.clientX, ev.clientY);
      /* 이어서 날아오는 click 한 번만 삼킨다 */
      this._afterDrag = true;
      setTimeout(() => { this._afterDrag = false; }, 0);
    });
    /* 창 밖으로 나가거나 터치가 취소돼도 "잡은 채로" 남지 않게 */
    window.addEventListener('pointercancel', () => {
      if (!this._down) return;
      this._down = null;
      this._drag = false;
      scene.classList.remove('dragging');
      h.onDragEnd(null, null);
    });
  }

  /* ---------- HUD ---------- */
  updateHud(state, shards, best) {
    const el = this.el;
    document.body.classList.toggle('combat-focus', state.phase === 'wave');
    el.gold.textContent = state.gold;
    const journeyProgress = E.journeyBattleProgress(state);
    el.waveNo.textContent = journeyProgress ? `${journeyProgress.step}/${journeyProgress.total}` : state.wave;
    el.waveLabel.textContent = journeyProgress ? '방어' : '웨이브';
    /* 별의 시련 회차 — 1회차(첫 여정)에는 조용히 숨긴다 */
    const loop = state.loop || 0;
    if (this._loopN !== loop) {
      this._loopN = loop;
      el.loopChip.classList.toggle('hidden', !loop);
      el.loopChip.textContent = loop ? `🌟${loop + 1}회차` : '';
      el.loopChip.title = loop ? `별의 시련 ${loop + 1}회차 — 몬스터 체력 ×${D.loopHpMul(loop).toFixed(2)}` : '';
    }
    el.shards.textContent = shards;
    el.bestWave.textContent = best || '-';
    el.castleText.textContent = `${state.castleHp} / ${state.castleMax}`;
    const pct = state.castleMax ? (state.castleHp / state.castleMax) * 100 : 0;
    el.castleFill.style.width = `${pct}%`;
    el.castleGhost.style.width = `${pct}%`;
    this.updateLanePressure(state);
    this.updateMonsterBlueprint(state);
    this.updateConstellationAid(state);
    /* 소환 버튼도 "왜 안 눌리는지"를 버튼 얼굴에 적는다 — 회색이 된 이유가 돈인지 자리인지 보이게 */
    const canPay = state.gold >= D.SUMMON_COST;
    const benchFull = state.bench.length >= D.BENCH_MAX;
    el.summonBtn.disabled = !canPay || benchFull || state.phase === 'over';
    el.summonBtn.classList.toggle('lack', !canPay && !benchFull);
    el.summonBtn.textContent = benchFull
      ? '🧺 벤치가 가득 찼어요 — 배치하거나 팔아요'
      : canPay ? `🎲 용사 소환 (💰 ${D.SUMMON_COST} · S)`
        : `💰${D.SUMMON_COST - state.gold} 더 모으면 소환! (💰${D.SUMMON_COST} 필요 · 지금 💰${state.gold})`;

  }

  updateLanePressure(state) {
    const pressure = combatLanePressure(state);
    const signature = pressure.map((lane) => `${lane.count}:${lane.fill}:${lane.tier}`).join('|');
    if (signature === this._lanePressureSignature) return;
    this._lanePressureSignature = signature;
    for (const lane of pressure) {
      const element = this.el.lanePressure.querySelector(`[data-route="${lane.route}"]`);
      if (!element) continue;
      element.classList.remove('clear', 'watch', 'pressed', 'critical');
      element.classList.add(lane.tier);
      element.querySelector(':scope > i > i').style.width = `${lane.fill}%`;
      element.querySelector('em').textContent = lane.count ? `${lane.label} · ${lane.count}` : lane.label;
      element.title = `${lane.name} 길 · ${lane.count ? `적 ${lane.count}기 · 최전선 ${Math.round(lane.maxProgress * 100)}%` : '적 없음'}`;
    }
  }

  updateMonsterBlueprint(state) {
    const el = this.el;
    const spec = E.availableMonsterBlueprint(state);
    el.combatBlueprintBar.classList.toggle('hidden', !spec);
    if (!spec) return;
    const status = E.canCastMonsterBlueprint(state);
    const routeNames = ['왼쪽', '가운데', '오른쪽'];
    const active = (state.blueprintSummons || []).find((summon) => summon.blueprint === spec.key);
    el.combatBlueprintName.textContent = `${spec.emoji} ${spec.name}`;
    el.combatBlueprintRole.textContent = active
      ? `${routeNames[active.route]} 길 지원 중 · ${Math.max(0, active.life).toFixed(1)}초`
      : status.ok
        ? `${routeNames[status.target.route]} 길이 가장 위험합니다 · 방어당 1회`
        : status.reason === 'charge' ? '이번 방어의 청사진을 이미 사용했습니다.'
          : status.reason === 'none' ? '적이 나타나면 가장 위험한 길을 자동 선택합니다.'
            : '전투 중에만 소환할 수 있습니다.';
    el.combatBlueprintBtn.disabled = !status.ok;
    el.combatBlueprintBtn.classList.toggle('ready', status.ok);
    el.combatBlueprintBtn.textContent = status.ok
      ? `${spec.emoji} ${routeNames[status.target.route]} 소환`
      : active ? '지원 중' : status.reason === 'charge' ? '사용 완료' : '소환 대기';
    el.combatBlueprintBtn.title = `${spec.desc} · G`;
  }

  updateConstellationAid(state) {
    const el = this.el;
    const spec = D.TACTICS.constellationAid;
    const status = E.canCastConstellationAid(state);
    const active = (state.constellationAids || [])[0];
    const charge = state.constellationAid?.charge || 0;
    const english = getLocale() === 'en';
    const routeNames = english ? ['Left', 'Center', 'Right'] : ['왼쪽', '가운데', '오른쪽'];
    el.combatConstellationName.textContent = english
      ? `✦ Constellation Aid ${charge}/${spec.chargeNeeded}`
      : `✦ 별자리 지원 ${charge}/${spec.chargeNeeded}`;
    el.combatConstellationRole.textContent = active
      ? english ? `Guarding ${routeNames[active.route]} · ${Math.max(0, active.life).toFixed(1)}s`
        : `${routeNames[active.route]} 길 수호 중 · ${Math.max(0, active.life).toFixed(1)}초`
      : status.ok
        ? english ? 'Constellation complete · hold it for a boss'
          : '성좌 완성 · 보스가 올 때까지 보류할 수 있어요'
        : charge < spec.chargeNeeded
          ? english ? '4-match +1 · straight 5 +2 · Hero Sigil +3'
            : '4매치 +1 · 직선 5매치 +2 · 영웅 문양 +3 인장'
          : status.reason === 'none' ? english ? 'It will assist the most threatened lane' : '적이 나타나면 가장 위급한 길을 돕습니다'
            : english ? 'The guardian can only be called in battle' : '전투 중에만 별자리 수호자를 부를 수 있어요';
    el.combatConstellationBtn.disabled = !status.ok;
    el.combatConstellationBtn.classList.toggle('ready', status.ok);
    el.combatConstellationBtn.textContent = status.ok
      ? english ? `✦ Call ${routeNames[status.target.route]}` : `✦ ${routeNames[status.target.route]} 길 호출`
      : active ? english ? 'Guarding' : '수호 중'
        : charge >= spec.chargeNeeded ? english ? 'Awaiting enemy' : '적 대기'
          : english ? `Marks ${charge}/${spec.chargeNeeded}` : `성좌 ${charge}/${spec.chargeNeeded}`;
    el.combatConstellationBtn.title = english
      ? 'A Guardian charged by large matches or a Hero Sigil can be held for a boss.'
      : '큰 매치나 영웅 문양으로 충전한 별자리 수호자는 보스까지 아껴 둘 수 있습니다.';
  }

  setWaveUI(state, autoStartSeconds = null) {
    const el = this.el;
    const journeyProgress = E.journeyBattleProgress(state);
    const encounter = E.journeyEncounter(state);
    const stageLabel = journeyProgress
      ? `${journeyProgress.node.name} · 방어 ${journeyProgress.step}/${journeyProgress.total}`
      : `${state.wave}웨이브`;
    if (state.phase === 'prep') {
      const seconds = Number.isFinite(autoStartSeconds) ? Math.max(1, Math.ceil(autoStartSeconds)) : null;
      const countdown = seconds != null
        ? ` · 자동 ${seconds}초`
        : '';
      const encounterIcon = encounter.boss ? ' 🐉' : (encounter.midBoss ? ' 👿' : '');
      el.waveBtn.textContent = `▶ ${stageLabel} 시작!${encounterIcon}${countdown} (Space)`;
      el.waveBtn.classList.toggle('auto-next', !!countdown);
      el.waveBtn.classList.remove('hidden');
      el.waveInfo.classList.add('hidden');
      el.phaseCountdown.classList.toggle('hidden', seconds == null);
      if (seconds != null) {
        const english = getLocale() === 'en';
        el.phaseCountdown.querySelector('span').textContent = english ? 'Next defense begins' : '다음 방어가 시작됩니다';
        el.phaseCountdown.querySelector('small').textContent = english ? 'Auto start · Space starts now' : '초 뒤 자동 시작 · Space로 즉시 시작';
        el.phaseCountdownNum.textContent = seconds;
      }
    } else if (state.phase === 'wave') {
      el.waveBtn.classList.remove('auto-next');
      el.waveBtn.classList.add('hidden');
      el.wavePreview.classList.add('hidden');
      el.waveInfo.classList.remove('hidden');
      el.phaseCountdown.classList.add('hidden');
      el.remainN.textContent = `${stageLabel} · 남은 몬스터 ${E.remainingEnemies(state)}`;
    } else {
      el.waveBtn.classList.remove('auto-next');
      el.waveBtn.classList.add('hidden');
      el.wavePreview.classList.add('hidden');
      el.waveInfo.classList.add('hidden');
      el.phaseCountdown.classList.add('hidden');
    }
    /* 난이도는 게임 시작 전(1웨이브 준비)에만 변경 가능 */
    const canDiff = state.phase === 'prep' && state.wave === 1;
    this.el.diffRow.querySelectorAll('button').forEach(b => {
      b.disabled = !canDiff;
      b.classList.toggle('on', b.dataset.d === state.difficulty);
    });
  }

  showDefenseVictory({ name, total, state }) {
    const english = getLocale() === 'en';
    this.el.defenseVictoryTitle.textContent = english ? `${name} defended!` : `${name} 방어 성공!`;
    this.el.defenseVictoryDetail.textContent = english
      ? `Defense ${total}/${total} complete · Citadel ${state.castleHp}/${state.castleMax} · Choose the next star road.`
      : `방어 ${total}/${total} 완료 · 성 체력 ${state.castleHp}/${state.castleMax} · 다음 별자리 길을 고르세요.`;
    this.el.defenseVictory.classList.remove('hidden');
    clearTimeout(this._defenseVictoryT);
    this._defenseVictoryT = setTimeout(() => this.hideDefenseVictory(), 2600);
  }

  hideDefenseVictory() {
    clearTimeout(this._defenseVictoryT);
    this.el.defenseVictory.classList.add('hidden');
  }

  isDefenseVictoryOpen() { return !this.el.defenseVictory.classList.contains('hidden'); }

  /* 콤보 칩 — 매 프레임 호출되므로 "값이 바뀔 때만" 다시 그린다.
   * (전에는 프레임마다 pop 애니메이션을 재시작해 글자가 계속 떨려 보였다) */
  comboChip(count, mul) {
    const el = this.el.comboChip;
    if (count >= 2) {
      if (this._comboCount !== count || this._comboMul !== mul) {
        this._comboCount = count;
        this._comboMul = mul;
        el.textContent = mul > 1 ? `🔥 콤보 ${count} · 골드 ${mul}배!` : `🔥 콤보 ${count}`;
        el.classList.remove('hidden');
        el.classList.toggle('boost', mul > 1);
        /* 배율이 올라가는 순간에만 튀어오르게 */
        if (this._comboMul !== this._popMul) {
          this._popMul = this._comboMul;
          el.classList.remove('pop');
          void el.offsetWidth;
          el.classList.add('pop');
        }
      }
    } else if (this._comboCount != null) {
      this._comboCount = null;
      this._comboMul = null;
      this._popMul = null;
      el.classList.add('hidden');
      el.classList.remove('pop', 'boost');
    }
  }

  /* ---------- 벤치 ----------
   * sell(Set)이 오면 판매 모드: 카드가 체크박스가 된다 — 가격을 크게, 고르면 ✓ */
  renderSquad(state, selId) {
    const el = this.el.bench;
    el.classList.add('hero-card-grid');
    el.innerHTML = '';
    for (const hero of state.field) {
      const d = document.createElement('button');
      const card = heroCardClass(hero, selId === hero.id);
      d.type = 'button';
      d.className = card.className;
      d.style.cssText = card.style;
      d.setAttribute('aria-label', card.ariaLabel);
      d.setAttribute('aria-pressed', String(selId === hero.id));
      d.innerHTML = heroCardMarkup(hero);
      d.addEventListener('click', () => this.h.onSquadSelect(hero.id));
      d.addEventListener('mouseenter', (ev) => this.showTooltip(hero, state, ev.clientX, ev.clientY));
      d.addEventListener('mousemove', (ev) => this.moveTooltip(ev.clientX, ev.clientY));
      d.addEventListener('mouseleave', () => this.hideTooltip());
      el.appendChild(d);
    }
    this.el.benchHint.classList.add('hidden');
  }

  renderSquadGrowth(state) {
    const ready = state.field.filter((hero) => hero.sp > 0);
    const currentNode = E.journeyNode(state.journey?.current, state);
    this.el.combineDot.classList.toggle('hidden', this._tab === 'squad' || !ready.length);
    const rows = state.field.map((hero) => {
      const C = D.CLASSES[hero.cls];
      const need = D.heroXpNeed(hero.level);
      const facilityId = D.facilityForHero(hero.heroKey);
      const facility = D.HERO_FACILITIES[facilityId];
      const atFacility = state.phase === 'journey' && currentNode?.kind === 'town' && currentNode.facilities?.includes(facilityId);
      const skills = Object.entries(D.HERO_SKILLS)
        .filter(([, skill]) => skill.cls === hero.cls)
        .map(([key, skill]) => {
          const rank = hero.skills[key] || 0;
          const locked = hero.level < skill.level;
          const capped = rank >= skill.max;
          const enabled = atFacility && hero.sp > 0 && !locked && !capped;
          const label = capped ? `완료 ${rank}/${skill.max}` : locked ? `Lv ${skill.level} 필요` : atFacility ? `포인트 1 · ${rank}/${skill.max}` : `${facility?.emoji || '⌂'} ${facility?.name || '마을 시설'}에서 선택`;
          return `<button class="growth-skill${enabled ? ' ready' : ''}" data-hero-id="${hero.id}" data-skill="${key}" ${enabled ? '' : 'disabled'}>
            <span>${skill.emoji} <b>${skill.name}</b></span><small>${skill.per} · ${label}</small>
          </button>`;
        }).join('');
      return `<section class="growth-hero">
        <header><span>${C.emoji} <b>${hero.name || C.name}</b> <small>${C.name}</small></span><strong>Lv ${hero.level}</strong></header>
        <div class="growth-xp"><i style="width:${Math.min(100, (hero.xp / need) * 100)}%"></i></div>
        <p>경험치 ${Math.round(hero.xp)}/${need} · 전문화 포인트 <b>${hero.sp}</b></p>
        <p class="growth-facility">${facility?.emoji || '⌂'} ${facility?.name || '마을 시설'}${atFacility ? '에서 전문화를 선택할 수 있습니다.' : '에서만 전문화를 선택할 수 있습니다.'}</p>
        <div class="growth-skills">${skills}</div>
      </section>`;
    }).join('');
    this.el.combineRows.innerHTML = `<p class="growth-note">전투 처치와 웨이브 완료로 경험치를 얻습니다. 포인트가 생기면 한 영웅의 역할을 깊게 만드세요.</p>${rows}`;
    this.el.combineRows.insertAdjacentHTML('afterbegin', '<p class="growth-note growth-note-facility">전투에서 얻은 전문화 포인트는 원정 지도 속 마을 시설에서만 사용합니다.</p>');
    this.el.combineRows.querySelectorAll('button[data-skill]').forEach((button) =>
      button.addEventListener('click', () => this.h.onHeroSkill(Number(button.dataset.heroId), button.dataset.skill)));
  }

  renderBench(state, selId, sell = null) {
    const el = this.el.bench;
    el.classList.remove('hero-card-grid');
    if (!state.bench.length) {
      el.innerHTML = '<div class="empty-msg">벤치가 비어 있어요.<br>용사를 소환해 보세요!</div>';
      this.el.benchHint.classList.add('hidden');
      return;
    }
    el.innerHTML = '';
    for (const hero of state.bench) {
      const C = D.CLASSES[hero.cls], T = D.TIERS[hero.tier];
      const d = document.createElement('div');
      const selling = !!sell && sell.has(hero.id);
      d.className = `hcard t${hero.tier}` + (selId === hero.id ? ' sel' : '') + (C.special ? ' sp' : '')
        + (sell ? ' sellable' : '') + (selling ? ' sellsel' : '');
      const m = E.heroMods(hero);
      const rl = rangeLabel(m.range);
      /* 사거리를 카드에 직접 표시 — 배치 판단의 핵심 정보 */
      const badges = [
        m.crit ? '<span class="bdg">💥</span>' : '',
        m.block ? '<span class="bdg">🛡️</span>' : '',
        m.splash ? '<span class="bdg">✹</span>' : '',
      ].join('');
      d.innerHTML =
        `<div class="em">${C.emoji}${badges ? `<span class="bdgs">${badges}</span>` : ''}</div>` +
        `<div class="nm">${C.name}</div>` +
        (sell
          ? `<div class="sellprice">💰${D.SELL_PRICE[hero.tier]}</div>`
          : `<div class="rg ${rl.cls}">🎯${m.range}</div>`) +
        `<div class="tr">${T.name}</div>` +
        (selling ? '<div class="sellcheck">✓</div>' : '');
      d.addEventListener('click', () =>
        sell ? this.h.onSellToggle(hero.id) : this.h.onBenchSelect(hero.id));
      d.addEventListener('mouseenter', (ev) => this.showTooltip(hero, state, ev.clientX, ev.clientY));
      d.addEventListener('mousemove', (ev) => this.moveTooltip(ev.clientX, ev.clientY));
      d.addEventListener('mouseleave', () => this.hideTooltip());
      el.appendChild(d);
    }
    this.el.benchHint.classList.toggle('hidden', sell != null || selId == null);
  }

  /* 판매 모드 바 — 고른 인원과 받을 골드를 항상 보여 준다 */
  renderSellBar(state, on, sel) {
    const el = this.el;
    el.sellModeBtn.textContent = on ? '✕ 판매 끝내기 (Esc)' : '💰 여러 명 판매';
    el.sellModeBtn.classList.toggle('on', on);
    el.sellInfo.classList.toggle('hidden', !on);
    el.sellAllBtn.classList.toggle('hidden', !on);
    el.sellGoBtn.classList.toggle('hidden', !on);
    if (!on) return;
    const picked = state.bench.filter(h => sel.has(h.id));
    const total = picked.reduce((s, h) => s + D.SELL_PRICE[h.tier], 0);
    el.sellInfo.textContent = picked.length
      ? `${picked.length}명 선택 · 💰${total}`
      : '카드를 눌러 골라요';
    const allPicked = state.bench.length > 0 && picked.length === state.bench.length;
    el.sellAllBtn.textContent = allPicked ? '전체 해제' : '전체 선택';
    el.sellGoBtn.textContent = picked.length ? `💰${total} 받고 팔기` : '팔기';
    el.sellGoBtn.disabled = !picked.length;
  }

  /* 부족한 재료가 "조합으로만 나오는 직업"일 때, 그 레시피 줄로 데려다 준다.
   * 말로 "마검사부터 만드세요"라고 쓰는 것보다 눈으로 짚어 주는 편이 확실하다. */
  gotoRecipe(cls) {
    const row = [...this.el.combineRows.querySelectorAll('.combine-row.recipe')]
      .find(el => { const p = el.querySelector('.peek'); return p && p.dataset.cls === cls; });
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
  }

  /* ---------- 조합 (3세대 도감: 등급업 / 특수 / 신화) ---------- */
  renderCombine(state) {
    const combos = E.listCombos(state);
    /* 다른 탭을 보고 있어도 "지금 조합할 수 있다"를 놓치지 않게 점을 찍는다 */
    this.el.combineDot.classList.toggle('hidden',
      this._tab === 'combine' || !combos.some(c => c.affordable));
    const byResult = new Map(combos.filter(c => c.kind === 'recipe').map(c => [c.result, c]));
    let html = '';

    /* 성좌 공명은 조합 자체를 막지 않는다. 작은 합을 맞추면 길 하나가 이번 웨이브에
     * 강해지는 보너스라, 숫자를 싫어하는 플레이어도 평소처럼 조합할 수 있다. */
    const resonance = state.resonance || { targets: [], active: [] };
    const resBadge = (combo) => {
      const value = E.comboStarValue(combo);
      const lanes = E.matchingResonanceLanes(state, combo);
      const fresh = lanes.find(lane => !resonance.active[lane]);
      const label = fresh == null ? `✦합 ${value}` : `✦합 ${value} · ${['←', '↑', '→'][fresh]} 공명`;
      return `<span class="res-badge${fresh == null ? '' : ' match'}">${label}</span>`;
    };
    const bonusPct = Math.round((D.RESONANCE_DAMAGE_MUL - 1) * 100);
    html += `<div class="resonance-card">
      <div class="resonance-title"><b>✦ 성좌 공명</b><span>조합의 별 합을 길에 맞춰요</span></div>
      <div class="resonance-lanes">${resonance.targets.map((target, lane) =>
        `<span class="resonance-lane${resonance.active[lane] ? ' active' : ''}"><b>${['← 왼쪽', '↑ 가운데', '→ 오른쪽'][lane]}</b><strong>✦ ${target}</strong>${resonance.active[lane] ? '<em>공명 중</em>' : '<small>대기</small>'}</span>`
      ).join('')}</div>
      <p>조합의 <b>✦합</b>이 길 숫자와 같으면, 그 길에 가하는 용사 피해가 이번 웨이브 <b>+${bonusPct}%</b>. 맞지 않아도 조합은 그대로 완성돼요.</p>
    </div>`;

    /* 지금 당장 되는 것을 맨 위에 모은다 — 아이는 스크롤하지 않는다.
     * "확실히 알고, 되면 착착"의 핵심이라 규칙 안내보다도 위에 둔다. */
    const ready = combos.filter(c => c.affordable);
    if (ready.length) {
      html += `<div class="combine-now"><div class="now-title">⚡ 지금 바로 조합!</div>`;
      for (const c of ready) {
        const R = D.CLASSES[c.result];
        const what = c.kind === 'rankup'
          ? `${D.CLASSES[c.cls].emoji} ${D.CLASSES[c.cls].name} ${D.TIERS[c.tier].name}×2`
          : `${D.CLASSES[c.a].emoji}+${D.CLASSES[c.b].emoji}`;
        html += `<button class="now-btn" data-kind="${c.kind}"
          ${c.kind === 'rankup' ? `data-cls="${c.cls}" data-tier="${c.tier}"` : `data-result="${c.result}"`}
          style="border-color:${D.TIERS[c.resultTier].color}">
          <span class="now-what">${what}</span>
          <span class="now-arrow">→</span>
          <span class="now-res" style="color:${D.TIERS[c.resultTier].color}">${R.emoji} ${D.TIERS[c.resultTier].name} ${R.name}</span>
          ${resBadge(c)}
          <span class="now-cost">💰${c.cost}</span>
        </button>`;
      }
      html += `</div>`;
    }

    /* 규칙을 화면에 못 박아 둔다 — 헷갈리면 조합을 안 하게 된다 */
    html += `<div class="combine-rule">
      <b>규칙</b> 조합은 <b>같은 등급 2명</b>끼리만! ① 같은 직업 = 등급 UP ② 다른 직업 = 새 직업(등급 UP)<br>
      <b>모든 직업이 신화까지</b> 올라요 — 전설 2명이면 신화! 그중에서도 ⚡😇🌌 신화 용사가 최강<br>
      <b>🌌 전술판</b>은 전투 중에만 작동해요. 별을 맞춘 <b>열</b>이 길을 고르고, 별의 <b>색</b>이 유성·서리·수호 전술을 정해요.<br>
      조합은 준비 단계에서 <b>골드만</b> 내면 바로 완성돼요 — 전투 중엔 별자리로 진형을 지키세요
    </div>`;

    /* 돈이 모자란 줄이 "지금 된다"처럼 보이면 안 된다.
     * 얼마가 모자란지 동전으로 적어 주고(버튼 옆), 버튼은 아예 잠근다 —
     * 눌러 봤자 토스트만 뜨는 버튼은 "되는 줄 알았는데"라는 실망만 남긴다. */
    const shortBadge = (cost) => state.gold >= cost ? ''
      : `<span class="gshort" title="골드가 💰${cost - state.gold} 모자라요 (필요 💰${cost} · 지금 💰${state.gold})">💰${cost - state.gold} 부족</span>`;

    /* ① 등급업 — 같은 용사 2명 */
    const rankups = combos.filter(c => c.kind === 'rankup');
    html += `<div class="combine-sub">⬆ 등급업 <span class="cnt">같은 용사·같은 등급 2명 (배치된 용사도 재료 OK)</span></div>`;
    if (!rankups.length) {
      html += `<div class="combine-empty">같은 직업·같은 등급 용사 2명을 모아 보세요</div>`;
    }
    /* 전설에서 막힌 용사가 있으면 왜 막혔는지 알려준다 */
    const capped = [...new Set([...state.bench, ...state.field]
      .filter(h => h.tier >= D.maxTierOf(h.cls) && !D.CLASSES[h.cls].mythic)
      .map(h => h.cls))];
    if (capped.length) {
      html += `<div class="combine-empty">${capped.map(c => D.CLASSES[c].emoji).join('')} 전설은 최고 등급이에요 —
        <b>신화</b>가 되려면 아래 <b>신화 조합</b>으로 신화 용사를 만들어야 해요</div>`;
    }
    for (const c of rankups) {
      const C = D.CLASSES[c.cls];
      html += `<div class="combine-row${c.affordable ? ' ready' : ' broke'}">
        <span class="peek" data-cls="${c.cls}" data-rtier="${c.resultTier}">${C.emoji}</span> ${C.name}
        <span class="cnt" style="color:${D.TIERS[c.tier].color}">${D.TIERS[c.tier].name}×2</span>
        ${resBadge(c)}
        ${shortBadge(c.cost)}
        <button data-kind="rankup" data-cls="${c.cls}" data-tier="${c.tier}"
          class="${!c.affordable ? 'lack' : ''}" ${!c.affordable ? 'disabled' : ''}>⚗ ${D.TIERS[c.resultTier].name} 💰${c.cost}</button>
      </div>`;
    }

    /* ②③ 레시피 도감 — 특수(2세대) / 신화(3세대)
     * "재료 하나 더"라고만 쓰면 무엇이 모자란지 알 수가 없다.
     * 부족한 재료를 크게 그리고, 그 자리에서 바로 할 행동(소환/선행 조합)을 준다. */
    const RECIPE_STATE_LABEL = {
      ready: '', gold: '골드 부족', material: '재료 필요', cap: '등급 천장', gap: '등급 안 맞음',
    };
    const renderRecipes = (gen) => {
      let out = '';
      for (const r of D.RECIPES.filter(x => x.gen === gen)) {
        const A = D.CLASSES[r.a], B = D.CLASSES[r.b], R = D.CLASSES[r.result];
        const c = byResult.get(r.result);
        const made = state.discovered && state.discovered.has(r.result);
        const st = E.recipeStatus(state, r, c ? c.cost : null);
        const rtier = c ? c.resultTier : (st.resultTier != null ? st.resultTier : (gen === 3 ? 3 : 1));
        const ta = st.ta, tb = st.tb;

        let right;
        if (st.state === 'ready' || st.state === 'gold') {
          /* 골드가 모자라면 얼마가 모자란지 적고 버튼을 잠근다 — 재료는 다 모았다는 표시(초록 재료)는 그대로다 */
          const broke = st.state === 'gold';
          right = `${shortBadge(st.cost)}<button data-kind="recipe" data-result="${r.result}"
            class="${broke ? 'lack' : ''}" ${broke ? 'disabled' : ''}>⚗ ${D.TIERS[rtier].name} 💰${st.cost}</button>`;
        } else if (st.state === 'cap') {
          right = `<span class="cnt need">더 안 올라요 — 🌌 신화 조합으로</span>`;
        } else if (st.state === 'gap') {
          /* 두 직업 다 있는데 같은 등급 짝이 없다 — 무엇의 등급을 맞추면 되는지 알려준다 */
          const L = D.CLASSES[st.low];
          right = `<span class="cnt need" title="조합은 같은 등급 2명끼리만 돼요 — 등급을 맞춰 주세요">
            ⚖️ 같은 등급끼리만! ${L.emoji} ${L.name} 등급을 맞춰요</span>`;
        } else {
          /* 부족한 재료를 어떻게 구하는가로 버튼이 갈린다:
           *   기본 4직업 → 소환하면 나온다 · 조합으로만 나오는 직업 → 그 레시피로 보낸다 */
          const need = st.missing[0];
          const N = D.CLASSES[need];
          const byCombine = D.RECIPES.some(x => x.result === need);
          /* 소환도 돈이 든다 — 뽑을 돈이 없으면 "뽑으러 가기"도 잠근다 */
          const canSummon = state.gold >= D.SUMMON_COST;
          right = byCombine
            ? `<button data-goto="${need}" class="need">${N.emoji} ${N.name}부터 만들기</button>`
            : `${shortBadge(D.SUMMON_COST)}<button data-need="${need}"
                class="need${canSummon ? '' : ' lack'}" ${canSummon ? '' : 'disabled'}>🎲 ${N.emoji} ${N.name} 뽑으러 가기</button>`;
        }

        /* 재료 등급을 배지로 — 조합이 되는 줄은 "실제로 쓸 재료", 아니면 "보유 최고" */
        const usedNow = st.state === 'ready' || st.state === 'gold';
        const tierBadge = (t) => t == null || t < 0 ? ''
          : `<span class="ingt" style="background:${D.TIERS[t].color}">${D.TIERS[t].name[0]}</span>`;
        const ing = (cls, C, t) => {
          const have = t >= 0;
          const note = have
            ? ` (${usedNow ? '재료로 쓸 등급' : '보유 최고'}: ${D.TIERS[t].name})`
            : ' — 아직 없어요';
          return `<span class="ing${have ? ' have' : ' lack'}" title="${C.name}${note}">${C.emoji}${have ? tierBadge(t) : '<span class="ingx">?</span>'}</span>`;
        };
        out += `<div class="combine-row recipe s-${st.state}${gen === 3 ? ' mythic' : ''}">
          ${ing(r.a, A, ta)}+${ing(r.b, B, tb)}
          <span class="rarrow">→</span>
          <span class="peek" data-cls="${r.result}" data-rtier="${rtier}">${R.emoji} <b>${R.name}</b>${made ? ' <span class="found">✓</span>' : ''}</span>
          ${resBadge({ kind: 'recipe', a: r.a, b: r.b })}
          ${right}
        </div>`;
      }
      return out;
    };

    html += `<div class="combine-sub">✨ 특수 조합 <span class="cnt">서로 다른 두 직업 · 같은 등급 2명 → 등급 +1</span></div>`;
    html += renderRecipes(2);
    html += `<div class="combine-sub mythic">🌌 신화 조합 <span class="cnt">특수 2종 → 신화 용사 · 재료가 <b>전설</b>이면 결과가 <b>신화</b>!</span></div>`;
    html += renderRecipes(3);

    this.el.combineRows.innerHTML = html;
    /* 버튼은 세 종류다 — 조합(data-kind) / 소환하러(data-need) / 선행 조합으로(data-goto).
     * 셀렉터를 좁히지 않으면 새 버튼이 onCombine으로 잘못 흘러가 아무 일도 안 일어난다. */
    this.el.combineRows.querySelectorAll('button[data-kind]').forEach(b => {
      b.addEventListener('click', () => this.h.onCombine({ ...b.dataset }));
    });
    this.el.combineRows.querySelectorAll('button[data-need]').forEach(b => {
      b.addEventListener('click', () => this.h.onNeedHero(b.dataset.need));
    });
    this.el.combineRows.querySelectorAll('button[data-goto]').forEach(b => {
      b.addEventListener('click', () => this.gotoRecipe(b.dataset.goto));
    });
    /* 결과 캐릭터에 커서를 올리면 "무엇이 나올지" 미리 보여준다 */
    this.el.combineRows.querySelectorAll('.peek').forEach(sp => {
      const cls = sp.dataset.cls;
      const tier = Number(sp.dataset.rtier);
      sp.addEventListener('mouseenter', (ev) =>
        this.showTooltip(previewHero(cls, tier, state), state, ev.clientX, ev.clientY, true));
      sp.addEventListener('mousemove', (ev) => this.moveTooltip(ev.clientX, ev.clientY));
      sp.addEventListener('mouseleave', () => this.hideTooltip());
    });
  }

  /* ---------- 성 업그레이드 ---------- */
  renderCastlePanel(state) {
    let html = '';
    const hotkeys = { repair: '7', fortify: '8', tower: '9' };
    for (const [key, U] of Object.entries(D.CASTLE_UPGRADES)) {
      const n = key === 'repair' ? 0 : state.castle[key];
      const maxed = U.max && n >= U.max;
      const cost = U.cost(n);
      const full = key === 'repair' && state.castleHp >= state.castleMax;
      /* 못 누르는 이유가 셋이다 — MAX / 이미 가득 / 돈 부족.
       * 회색 버튼만 두면 셋이 구분이 안 되니 돈 부족은 동전으로 따로 적어 준다. */
      const broke = !maxed && !full && state.gold < cost;
      const disabled = maxed || full || broke || state.phase === 'over';
      const lvLabel = U.max && key !== 'repair' ? ` <span class="cnt">${n}/${U.max}</span>` : '';
      html += `<div class="combine-row${broke ? ' broke' : ''}">
        <span>${U.emoji}</span> ${U.name}<span class="kbd">${hotkeys[key]}</span>${lvLabel}
        <span class="cdesc">${U.desc}</span>
        ${broke ? `<span class="gshort" title="골드가 💰${cost - state.gold} 모자라요 (필요 💰${cost} · 지금 💰${state.gold})">💰${cost - state.gold} 부족</span>` : ''}
        <button data-key="${key}" class="${broke ? 'lack' : ''}" ${disabled ? 'disabled' : ''}>${maxed ? 'MAX' : full ? '가득' : `💰${cost}`}</button>
      </div>`;
    }
    /* 잔치 — 돈을 태워 랜덤 승급. 준비 단계에 한 번뿐이라 "이번엔 끝"을 분명히 보여 준다 */
    const fCost = D.feastCost(state.wave);
    const fDone = state.feastWave === state.wave;
    const fCands = [...state.bench, ...state.field].some(h => h.tier < D.maxTierOf(h.cls));
    const fBroke = !fDone && fCands && state.gold < fCost;
    const fDisabled = fDone || !fCands || fBroke || state.phase !== 'prep';
    html += `<div class="combine-row feast${fBroke ? ' broke' : ''}">
      <span>🎉</span> 잔치 벌이기
      <span class="cdesc">${fDone ? '이번 준비엔 벌써 즐겼어요 — 다음 웨이브에 또!'
        : !fCands ? '전원 신화라 승급할 용사가 없어요!'
        : '병사들과 한바탕! 용사 하나가 <b>랜덤 승급</b>해요 (준비마다 1번)'}</span>
      ${fBroke ? `<span class="gshort" title="골드가 💰${fCost - state.gold} 모자라요">💰${fCost - state.gold} 부족</span>` : ''}
      <button data-key="feast" class="${fBroke ? 'lack' : ''}" ${fDisabled ? 'disabled' : ''}>${fDone ? '🎉 완료' : `💰${fCost}`}</button>
    </div>`;
    this.el.castleRows.innerHTML = html;
    this.el.castleRows.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () =>
        b.dataset.key === 'feast' ? this.h.onFeast() : this.h.onCastle(b.dataset.key));
    });
  }

  /* ---------- 용사 패널 (벤치/필드 공용) ---------- */
  renderHeroPanel(state, heroId) {
    const el = this.el;
    const hero = state.field.find(v => v.id === heroId) || state.bench.find(v => v.id === heroId);
    /* 탭 안에 있으므로 패널 자체는 숨기지 않는다 — 고른 용사가 없으면 안내만 띄운다 */
    if (!hero) {
      el.heroDot.classList.add('hidden');
      el.hpTitle.textContent = '🧍 선택한 용사';
      el.hpInfo.innerHTML = '<div class="empty-msg">전장의 용사나 벤치 카드를 클릭하면<br>자세한 정보가 여기 나와요.</div>';
      el.moveHint.classList.add('hidden');
      el.heroActiveBtn.classList.add('hidden');
      el.recallBtn.classList.add('hidden');
      el.sellBtn.classList.add('hidden');
      el.combatHeroBar.classList.add('is-empty');
      el.combatHeroName.textContent = '영웅 액티브';
      el.combatHeroRole.textContent = '오른쪽 영웅 카드를 선택하세요';
      el.combatHeroActiveBtn.disabled = true;
      el.combatHeroActiveBtn.classList.remove('ready');
      el.combatHeroActiveBtn.textContent = '카드 선택';
      delete el.combatHeroActiveBtn.dataset.heroId;
      return;
    }
    el.sellBtn.classList.remove('hidden');
    if (this._tab !== 'hero') el.heroDot.classList.remove('hidden');
    const C = D.CLASSES[hero.cls], T = D.TIERS[hero.tier];
    const onField = hero.padIndex >= 0;
    el.hpTitle.textContent = onField ? '🧍 선택한 용사 (배치됨)' : '🧍 선택한 용사 (벤치)';
    el.hpInfo.innerHTML = describeHero(hero, state);
    el.recallBtn.textContent = '↩ 회수 (R / 우클릭)';
    el.recallBtn.classList.toggle('hidden', !onField);
    el.sellBtn.textContent = `💰 판매 +${D.SELL_PRICE[hero.tier]} (X)`;
    el.moveHint.classList.toggle('hidden', !onField);
    const active = D.heroActiveSpec(hero.heroKey);
    el.combatHeroBar.classList.remove('is-empty');
    el.combatHeroName.textContent = `${hero.name} · ${C.name}`;
    if (active && onField) {
      const left = Math.max(0, hero.activeCd || 0);
      const wave = state.phase === 'wave';
      const hasTarget = state.enemies.some((enemy) => !enemy.dead);
      el.heroActiveBtn.classList.remove('hidden');
      el.heroActiveBtn.dataset.heroId = String(hero.id);
      el.heroActiveBtn.disabled = !wave || left > 0 || !hasTarget;
      el.heroActiveBtn.classList.toggle('ready', wave && left <= 0 && hasTarget);
      el.heroActiveBtn.textContent = left > 0
        ? `${active.emoji} ${active.name} · ${left.toFixed(1)}초`
        : !wave ? `${active.emoji} ${active.name} · 전투 중 사용`
        : !hasTarget ? `${active.emoji} ${active.name} · 적을 기다리는 중`
        : `${active.emoji} ${active.name} 발동!`;
      el.heroActiveBtn.title = `${active.desc} · 재사용 ${active.cooldown}초`;
      el.combatHeroRole.textContent = `${active.emoji} ${active.name} · ${active.desc}`;
      el.combatHeroActiveBtn.dataset.heroId = String(hero.id);
      el.combatHeroActiveBtn.disabled = el.heroActiveBtn.disabled;
      el.combatHeroActiveBtn.classList.toggle('ready', wave && left <= 0 && hasTarget);
      el.combatHeroActiveBtn.textContent = left > 0
        ? `${left.toFixed(1)}초`
        : !wave ? '전투 중 사용'
        : !hasTarget ? '적 대기'
        : `${active.emoji} 발동`;
      el.combatHeroActiveBtn.title = el.heroActiveBtn.title;
    } else {
      el.heroActiveBtn.classList.add('hidden');
      el.combatHeroRole.textContent = '전장에 배치된 고정 영웅만 액티브를 사용합니다.';
      el.combatHeroActiveBtn.disabled = true;
      el.combatHeroActiveBtn.classList.remove('ready');
      el.combatHeroActiveBtn.textContent = '사용 불가';
    }
    /* Fixed squad members cannot be recalled or sold. Position is the only roster action. */
    el.recallBtn.classList.add('hidden');
    el.sellBtn.classList.add('hidden');
  }

  /* The live-defense dock is intentionally independent from card selection.
   * Selecting is for inspection/placement; casting should remain one tap. */
  renderCombatSkillDock(state) {
    const dock = this.el.combatSkillDock;
    const heroes = state.field.filter((hero) => D.heroActiveSpec(hero.heroKey));
    const hasTarget = state.enemies.some((enemy) => !enemy.dead);
    const wave = state.phase === 'wave';
    const signature = `${wave}|${hasTarget}|${heroes.map((hero) => `${hero.id}:${Math.ceil(Math.max(0, hero.activeCd || 0) * 10)}`).join(',')}`;
    if (signature === this._combatSkillSignature) return;
    this._combatSkillSignature = signature;
    dock.classList.toggle('hidden', !wave || !heroes.length);
    if (!heroes.length) { dock.innerHTML = ''; return; }
    dock.style.setProperty('--skill-count', String(heroes.length));
    dock.innerHTML = heroes.map((hero) => {
      const active = D.heroActiveSpec(hero.heroKey);
      const left = Math.max(0, hero.activeCd || 0);
      const ready = wave && hasTarget && left <= 0;
      const stateLabel = left > 0 ? `${left.toFixed(1)}초` : hasTarget ? '발동 가능' : '적 대기';
      return `<button type="button" data-hero-id="${hero.id}" class="${ready ? 'ready' : ''}" ${ready ? '' : 'disabled'} title="${active.name} · ${active.desc}">
        <b>${active.emoji} ${hero.name}</b><small>${stateLabel}</small>
      </button>`;
    }).join('');
  }

  /* ---------- 상세 정보 툴팁 ---------- */
  showTooltip(hero, state, cx, cy, preview) {
    const tt = this.el.tooltip;
    tt.innerHTML = describeHero(hero, state, preview);
    tt.classList.toggle('preview', !!preview);
    tt.classList.remove('hidden');
    this.moveTooltip(cx, cy);
  }
  moveTooltip(cx, cy) {
    const tt = this.el.tooltip;
    if (tt.classList.contains('hidden')) return;
    const r = tt.getBoundingClientRect();
    let x = cx + 16, y = cy + 14;
    if (x + r.width > window.innerWidth - 8) x = cx - r.width - 16;
    if (y + r.height > window.innerHeight - 8) y = Math.max(8, cy - r.height - 14);
    tt.style.left = `${Math.max(8, x)}px`;
    tt.style.top = `${Math.max(8, y)}px`;
  }
  hideTooltip() { this.el.tooltip.classList.add('hidden'); }

  /* ---------- 다음 웨이브 미리보기 ---------- */
  renderWavePreview(state, counts) {
    const el = this.el.wavePreview;
    if (state.phase !== 'prep') { el.classList.add('hidden'); return; }
    const chips = Object.entries(counts)
      .map(([type, n]) => {
        const T = D.ENEMY_TYPES[type];
        const cls = T.boss ? ' boss' : (T.midBoss ? ' midboss' : '');
        return `<span class="wchip${cls}">${T.emoji}×${n}</span>`;
      })
      .join('');
    /* 신화 용사를 데리고 있으면 몬스터가 그만큼 단단해진다 — 시작 전에 알려 준다.
     * 말없이 체력만 올리면 "왜 갑자기 안 죽지?"가 되고, 그건 버그처럼 느껴진다. */
    const press = E.mythicCount(state);
    const warn = press > 0
      ? `<span class="wchip myth" title="신화 용사 ${press}명 — 몬스터 체력 +${Math.round((D.mythicHpMul(press) - 1) * 100)}% · 골드 +${Math.round((D.mythicGoldMul(press) - 1) * 100)}%">🌌 체력 +${Math.round((D.mythicHpMul(press) - 1) * 100)}% · 💰 +${Math.round((D.mythicGoldMul(press) - 1) * 100)}%</span>`
      : '';
    const progress = E.journeyBattleProgress(state);
    const encounter = E.journeyEncounter(state);
    const encounterLabel = encounter.boss ? ' · 지역 결전' : (encounter.midBoss ? ' · 지휘관전' : '');
    const label = progress ? `${progress.node.name} · 방어 ${progress.step}/${progress.total}${encounterLabel}` : '다음 웨이브';
    el.innerHTML = `<span class="wlabel">${label}</span>${chips}${warn}`;
    el.classList.remove('hidden');
  }

  /* ---------- 보스 체력바 (이름 + 등급별 색) ---------- */
  setBossBar(info) {
    const el = this.el.bossBar;
    if (!info) { el.classList.add('hidden'); this._bossBarKey = null; return; }
    el.classList.remove('hidden');
    const key = `${info.name}|${info.great}`;
    if (this._bossBarKey !== key) {
      this._bossBarKey = key;
      this.el.bossBarName.textContent = `${info.emoji} ${info.name}`;
      el.classList.toggle('great', !!info.great);
      el.classList.toggle('mid', !info.great);
    }
    el.classList.toggle('enraged', !!info.enraged);
    this.el.bossBarFill.style.width = `${Math.max(0, info.ratio * 100)}%`;
  }

  /* 등장 경고 배너 */
  bossWarn(tier, name, emoji) {
    const el = this.el.bossWarnBanner;
    const great = tier === 'great';
    el.textContent = great ? `⚠️ 대보스 ${emoji} ${name} 접근!!` : `⚠️ 중간보스 ${emoji} ${name} 접근!`;
    el.classList.toggle('great', great);
    el.classList.remove('hidden');
    clearTimeout(this._warnT);
    this._warnT = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  /* 보스 등장/분노 배너 */
  showBossBanner(tier, name, emoji) {
    const el = this.el.bossBanner;
    const stage = this.el.scene3d.closest('.stage');
    const great = tier === 'great';
    el.innerHTML = `<small>${great ? 'REGIONAL BOSS' : 'COMMANDER'}</small><b>${name}</b><span>${great ? '지역 결전 개시' : '호위대와 함께 진군'}</span>`;
    el.setAttribute('aria-label', `${emoji} ${name} 등장`);
    el.classList.toggle('mid', !great);
    el.classList.add('cutscene-title');
    stage?.classList.add('boss-cutscene');
    el.classList.remove('hidden');
    clearTimeout(this._bossT);
    this._bossT = setTimeout(() => {
      el.classList.add('hidden');
      el.classList.remove('cutscene-title');
      stage?.classList.remove('boss-cutscene');
    }, great ? 2600 : 2150);
  }
  showEnrage(name) {
    const el = this.el.bossBanner;
    this.el.scene3d.closest('.stage')?.classList.remove('boss-cutscene');
    el.classList.remove('cutscene-title');
    el.textContent = `🔥 ${name} 분노!! 더 빨라졌어요!`;
    el.classList.remove('mid');
    el.classList.remove('hidden');
    clearTimeout(this._bossT);
    this._bossT = setTimeout(() => el.classList.add('hidden'), 2200);
  }
  /* ---------- 별의 축복 (메타) ---------- */
  renderMeta(shards, levels) {
    this.el.metaShards.textContent = shards;
    let html = '';
    for (const [key, M] of Object.entries(D.META_UPGRADES)) {
      if (M.legacy) continue;
      const lv = levels[key] || 0;
      const maxed = lv >= M.max;
      const cost = M.cost(lv);
      html += `<div class="meta-row">
        <span class="memoji">${M.emoji}</span>
        <div class="minfo"><b>${M.name}</b> <span class="cnt">Lv ${lv}/${M.max}</span><br>
        <span class="cdesc">레벨당 ${M.per}</span></div>
        <button data-key="${key}" ${maxed || shards < cost ? 'disabled' : ''}>${maxed ? 'MAX' : `✨${cost}`}</button>
      </div>`;
    }
    this.el.metaRows.innerHTML = html;
    this.el.metaRows.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => this.h.onMetaBuy(b.dataset.key));
    });
  }
  showMeta() { this.el.metaModal.classList.remove('hidden'); }
  hideMeta() { this.el.metaModal.classList.add('hidden'); }

  /* ---------- 도감 · 기록 ----------
   * 데이터는 열 때 main이 통째로 넘긴다(renderBook). 탭 전환은 넘겨받은 데이터로
   * 다시 그리기만 한다 — 게임이 멈춰 있는 동안 값이 변하지 않으므로 안전하다. */
  renderBook(data) {
    this._bookData = data;
    if (!this._bookTab) this._bookTab = 'heroes';
    this.el.bookTabs.querySelectorAll('button').forEach(b =>
      b.classList.toggle('on', b.dataset.btab === this._bookTab));
    this._renderBookBody();
  }
  _renderBookBody() {
    const d = this._bookData;
    if (!d) return;
    const tab = this._bookTab || 'heroes';
    let html = '';
    if (tab === 'heroes') html = d.state?.squad ? this._bookSquad(d) : this._bookHeroes(d);
    else if (tab === 'enemies') html = this._bookEnemies(d);
    else if (tab === 'ach') html = this._bookAch(d);
    else html = this._bookTactics(d);
    this.el.bookBody.innerHTML = html;
  }

  _bookHeroes(d) {
    const filled = Object.keys(d.codex.heroes).filter(k => d.codex.heroes[k] > 0).length;
    let html = `<div class="book-progress">채운 칸 <b>${filled}</b> / ${D.CODEX_HERO_CELLS}
      <span class="cnt">용사를 만들면 칸이 채워져요 — 소환·조합·잔치 모두!</span></div>`;
    for (const cls of D.CLASS_KEYS) {
      const C = D.CLASSES[cls];
      const min = D.minTierOf(cls);
      const known = Object.keys(d.codex.heroes).some(k => k.startsWith(cls + ':') && d.codex.heroes[k] > 0);
      let cells = '';
      for (let t = min; t <= D.MAX_TIER; t++) {
        const n = d.codex.heroes[`${cls}:${t}`] || 0;
        cells += n > 0
          ? `<span class="bkcell on" style="background:${D.TIERS[t].color}" title="${D.TIERS[t].name} ${C.name} — ${n}번 만들었어요">${D.TIERS[t].name[0]}</span>`
          : `<span class="bkcell" title="${D.TIERS[t].name} ${C.name} — 아직 못 만들었어요">?</span>`;
      }
      const tag = C.mythic ? '<span class="bktag mythic">신화</span>'
        : C.special ? '<span class="bktag sp">특수</span>' : '';
      html += `<div class="book-row${known ? '' : ' unknown'}">
        <span class="bkemoji">${known ? C.emoji : '❓'}</span>
        <span class="bkname">${known ? C.name : '???'}${tag}</span>
        <span class="bkcells">${cells}</span>
      </div>`;
    }
    return html;
  }

  _bookSquad(d) {
    const heroes = d.state.field;
    let html = `<div class="book-progress">수호 영웅단 <b>${heroes.length}</b> / ${D.SQUAD.length}
      <span class="cnt">원정대는 전투를 거치며 레벨과 전문화를 이어 갑니다.</span></div>`;
    for (const spec of D.SQUAD) {
      const hero = heroes.find((entry) => entry.heroKey === spec.key);
      const C = D.CLASSES[spec.cls];
      const skills = Object.entries(D.HERO_SKILLS)
        .filter(([key, skill]) => skill.cls === spec.cls && (hero?.skills?.[key] || 0) > 0)
        .map(([key, skill]) => `${skill.name} ${hero.skills[key]}`)
        .join(' · ');
      html += `<div class="book-row${hero ? '' : ' unknown'}">
        <span class="bkemoji">${C.emoji}</span>
        <span class="bkname">${spec.name}<small>${spec.role} · Lv ${hero?.level || 1}${skills ? `<br>${skills}` : ''}</small></span>
        <span class="bkkills">${hero ? `경험치 ${hero.xp}/${D.heroXpNeed(hero.level)}` : '합류 대기'}</span>
      </div>`;
    }
    return html;
  }

  _bookEnemies(d) {
    const types = Object.keys(D.ENEMY_TYPES);
    const met = types.filter(t => (d.codex.kills[t] || 0) > 0).length;
    let html = `<div class="book-progress">물리친 종류 <b>${met}</b> / ${types.length}
      <span class="cnt">한 번이라도 물리치면 도감에 실려요</span></div>`;
    for (const t of types) {
      const E2 = D.ENEMY_TYPES[t];
      const n = d.codex.kills[t] || 0;
      const tag = E2.boss ? '<span class="bktag boss">대보스</span>'
        : E2.midBoss ? '<span class="bktag mid">중간보스</span>' : '';
      html += n > 0
        ? `<div class="book-row"><span class="bkemoji">${E2.emoji}</span>
            <span class="bkname">${E2.name}${tag}</span>
            <span class="bkkills">⚔️ ${n.toLocaleString()}마리</span></div>`
        : `<div class="book-row unknown"><span class="bkemoji">❓</span>
            <span class="bkname">???${tag}</span>
            <span class="bkkills">아직 못 만났어요</span></div>`;
    }
    return html;
  }

  _bookAch(d) {
    const done = D.ACHIEVEMENTS.filter(a => d.earned[a.key]).length;
    let html = `<div class="book-progress">달성 <b>${done}</b> / ${D.ACHIEVEMENTS.length}
      <span class="cnt">달성하면 ✨별조각을 받아요 — 🪞 표시는 옷장이 열려요!</span></div>`;
    for (const a of D.ACHIEVEMENTS) {
      const got = !!d.earned[a.key];
      const wardrobe = a.unlocks
        ? `<span class="bkunlock">🪞 ${D.CHAMP_WARDROBE[a.unlocks.axis].name}: ${D.CHAMP_WARDROBE[a.unlocks.axis].options[a.unlocks.key].name}</span>`
        : '';
      html += `<div class="book-row ach${got ? ' done' : ''}">
        <span class="bkemoji">${a.emoji}</span>
        <div class="bkach">
          <div class="bkname">${a.name} ${got ? '<span class="bkdone">✓ 달성!</span>' : ''}</div>
          <div class="bkdesc">${a.desc}</div>
        </div>
        <span class="bkreward">✨${a.shards}${wardrobe}</span>
      </div>`;
    }
    return html;
  }

  _bookTactics() {
    return `<div class="tactic-summary">
      <div class="msbox"><b>☄️</b><span>유성 성좌</span></div>
      <div class="msbox"><b>❄️</b><span>서리 성좌</span></div>
      <div class="msbox"><b>🛡️</b><span>수호 성좌</span></div>
    </div>
    <div class="combine-empty">전투 중 6×6 별자리 전술판에서 이웃한 별을 바꾸세요. 3개를 맞추면 그 열의 길에 전술이 내려가고, 4개와 5개는 더 큰 성좌가 됩니다.</div>`;
  }

  showBook() { this.el.bookModal.classList.remove('hidden'); this.el.bookDot.classList.add('hidden'); }
  hideBook() { this.el.bookModal.classList.add('hidden'); }
  isBookOpen() { return !this.el.bookModal.classList.contains('hidden'); }
  /* 새 업적을 딴 순간 도감 버튼에 점을 찍는다 — 열면 사라진다 */
  pingBook() { if (!this.isBookOpen()) this.el.bookDot.classList.remove('hidden'); }

  /* ---------- 서른 번째 아침 (승리) ---------- */
  showVictory({ loop, shards, state }) {
    const el = this.el;
    const run = (loop || 0) + 1;
    el.victoryTitle.textContent = run > 1 ? `서른 번째 아침 — ${run}번째 여정` : '🌅 서른 번째 아침';
    el.victoryStats.innerHTML =
      `🌊 <b>30웨이브</b>를 지켜냈어요! (${D.DIFFICULTIES[state.difficulty].name}${run > 1 ? ` · ${run}회차` : ''})<br>
       👾 물리친 몬스터 <b>${state.kills}</b> · ✦ 영웅단 최고 레벨 <b>${Math.max(...state.field.map((hero) => hero.level || 1))}</b> ·
       🌌 전술판으로 길을 지키며 별의 시련을 이어가요<br>
       ✦ 원정대는 다음 여정에서도 성장과 전문화를 유지합니다`;
    el.victoryShards.textContent = `✨ 별조각 +${shards} 획득!`;
    el.victoryTrialBtn.textContent = `🌟 별의 시련 — ${run + 1}회차 도전!`;
    el.victoryModal.classList.remove('hidden');
    setTimeout(() => el.victoryContinueBtn.focus(), 30);
  }
  hideVictory() { this.el.victoryModal.classList.add('hidden'); }
  isVictoryOpen() { return !this.el.victoryModal.classList.contains('hidden'); }

  /* ---------- 별지기 칩 ----------
   * 매 프레임 불리므로 "값이 바뀔 때만" DOM을 만진다 (comboChip과 같은 규칙). */
  setChampFace(url) {
    if (!url) return;                      // 초상 생성 실패 → 이모지 그대로
    this.el.champFace.innerHTML = `<img src="${url}" alt="별지기 루나">`;
  }
  updateChampChip(state) {
    const c = state.champ;
    const el = this.el;
    if (!c) { el.champChip.classList.add('hidden'); return; }
    const S = E.champStats(state);
    const wave = state.phase === 'wave';

    if (this._chLv !== c.level) {
      this._chLv = c.level;
      el.champLv.textContent = `Lv ${c.level}`;
      el.champLv.classList.remove('pop');
      void el.champLv.offsetWidth;
      el.champLv.classList.add('pop');
    }
    if (this._chKo !== c.ko) {
      this._chKo = c.ko;
      el.champChip.classList.toggle('ko', c.ko);
      el.champKoTag.classList.toggle('hidden', !c.ko);
    }
    const hpPct = Math.round(c.maxHp ? (c.hp / c.maxHp) * 100 : 0);
    if (this._chHp !== hpPct) {
      this._chHp = hpPct;
      el.champHpFill.style.width = `${hpPct}%`;
      el.champHpFill.className = hpPct < 30 ? 'low' : hpPct < 60 ? 'mid' : '';
    }
    const need = D.champXpNeed(c.level);
    const xpPct = c.level >= D.CHAMP_XP.maxLevel ? 100 : Math.min(100, Math.round((c.xp / need) * 100));
    if (this._chXp !== xpPct) {
      this._chXp = xpPct;
      el.champXpFill.style.width = `${xpPct}%`;
    }
    /* 별똥별 — 쿨다운이 차오르는 게이지 (가득 = 준비 완료) */
    const cdPct = Math.round(c.spellCd > 0 ? (1 - c.spellCd / S.starCd) * 100 : 100);
    const spellSig = `${cdPct}|${wave}|${c.ko}`;
    if (this._chSpell !== spellSig) {
      this._chSpell = spellSig;
      el.spellCdFill.style.height = `${100 - cdPct}%`;
      el.spellBtn.disabled = !wave || c.ko || c.spellCd > 0;
      el.spellBtn.classList.toggle('ready', wave && !c.ko && c.spellCd <= 0);
    }
    const ultPct = Math.round(c.ult * 100);
    const ultSig = `${ultPct}|${wave}|${c.ko}`;
    if (this._chUlt !== ultSig) {
      this._chUlt = ultSig;
      el.ultFill.style.height = `${ultPct}%`;
      el.ultBtn.disabled = !wave || c.ko || c.ult < 1;
      el.ultBtn.classList.toggle('full', c.ult >= 1 && !c.ko);
      el.ultBtn.title = c.ult >= 1
        ? '은하수 — 지금이에요! 모든 적을 때리고 얼려요 (E)'
        : `은하수 — 충전 ${ultPct}% (처치할수록 차요)`;
    }
    if (this._chSp !== c.sp) {
      this._chSp = c.sp;
      el.spBadge.textContent = c.sp;
      el.spBadge.classList.toggle('hidden', c.sp <= 0);
      el.skillBtn.classList.toggle('has-sp', c.sp > 0);
    }
  }

  /* ---------- 별자리 (스킬트리) ---------- */
  renderSkills(state) {
    const c = state.champ;
    this.el.skillPts.textContent = c.sp;
    let html = '';
    for (const [bk, B] of Object.entries(D.CHAMP_BRANCHES)) {
      html += `<div class="skill-branch"><h3>${B.emoji} ${B.name}</h3>`;
      for (const [key, SK] of Object.entries(D.CHAMP_SKILLS)) {
        if (SK.branch !== bk) continue;
        const rank = c.skills[key] || 0;
        const spent = E.branchSpent(c, bk);
        const locked = spent < SK.need;
        const maxed = rank >= SK.max;
        const can = !locked && !maxed && c.sp > 0;
        const pips = '★'.repeat(rank) + '☆'.repeat(SK.max - rank);
        html += `<button class="skill-node${maxed ? ' maxed' : ''}${locked ? ' locked' : ''}${can ? ' can' : ''}"
            data-key="${key}" ${(!can) ? 'disabled' : ''} title="${SK.desc}">
          <span class="semoji">${SK.emoji}</span>
          <div class="sinfo">
            <div class="sname">${SK.name} <span class="spips">${pips}</span></div>
            <div class="sper">${maxed ? 'MAX! ' : ''}${SK.per}</div>
            ${locked ? `<div class="slock">🔒 ${B.name}에 ${SK.need}포인트 필요 (지금 ${spent})</div>` : ''}
          </div>
        </button>`;
      }
      html += `</div>`;
    }
    this.el.skillCols.innerHTML = html;
    this.el.skillCols.querySelectorAll('button[data-key]').forEach(b => {
      b.addEventListener('click', () => this.h.onSkillPick(b.dataset.key));
    });
  }
  showSkills() { this.el.skillModal.classList.remove('hidden'); }
  hideSkills() { this.el.skillModal.classList.add('hidden'); }
  isSkillOpen() { return !this.el.skillModal.classList.contains('hidden'); }

  /* ---------- 별지기의 옷장 ---------- */
  setChampName(name) {
    this.el.champName.textContent = name;
    this.el.skillTitle.textContent = `✨ ${name}의 별자리`;
  }
  /* isLocked(axis, key) → 잠근 업적 정의 또는 falsy. 잠긴 옷은 업적 이름을 알려 주며 잠긴 채 보여 준다 —
   * 숨기면 "열 게 있다"는 것 자체를 모른다. */
  renderCloset(look, name, isLocked = null) {
    this.el.closetName.value = name;
    let html = '';
    for (const [axis, A] of Object.entries(D.CHAMP_WARDROBE)) {
      html += `<div class="closet-axis"><span class="claxis">${A.emoji} ${A.name}</span><div class="clopts">`;
      for (const [key, O] of Object.entries(A.options)) {
        const lock = isLocked && isLocked(axis, key);
        const sw = O.color != null
          ? `<span class="clswatch" style="background:#${O.color.toString(16).padStart(6, '0')}"></span>` : '';
        html += lock
          ? `<button class="clopt locked" disabled
              title="업적 [${lock.emoji} ${lock.name}]을 달성하면 열려요 — ${lock.desc}">${sw}🔒 ${O.name}</button>`
          : `<button class="clopt${look[axis] === key ? ' on' : ''}" data-axis="${axis}" data-key="${key}">${sw}${O.name}</button>`;
      }
      html += `</div></div>`;
    }
    this.el.closetRows.innerHTML = html;
    this.el.closetRows.querySelectorAll('button[data-axis]').forEach(b => {
      b.addEventListener('click', () => this.h.onClosetPick(b.dataset.axis, b.dataset.key));
    });
  }
  setClosetPreview(url) {
    this.el.closetPreview.innerHTML = url
      ? `<img src="${url}" alt="미리보기">`
      : '<span class="closet-emoji">🌠</span>';
  }
  readClosetName() { return this.el.closetName.value; }
  showCloset() { this.el.closetModal.classList.remove('hidden'); }
  hideCloset() { this.el.closetModal.classList.add('hidden'); }
  isClosetOpen() { return !this.el.closetModal.classList.contains('hidden'); }
  /* ---------- 데모 ----------
   * 데모 중임을 항상 화면에 밝힌다. 사용자가 자기 조작이 안 먹는다고
   * 오해하지 않게 하고, 나가는 길도 늘 보이게 둔다. */
  setDemoMode(on, profile) {
    this.el.demoBar.classList.toggle('hidden', !on);
    this.el.demoBtn.classList.toggle('on', !!on);
    this.el.spectateBtn.classList.toggle('on', !!on);
    this.el.demoBtn.textContent = on ? '⏹ 관전 끝' : '🎬 관전';
    this.el.spectateBtn.innerHTML = on
      ? '⏹ 관전 끝 <span>D</span>'
      : '🎬 AI 관전 <span>D</span>';
    document.body.classList.toggle('demo-on', !!on);
    this.el.demoDetail.textContent = on
      ? '설명형 자동 플레이 · 실제 스왑 · 실제 전술 · 실제 방어 규칙'
      : '밸런스 봇과 같은 실제 플레이 규칙';
    if (on && profile) this.setDemoCaption(`🤖 ${profile} AI 관전 중`);
  }
  setDemoCaption(text) {
    const el = this.el.demoCaption;
    if (el.textContent === text) return;      // 같은 글자를 다시 넣어 애니메이션을 재시작하지 않는다
    el.textContent = text;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  /* ---------- 막간 이야기 ---------- */
  showStory(beat) {
    const el = this.el;
    el.storyIcon.textContent = beat.icon || '📜';
    el.storyTitle.textContent = beat.title || '';
    el.storyLines.textContent = '';
    /* 줄을 하나씩 요소로 — 빈 줄이 문단 간격이 된다 (타이핑 연출은 넣지 않는다: 아이는 안 기다린다) */
    for (const line of beat.lines) {
      const d = document.createElement('div');
      d.className = line ? 'story-line' : 'story-gap';
      d.textContent = line;
      el.storyLines.appendChild(d);
    }
    el.storyModal.classList.remove('hidden');
    setTimeout(() => el.storyNext.focus(), 30);
  }
  hideStory() { this.el.storyModal.classList.add('hidden'); }
  isStoryOpen() { return !this.el.storyModal.classList.contains('hidden'); }

  /* ---------- 전설·신화 탄생 연출 ---------- */
  showReveal({ tierName, tierColor, name, emoji, desc, art, short }) {
    const el = this.el;
    el.revealTier.textContent = tierName;
    el.revealTier.style.color = tierColor;
    el.revealCard.style.setProperty('--tier', tierColor);
    el.revealName.textContent = name;
    el.revealDesc.textContent = short ? '' : (desc || '');
    el.revealArt.innerHTML = '';
    if (art) {
      const img = document.createElement('img');
      img.src = art;
      img.alt = name;
      el.revealArt.appendChild(img);
    } else {
      el.revealArt.textContent = emoji;      // 초상 생성 실패 시 이모지로
    }
    el.revealCard.classList.toggle('short', !!short);
    el.revealModal.classList.remove('hidden');
    el.revealCard.classList.remove('pop');
    void el.revealCard.offsetWidth;
    el.revealCard.classList.add('pop');
  }
  hideReveal() { this.el.revealModal.classList.add('hidden'); }
  isRevealOpen() { return !this.el.revealModal.classList.contains('hidden'); }

  isMetaOpen() { return !this.el.metaModal.classList.contains('hidden'); }

  /* ---------- 시작 메뉴 (자동 저장이 있을 때: 이어하기 / 처음부터) ---------- */
  showStart(save) {
    const el = this.el;
    const heroes = (Array.isArray(save.bench) ? save.bench.length : 0)
      + (Array.isArray(save.field) ? save.field.length : 0);
    const diff = D.DIFFICULTIES[save.difficulty];
    el.continueInfo.innerHTML =
      `지난 모험이 자동 저장돼 있어요<br><b>${save.wave}웨이브</b> · ${diff ? diff.emoji + ' ' + diff.name : '⚔️ 보통'} 난이도 · 🧍 용사 ${heroes}명`;
    el.continueBtn.textContent = `⏩ 이어하기 — ${save.wave}웨이브부터 (Enter)`;
    el.startModal.classList.remove('hidden');
    setTimeout(() => el.continueBtn.focus(), 30);
  }
  hideStart() { this.el.startModal.classList.add('hidden'); }
  isStartOpen() { return !this.el.startModal.classList.contains('hidden'); }
  /* ---------- 게임 오버 ---------- */
  showOver(state) {
    const memory = E.summarizeRun(state);
    const lanes = ['왼쪽 길', '가운데 길', '오른쪽 길'];
    const kinds = { flare: 'Flare', tide: 'Tide', bloom: 'Bloom' };
    const route = state.journey?.visited?.map((id) => E.journeyNode(id, state)?.name).filter(Boolean).join(' → ');
    const constellation = memory.largest.size
      ? `${memory.largest.size}개 ${kinds[memory.largest.kind]} · ${lanes[memory.largest.lane]}`
      : '아직 기록되지 않음';
    const recovery = memory.biggestHeal
      ? `한 번에 성벽 ${memory.biggestHeal} 회복${memory.lowestCastleHp != null ? ` · 최저 ${memory.lowestCastleHp}에서 반격` : ''}`
      : '회복 없이 끝까지 버팀';
    this.el.overStats.innerHTML =
      `🌊 도달한 웨이브: <b>${state.wave}웨이브</b> (${D.DIFFICULTIES[state.difficulty].name})<br>
       👾 물리친 몬스터: <b>${state.kills}마리</b>${state.midBossKills ? ` · 👿 중간보스 ${state.midBossKills}` : ''}${state.bossKills ? ` · 🐉 대보스 ${state.bossKills}` : ''}<br>
       ✦ 영웅단 최고 레벨 <b>${Math.max(...state.field.map((hero) => hero.level || 1))}</b> · ✧ 선택한 전문화 <b>${state.field.reduce((total, hero) => total + Object.values(hero.skills || {}).reduce((sum, rank) => sum + rank, 0), 0)}</b><br>
       🌌 별자리 전술판으로 세 갈래 길을 지켰어요<br>
       ${state.champ ? `<br>🌠 별지기: <b>Lv ${state.champ.level}</b> · 직접 처치 <b>${state.champKills || 0}</b> · ☄️ 별똥별 ${state.starCasts || 0}회${state.ultCasts ? ` · 🌌 은하수 ${state.ultCasts}회` : ''}${state.perfectWaves ? ` · 🛡️ 완벽 방어 ${state.perfectWaves}번` : ''}${state.feasts ? ` · 🎉 잔치 ${state.feasts}번` : ''}` : ''}`;
    this.el.overShards.textContent = `✨ 별조각 +${state.shardsEarned} 획득!`;
    this.el.overStats.innerHTML +=
      `<br><br><b>이번 수호의 기억</b><br>
       🌠 가장 큰 성좌 <b>${constellation}</b><br>
       🛡️ 집중 방어 <b>${memory.favoriteLane == null ? '세 길을 고르게 방어' : `${lanes[memory.favoriteLane]} · ${memory.favoriteCasts}회`}</b><br>
       💚 결정적 회복 <b>${recovery}</b>${route ? `<br>🗺️ 원정 경로 <b>${route}</b>` : ''}`;
    this.el.overModal.classList.remove('hidden');
  }
  hideOver() { this.el.overModal.classList.add('hidden'); }

  /* ---------- 소환/조합 연출 ---------- */
  summonReveal(hero, tier) {
    const C = D.CLASSES[hero.cls], T = D.TIERS[tier];
    const el = this.el.summonReveal;
    el.className = `reveal t${tier}`;
    el.innerHTML =
      `<div class="rv-em">${C.emoji}</div>` +
      `<div class="rv-tier" style="color:${T.color}">${T.name}</div>` +
      `<div class="rv-name">${C.name}</div>`;
    el.classList.remove('hidden');
    void el.offsetWidth;
    el.classList.add('pop');
    clearTimeout(this._revealT);
    this._revealT = setTimeout(() => { el.classList.add('hidden'); el.classList.remove('pop'); },
      tier >= 3 ? 1800 : tier >= 2 ? 1500 : 900);
  }

  /* ---------- 연출 ---------- */
  toast(msg, kind = '') {
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.textContent = msg;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 2700);
  }
  coachChip() {
    if (localStorage.getItem('constellation-defense.coach')) return;
    localStorage.setItem('constellation-defense.coach', '1');
    const el = this.el.coachChip;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 9000);
  }
  setSpeedLabel(s, shortcut = 'Q') { this.el.speedBtn.textContent = `⏩ x${s} (${shortcut})`; }
  setPlaytestLogStatus(count = 0, exported = false) {
    const total = Math.max(0, Math.round(Number(count) || 0));
    this.el.playtestBtn.textContent = total > 0 ? `📊 ${total}` : '📊';
    this.el.playtestBtn.setAttribute('aria-label', `플레이 기록 내보내기 · 로컬 기록 ${total}개`);
    this.el.playtestBtn.title = exported
      ? `방금 내보냄 · 기기에만 저장된 플레이 기록 ${total}개`
      : `기기에만 저장된 플레이 시간 기록 ${total}개 내보내기`;
  }
  renderSettings({ actions, bindings, captureAction = null, graphics = 'high', reducedEffects = true,
    systemReduced = false, sfxMuted = false, bgmMuted = false, locale = 'ko', saveLocation = '브라우저 사이트 저장소' }) {
    this.el.settingsLanguage.value = locale === 'en' ? 'en' : 'ko';
    this.el.settingsGfx.value = graphics === 'lite' ? 'lite' : 'high';
    this.el.settingsEffects.value = reducedEffects ? 'reduced' : 'lively';
    this.el.settingsEffects.disabled = systemReduced;
    this.el.settingsApplyNote.textContent = systemReduced
      ? '운영체제의 동작 줄이기 설정이 켜져 있어 절제 효과를 유지합니다. 전체 화면 점멸은 항상 금지됩니다.'
      : '그래픽 품질은 다음 실행부터 적용됩니다. 전체 화면 점멸은 어떤 설정에서도 사용하지 않습니다.';
    this.el.settingsSfxBtn.textContent = sfxMuted ? '🔇 효과음 꺼짐' : '🔊 효과음 켜짐';
    this.el.settingsBgmBtn.textContent = bgmMuted ? '🔇 배경음 꺼짐' : '🎵 배경음 켜짐';
    this.el.settingsKeyRows.innerHTML = actions.map(({ id, label, key }) =>
      `<button class="settings-key${captureAction === id ? ' listening' : ''}" data-key-action="${id}"><span>${label}</span><kbd>${captureAction === id ? '새 키…' : key}</kbd></button>`).join('');
    this.el.settingsSavePath.textContent = `💾 저장 위치 · ${saveLocation}`;
  }
  showSettings() { this.el.settingsModal.classList.remove('hidden'); }
  hideSettings() { this.el.settingsModal.classList.add('hidden'); }
  isSettingsOpen() { return !this.el.settingsModal.classList.contains('hidden'); }
  setShortcutLabels(bindings, labelForCode) {
    const label = (action) => labelForCode(bindings[action]);
    this.el.spellBtn.querySelector('.bkey').textContent = label('spell');
    this.el.ultBtn.querySelector('.bkey').textContent = label('ultimate');
    this.el.skillBtn.querySelector('.bkey').textContent = label('skills');
    this.el.spellBtn.title = `별똥별 — 성문에 가까운 적에게 별이 떨어져요 (${label('spell')})`;
    this.el.ultBtn.title = `은하수 — 화면의 모든 적을 때리고 얼려요! 처치로 충전 (${label('ultimate')})`;
    this.el.skillBtn.title = `별자리 — 레벨 업으로 얻은 포인트를 써요 (${label('skills')})`;
    this.el.speedBtn.title = `게임 속도 (${label('speed')})`;
    this.el.demoBtn.title = `밸런스 봇이 실제 게임을 플레이하는 모습을 봐요 (${label('spectate')})`;
    this.el.spectateBtn.title = `밸런스 봇이 실제 전술 스왑과 방어를 수행하는 모습을 봐요 (${label('spectate')})`;
    const spectateKey = this.el.spectateBtn.querySelector('span');
    if (spectateKey) spectateKey.textContent = label('spectate');
    this.el.helpBox.querySelectorAll('[data-shortcut]').forEach((element) => {
      element.textContent = label(element.dataset.shortcut);
    });
  }
  /* 음소거 버튼 상태 — 꺼진 건 한눈에 보이게 (아이콘 + 회색 처리) */
  setSoundLabels(sfxOff, bgmOff) {
    this.el.sfxBtn.textContent = sfxOff ? '🔇 효과음' : '🔊 효과음';
    this.el.sfxBtn.classList.toggle('off', sfxOff);
    this.el.bgmBtn.textContent = bgmOff ? '🔇 배경음' : '🎵 배경음';
    this.el.bgmBtn.classList.toggle('off', bgmOff);
  }
  setEffectsLabel(reduced, system = false) {
    this.el.effectsBtn.textContent = reduced ? '🌙 저자극' : '✨ 생동감';
    this.el.effectsBtn.classList.toggle('calm', reduced);
    this.el.effectsBtn.title = system
      ? '기기의 동작 줄이기 설정을 따르는 중'
      : reduced ? '착탄 지점의 국소 파티클을 줄이는 중' : '국소 파티클을 더 표시하는 중 · 전장 전체 점멸과 흔들림은 항상 꺼짐';
  }

  /* ---------- 기록 카드 (공유용 PNG) ---------- */
  makeShareCard(state, best) {
    const memory = E.summarizeRun(state);
    const lanes = ['왼쪽 길', '가운데 길', '오른쪽 길'];
    const kinds = { flare: 'Flare', tide: 'Tide', bloom: 'Bloom' };
    const c = document.createElement('canvas');
    c.width = 720; c.height = 960;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, 960);
    bg.addColorStop(0, '#1c2b4a'); bg.addColorStop(1, '#2b4a72');
    g.fillStyle = bg;
    g.fillRect(0, 0, 720, 960);
    g.textAlign = 'center';
    g.font = '64px "Segoe UI Emoji"';
    g.fillText('🏰', 360, 150);
    g.fillStyle = '#ffd93d';
    g.font = 'bold 52px "Malgun Gothic", sans-serif';
    g.fillText('CONSTELLATION DEFENSE', 360, 240);
    g.fillStyle = '#ffffff';
    g.font = 'bold 88px "Malgun Gothic", sans-serif';
    g.fillText(`${state.wave}웨이브 도달!`, 360, 400);
    g.font = '34px "Malgun Gothic", sans-serif';
    g.fillStyle = '#cfe3ff';
    const lines = [
      `난이도: ${D.DIFFICULTIES[state.difficulty].name}`,
      `물리친 몬스터 ${state.kills}마리`,
      `별자리 전술 ${state.tacticCasts || 0}회 발동`,
      `최고 기록 ${best}웨이브`,
    ];
    lines.splice(3, 0,
      memory.largest.size
        ? `가장 큰 성좌 ${memory.largest.size}개 ${kinds[memory.largest.kind]} · ${lanes[memory.largest.lane]}`
        : '세 갈래 길을 끝까지 수호',
      memory.favoriteLane == null
        ? '세 길을 고르게 방어'
        : `집중 방어 ${lanes[memory.favoriteLane]} · ${memory.favoriteCasts}회`,
      memory.biggestHeal ? `결정적 회복 +${memory.biggestHeal}` : '회복 없이 끝까지 버팀');
    lines.forEach((s, i) => g.fillText(s, 360, 480 + i * 50));
    g.font = '28px "Malgun Gothic", sans-serif';
    g.fillStyle = '#8fb4e8';
    g.fillText(new Date().toLocaleDateString('ko-KR'), 360, 860);
    const a = document.createElement('a');
    a.download = `constellation-defense_${state.wave}wave.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  }
}
