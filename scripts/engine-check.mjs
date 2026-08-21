/* =====================================================
 * 엔진 불변식 검사
 *
 * 밸런스 봇은 "재미있나"를, 이 검사기는 "규약이 지켜지나"를 본다.
 * 실제로 이런 버그가 있었다: 자리 교환이 벤치로 돌아간 용사에게 padIndex=null 을
 * 넣었는데, 자바스크립트에서 null >= 0 이 true라 그 용사가 "배치됨"으로 분류돼
 * 조합할 때 D.PADS[null] 을 읽고 게임이 죽었다. 값 하나가 규약을 벗어나면
 * 멀쩡해 보이다가 전혀 다른 곳에서 터진다.
 *
 *   node scripts/engine-check.mjs
 * ===================================================== */
import * as D from '../src/data.js';
import * as E from '../src/engine.js';
import * as Bot from '../src/bot.js';

let failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`✅ ${name}`);
  else { failed++; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }
};
const fresh = (gold = 99999) => {
  const st = E.createGame({ difficulty: 'normal', fixedSquad: false });
  st.gold = gold;
  return st;
};
const put = (st, cls, tier, pad) => {
  const h = E.makeHero(st, cls, tier);
  st.bench.push(h);
  if (pad != null) E.placeHero(st, h.id, pad);
  return h;
};

/* ---------- ① padIndex 규약: 벤치는 항상 -1, 필드는 항상 유효한 정수 ---------- */
/* ---------- journey party: recruit rules and deterministic node progress ---------- */
{
  const st = E.createGame({ difficulty: 'normal' });
  ok('journey: chapter registry has unique ordered chapters', D.JOURNEY_CHAPTERS.length === 2
    && new Set(D.JOURNEY_CHAPTERS.map((chapter) => chapter.id)).size === D.JOURNEY_CHAPTERS.length
    && E.journeyChapter(st).id === 'dawn-road');
  ok('journey: node lookup is scoped to the saved chapter', E.journeyNode('meadow', st)?.name === '푸른 초원'
    && E.journeyNode('missing', st) === null);
  const classes = st.field.map((hero) => hero.cls).join(',');
  ok('journey: Arin and Luna start as the first two heroes', st.phase === 'journey' && st.bench.length === 0 && classes === 'knight,mage' && st.field[1].heroKey === 'luna', classes);
  ok('journey: Luna is no longer a separate champion', st.champ === null);
  ok('journey: every starting hero grows by level', st.field.every((hero) => hero.tier === 0 && hero.level === 1 && hero.sp === 0));

  const knight = st.field.find((hero) => hero.cls === 'knight');
  const before = knight.dmg;
  const events = [];
  E.gainHeroXp(st, knight, D.heroXpNeed(1), events);
  ok('journey: XP grants a level and specialization point', knight.level === 2 && knight.sp === 1 && knight.dmg > before && events.some((event) => event.type === 'heroLevel'));
  const awayFromTown = E.takeHeroSkill(st, knight.id, 'knight_edge');
  ok('journey: specialization is rejected away from its town facility', !awayFromTown.ok && awayFromTown.reason === 'facility' && awayFromTown.facility === 'forge');

  ok('journey: unreachable nodes are rejected', !E.travelJourney(st, 'boss').ok);
  const battle = E.travelJourney(st, 'meadow');
  const begun = E.prepareJourneyBattle(st);
  ok('journey: a battle node opens a prepared defense', battle.ok && battle.type === 'battle' && begun.ok && st.phase === 'prep' && st.wave === 1);
  const firstDefense = E.journeyBattleProgress(st);
  ok('journey: battle progress exposes 1/2 to the UI', firstDefense?.node.id === 'meadow' && firstDefense.step === 1 && firstDefense.total === 2);
  E.completeJourneyWave(st);
  const secondDefense = E.journeyBattleProgress(st);
  ok('journey: battle progress advances to 2/2 after one clear', secondDefense?.step === 2 && secondDefense.total === 2);
  const complete = E.completeJourneyWave(st);
  ok('journey: short defense returns to the map', complete.complete && st.phase === 'journey' && st.journey.cleared.includes('meadow'));
  const town = E.travelJourney(st, 'town');
  const locked = E.takeHeroSkill(st, knight.id, 'knight_arc');
  ok('journey: milestone skill is rejected early at its facility', !locked.ok && locked.reason === 'level');
  ok('journey: bot waits for the matching town facility before specializing', Bot.nextJourneyHeroSkill(st)?.key === 'knight_edge');
  const skill = E.takeHeroSkill(st, knight.id, 'knight_edge');
  ok('journey: forge spends one specialization point for its matching hero', skill.ok && knight.sp === 0 && knight.skills.knight_edge === 1);
  const recruit = E.recruitJourneyHero(st, 'doyun');
  ok('journey: town offer recruits one named hero', town.ok && town.type === 'recruit' && recruit.ok && st.field.some((hero) => hero.heroKey === 'doyun'));

  const saved = E.serialize(st);
  const back = E.deserialize(JSON.parse(JSON.stringify(saved)));
  const restored = back.field.find((hero) => hero.cls === 'knight');
  ok('journey: hero growth and route state survive save/load', back.squad && back.journey && restored.level === 2 && restored.skills.knight_edge === 1 && back.journey.current === 'town');
  saved.field[0].pad = saved.field[1].pad;
  const repaired = E.deserialize(JSON.parse(JSON.stringify(saved)));
  ok('journey: duplicate saved pads are repaired', new Set(repaired.field.map((hero) => hero.padIndex)).size === repaired.field.length);
  const next = E.nextLoop(st);
  const carried = next.field.find((hero) => hero.heroKey === 'arin');
  ok('journey: party growth survives a trial', next.field.length === 3 && carried.level === 2 && carried.skills.knight_edge === 1);
}

/* ---------- chapter transition, save/restore, and one-time ending ---------- */
{
  const st = E.createGame({ difficulty: 'normal' });
  const arin = st.field.find((hero) => hero.heroKey === 'arin');
  arin.level = 4; arin.xp = 17; arin.sp = 2; arin.skills.knight_edge = 1;
  st.gold = 432; st.castleHp = 71;
  st.journey.current = 'boss';
  st.journey.visited = D.JOURNEY_CHAPTERS[0].nodes.map((node) => node.id);
  st.journey.cleared = ['meadow', 'boss'];
  st.journey.complete = true;
  const before = { gold: st.gold, hp: st.castleHp, level: arin.level, skill: arin.skills.knight_edge };
  const moved = E.advanceJourneyChapter(st);
  const movedArin = st.field.find((hero) => hero.heroKey === 'arin');
  ok('chapter: completed Act 1 opens Act 2 at its authored start', moved.ok
    && st.journey.chapter === 'beyond-page' && st.journey.current === 'turned-gate' && !st.journey.complete);
  ok('chapter: Act 1 result is archived without resetting run state', st.journey.history.length === 1
    && st.journey.history[0].chapter === 'dawn-road' && st.journey.history[0].complete
    && st.gold === before.gold && st.castleHp === before.hp && movedArin.level === before.level
    && movedArin.skills.knight_edge === before.skill);

  const restored = E.deserialize(JSON.parse(JSON.stringify(E.serialize(st))));
  ok('chapter: Act 2 and Act 1 history survive save/restore', restored.journey.chapter === 'beyond-page'
    && restored.journey.current === 'turned-gate' && restored.journey.history[0]?.cleared.includes('boss')
    && restored.field.find((hero) => hero.heroKey === 'arin')?.level === 4);
  ok('chapter: ending is locked until Act 2 completion', !E.chooseJourneyEnding(restored, 'seal').ok);
  restored.journey.complete = true;
  ok('chapter: bot uses the same public ending state', Bot.nextJourneyEnding(restored) === 'coauthor');
  const ending = E.chooseJourneyEnding(restored, 'coauthor');
  const repeat = E.chooseJourneyEnding(restored, 'seal');
  ok('chapter: one authored ending is chosen exactly once', ending.ok && ending.ending.key === 'coauthor'
    && !repeat.ok && repeat.reason === 'chosen' && restored.journey.ending === 'coauthor');
  const endingBack = E.deserialize(JSON.parse(JSON.stringify(E.serialize(restored))));
  ok('chapter: ending choice survives save/restore', endingBack.journey.ending === 'coauthor'
    && endingBack.journey.history[0]?.chapter === 'dawn-road');
}

/* ---------- Act 2 authored map, route consequence, notes, refugee state ---------- */
{
  const chapter = D.JOURNEY_CHAPTERS.find((entry) => entry.id === 'beyond-page');
  const ids = chapter.nodes.map((node) => node.id);
  const regions = new Set(chapter.nodes.map((node) => node.region).filter(Boolean));
  ok('act2: exactly eight authored nodes have unique ids', chapter.nodes.length === 8 && new Set(ids).size === 8);
  ok('act2: three new battle regions are assigned', [...regions].sort().join(',') === 'ashen-margin,manuscript-core,neon-ruins');
  ok('act2: required hunter-fiction beats are present', ['turned-gate', 'seoul-gate', 'alignment-hub', 'refugee-station', 'corrector-hunt', 'nameless-archive', 'correction-gates', 'manuscript-core'].every((id) => ids.includes(id)));
  const direct = E.createGame({ difficulty: 'normal', journeyChapter: 'beyond-page' });
  ok('act2: local QA can create a clean chapter scene without mutating progression', direct.journey.chapter === 'beyond-page'
    && direct.journey.current === 'turned-gate' && direct.journey.annotations.includes('next-page'));

  const st = E.createGame({ difficulty: 'normal' });
  st.journey.current = 'boss'; st.journey.complete = true;
  E.advanceJourneyChapter(st);
  ok('act2: opening margin note is collected on transition', E.latestJourneyAnnotation(st)?.id === 'next-page');
  E.travelJourney(st, 'seoul-gate');
  E.prepareJourneyBattle(st);
  E.completeJourneyWave(st); E.completeJourneyWave(st); E.completeJourneyWave(st);
  E.travelJourney(st, 'alignment-hub');
  ok('act2: route hub blocks travel until an explicit public choice', E.journeyChoices(st).length === 0
    && E.travelJourney(st, 'refugee-station').reason === 'choice');
  const market = E.chooseJourneyPath(st, 'market');
  const repeat = E.chooseJourneyPath(st, 'guild');
  ok('act2: market/guild choice is single and deterministic', market.ok && market.choice.key === 'market'
    && !repeat.ok && repeat.reason === 'chosen' && st.journey.flags['alignment-hub'] === 'market');

  st.castleHp = Math.round(st.castleMax * .7);
  const station = E.travelJourney(st, 'refugee-station');
  ok('act2: refugee station derives visible state from route and castle health', station.ok && station.type === 'town'
    && station.refuge.ally === 'market' && station.refuge.survivors === 30 && station.refuge.morale === 4);
  const stationBack = E.deserialize(JSON.parse(JSON.stringify(E.serialize(st))));
  ok('act2: branch, notes, and refugee state survive save/restore', stationBack.journey.flags['alignment-hub'] === 'market'
    && stationBack.journey.refuge.survivors === 30 && stationBack.journey.annotations.includes('station-register'));

  E.travelJourney(st, 'corrector-hunt'); E.prepareJourneyBattle(st);
  E.completeJourneyWave(st); E.completeJourneyWave(st); E.completeJourneyWave(st);
  ok('act2: defending the next region improves the station', st.journey.refuge.defenses === 1
    && st.journey.refuge.survivors === 33 && st.journey.refuge.morale === 5);
  E.travelJourney(st, 'nameless-archive');
  E.travelJourney(st, 'correction-gates'); E.prepareJourneyBattle(st);
  for (let i = 0; i < 4; i++) E.completeJourneyWave(st);
  E.travelJourney(st, 'manuscript-core'); E.prepareJourneyBattle(st);
  for (let i = 0; i < 5; i++) E.completeJourneyWave(st);
  ok('act2: final defense completes the chapter and collects the last margin', st.journey.complete
    && st.journey.cleared.includes('manuscript-core') && E.latestJourneyAnnotation(st)?.id === 'last-margin'
    && st.journey.refuge.defenses === 3);
}

/* ---------- Act 2 market monster blueprint ---------- */
{
  const locked = E.createGame({ difficulty: 'normal', journeyChapter: 'beyond-page' });
  locked.phase = 'wave';
  locked.enemies = [{ id: 10, route: 0, s: 10, dead: false }];
  ok('blueprint: non-market routes cannot use the monster command', E.castMonsterBlueprint(locked).reason === 'locked');

  const st = E.createGame({ difficulty: 'normal', journeyChapter: 'beyond-page' });
  st.journey.current = 'alignment-hub';
  E.chooseJourneyPath(st, 'market');
  st.phase = 'wave'; st.wave = 13;
  st.enemies = [
    { id: 20, route: 0, s: D.ROUTE_LENS[0] * .25, dead: false },
    { id: 21, route: 2, s: D.ROUTE_LENS[2] * .72, dead: false, midBoss: true },
  ];
  const decision = Bot.nextMonsterBlueprint(st, { activeUse: 1 }, () => 0);
  const cast = E.castMonsterBlueprint(st, decision?.route);
  ok('blueprint: bot and player share the public availability rule', decision?.route === 2 && cast.ok && cast.summon.route === 2);
  ok('blueprint: one summon consumes the defense charge', st.blueprintCasts === 1
    && st.blueprintUsedWave === 13 && E.castMonsterBlueprint(st).reason === 'charge');
  const events = [];
  E.updateMonsterBlueprints(st, .2, events);
  ok('blueprint: summoned clerk fires a normal tracked projectile', st.projectiles.length === 1
    && st.projectiles[0].kind === 'blueprint' && events.some((event) => event.type === 'blueprintAttack'));
  st.blueprintSummons[0].life = .01;
  E.updateMonsterBlueprints(st, .02, events);
  ok('blueprint: temporary summons leave no persistent combat actor', st.blueprintSummons.length === 0
    && events.some((event) => event.type === 'blueprintDismiss'));
  st.phase = 'journey'; st.projectiles = []; st.blueprintSummons = [];
  const back = E.deserialize(JSON.parse(JSON.stringify(E.serialize(st))));
  ok('blueprint: market unlock and cast count survive save/load', E.availableMonsterBlueprint(back)?.key === 'clerk-goblin'
    && back.blueprintCasts === 1 && back.blueprintSummons.length === 0);
}

/* ---------- 지역 조우: 지휘관+졸개 → 지역 보스+지휘관 호위 ---------- */
{
  const st = E.createGame({ difficulty: 'normal', rng: Bot.mulberry32(812) });
  E.travelJourney(st, 'meadow');
  E.prepareJourneyBattle(st);
  const commander = E.journeyEncounter(st);
  const commanderWave = st.pendingWave;
  const mid = commanderWave.find((spawn) => D.ENEMY_TYPES[spawn.type]?.midBoss);
  const commanderMinions = commanderWave.filter((spawn) =>
    spawn.type && !D.ENEMY_TYPES[spawn.type]?.midBoss && !D.ENEMY_TYPES[spawn.type]?.boss
    && Math.abs(spawn.t - mid.t) <= 0.5);
  ok('지역 조우: 마지막 전 방어는 지휘관전', commander.kind === 'commander' && !commander.boss);
  ok('지역 조우: 중간보스는 세 길의 졸개와 함께 등장', !!mid && new Set(commanderMinions.map((spawn) => spawn.route)).size === 3);

  E.completeJourneyWave(st);
  st.wave++;
  const regionBoss = E.journeyEncounter(st);
  const bossWave = E.buildWave(st);
  const bosses = bossWave.filter((spawn) => D.ENEMY_TYPES[spawn.type]?.boss);
  const lieutenants = bossWave.filter((spawn) => spawn.lieutenant);
  ok('지역 조우: 지역의 마지막 방어가 대보스전', regionBoss.kind === 'regional-boss' && regionBoss.boss);
  ok('지역 조우: 첫 지역 보스는 중간보스 호위와 동시에 등장', bosses.length === 1 && lieutenants.length === 1
    && Math.abs(bosses[0].t - lieutenants[0].t) < 0.5);
  st.pendingWave = bossWave;
  const started = E.startWave(st);
  ok('지역 조우: 웨이브 시작 결과도 지역 보스를 알림', started.ok && started.boss && started.encounter.kind === 'regional-boss');

  const legacy = E.createGame({ difficulty: 'normal', fixedSquad: true, journey: false, rng: Bot.mulberry32(813) });
  legacy.wave = 5;
  const fifth = E.buildWave(legacy);
  ok('지역 조우: 5의 배수만으로 대보스가 나오지 않음', !fifth.some((spawn) => D.ENEMY_TYPES[spawn.type]?.boss));

  const finale = E.createGame({ difficulty: 'normal', rng: Bot.mulberry32(814) });
  finale.journey.current = 'boss';
  finale.journey.activeBattle = 'boss';
  finale.journey.wavesInBattle = 4;
  finale.wave = 11;
  const finalWave = E.buildWave(finale);
  const finalBosses = finalWave.filter((spawn) => D.ENEMY_TYPES[spawn.type]?.boss);
  const finalLieutenants = finalWave.filter((spawn) => spawn.lieutenant);
  ok('지역 조우: 최종 지역 보스는 좌우 중간보스 둘과 편대 등장', finalBosses.length === 1
    && finalLieutenants.length === 2
    && finalLieutenants.map((spawn) => spawn.route).join(',') === '0,2'
    && finalLieutenants.every((spawn) => Math.abs(spawn.t - finalBosses[0].t) < 0.5));
  const regionClearAchievement = D.ACHIEVEMENTS.find((achievement) => achievement.key === 'boss3');
  finale.bossKills = 2;
  ok('지역 조우: 두 지역 보스를 잡으면 보스 업적 달성', regionClearAchievement.check({ state: finale }));
}

      /* ---------- named hero actives: one engine command for UI and bots ---------- */
function heroActiveState(heroKey) {
  const st = E.createGame({
    difficulty: 'normal', fixedSquad: true, journey: false,
    partyKeys: [heroKey], rng: Bot.mulberry32(731),
  });
  E.startWave(st);
  st.spawnQueue = [0, 1, 2, 0, 1, 2].map((route) => ({ t: 0, type: 'troll', route }));
  st.spawnQueue.push({ t: 999, type: 'troll', route: 1 });
  E.tick(st, .001);
  return st;
}

for (const spec of D.SQUAD) {
  const st = heroActiveState(spec.key);
  const hero = st.field[0];
  const active = D.heroActiveSpec(spec.key);
  const hpBefore = st.enemies.reduce((sum, enemy) => sum + enemy.hp, 0);
  const result = E.castHeroActive(st, hero.id);
  const hpAfter = st.enemies.reduce((sum, enemy) => sum + enemy.hp, 0);
  ok(`영웅 액티브: ${spec.name} ${active.name}`, result.ok
    && result.events[0]?.type === 'heroActive'
    && result.events[0]?.kind === active.kind
    && hero.activeCd === active.cooldown
    && hpAfter < hpBefore
    && st.heroActiveCasts === 1);
  const cooldown = E.castHeroActive(st, hero.id);
  ok(`영웅 액티브: ${spec.name} 쿨다운`, !cooldown.ok && cooldown.reason === 'cd');
}

{
  const prep = E.createGame({ fixedSquad: true, journey: false, partyKeys: ['arin'] });
  const hero = prep.field[0];
  ok('영웅 액티브: 준비 단계 잠금', E.castHeroActive(prep, hero.id).reason === 'phase');
  E.startWave(prep);
  prep.spawnQueue = [{ t: 999, type: 'troll', route: 0 }];
  ok('영웅 액티브: 적이 없으면 보존', E.castHeroActive(prep, hero.id).reason === 'none' && hero.activeCd === 0);
  hero.activeCd = 5;
  E.tick(prep, 1.25);
  ok('영웅 액티브: 전투 시간만큼 쿨다운 감소', Math.abs(hero.activeCd - 3.75) < 1e-9);
  prep.phase = 'prep';
  E.startWave(prep);
  ok('영웅 액티브: 다음 방어 시작 때 준비 완료', hero.activeCd === 0);
}

function padIndexSane(st, label) {
  const bad = [];
  for (const h of st.bench) if (h.padIndex !== -1) bad.push(`bench ${h.cls}#${h.id} padIndex=${JSON.stringify(h.padIndex)}`);
  for (const h of st.field) {
    if (!Number.isInteger(h.padIndex) || h.padIndex < 0 || h.padIndex >= D.PADS.length) {
      bad.push(`field ${h.cls}#${h.id} padIndex=${JSON.stringify(h.padIndex)}`);
    }
  }
  ok(`padIndex 규약 (${label})`, bad.length === 0, bad.join(', '));
}

{
  const st = fresh();
  put(st, 'knight', 0, 0);
  put(st, 'archer', 0, 3);
  put(st, 'mage', 0, null);
  padIndexSane(st, '배치 직후');

  E.recallHero(st, st.field[0].id);
  padIndexSane(st, '회수 후');

  E.moveHero(st, st.field[0].id, 7);
  padIndexSane(st, '이동 후');

  const a = st.field[0];
  const b = put(st, 'guard', 0, 5);
  E.swapHeroes(st, a.id, b.id);
  padIndexSane(st, '필드끼리 교환 후');
}

{
  /* 회귀: 벤치 용사를 찬 발판에 놓아 교환한 뒤의 상태 */
  const st = fresh();
  const placed = put(st, 'knight', 0, 0);
  const benched = put(st, 'knight', 0, null);
  E.swapBenchWithPad(st, benched.id, 0);
  padIndexSane(st, '벤치↔필드 교환 후');
  ok('교환: 벤치 용사가 발판으로', E.padOccupant(st, 0)?.id === benched.id);
  ok('교환: 밀려난 용사가 벤치로', st.bench.some(h => h.id === placed.id));
  ok('교환: 인원 수 보존', st.field.length === 1 && st.bench.length === 1);

  /* 이 상태에서 조합이 터지지 않아야 한다 (실제로 여기서 죽었다) */
  let crash = null;
  try {
    E.listCombos(st);
    const r = E.combineRankUp(st, 'knight', 0);
    ok('교환 후 조합 성공', r.ok, JSON.stringify(r));
    ok('교환 후 조합 결과가 유효한 발판에', r.pad === -1 || (Number.isInteger(r.pad) && r.pad >= 0));
  } catch (e) {
    crash = `${e.constructor.name}: ${e.message}`;
  }
  ok('교환 후 조합이 예외를 던지지 않음', crash === null, crash || '');
}

/* ---------- ② 벤치가 가득해도 교환은 된다 ---------- */
{
  const st = fresh();
  const placed = put(st, 'knight', 0, 0);
  while (st.bench.length < D.BENCH_MAX) put(st, 'archer', 0, null);
  const inc = st.bench[0];
  const before = { bench: st.bench.length, field: st.field.length };
  const r = E.swapBenchWithPad(st, inc.id, 0);
  ok('벤치 가득 상태에서도 교환 성공', r.ok);
  ok('교환이 인원 수를 바꾸지 않음', st.bench.length === before.bench && st.field.length === before.field,
    `${before.bench}/${before.field} → ${st.bench.length}/${st.field.length}`);
  ok('밀려난 용사가 벤치에', st.bench.some(h => h.id === placed.id));
  padIndexSane(st, '벤치 만석 교환 후');
}

/* ---------- ③ 쿨다운 승계: 갈아 끼워도 공격이 앞당겨지지 않는다 ---------- */
{
  const st = fresh();
  const on = put(st, 'knight', 0, 2);
  on.cd = 0.77;
  const inc = put(st, 'mage', 0, null);
  const r = E.swapBenchWithPad(st, inc.id, 2);
  ok('교환 시 쿨다운 승계', r.ok && Math.abs(r.placed.cd - 0.77) < 1e-9, `cd=${r.placed && r.placed.cd}`);

  const x = put(st, 'archer', 0, 6);
  const y = put(st, 'guard', 0, 8);
  x.cd = 0.5; y.cd = 0.2;
  E.swapHeroes(st, x.id, y.id);
  ok('필드끼리 교환도 쿨다운 유지', x.cd === 0.5 && y.cd === 0.2);
}

/* ---------- ④ 발판 점유는 언제나 1명 ---------- */
{
  const st = fresh();
  for (let i = 0; i < 6; i++) put(st, 'knight', 0, i);
  for (let i = 0; i < 40; i++) {
    const h = st.field[i % st.field.length];
    E.moveHero(st, h.id, (i * 5) % D.PADS.length);
  }
  const counts = new Map();
  for (const h of st.field) counts.set(h.padIndex, (counts.get(h.padIndex) || 0) + 1);
  ok('한 발판에 두 명이 겹치지 않음', [...counts.values()].every(v => v === 1));
  padIndexSane(st, '이동 40회 후');
}

/* ---------- ⑤ 조합 재료는 벤치+필드를 함께 센다 ---------- */
{
  const st = fresh();
  put(st, 'knight', 0, 0);      // 배치
  put(st, 'knight', 0, null);   // 벤치
  const combos = E.listCombos(st);
  ok('배치+벤치가 한 쌍으로 잡힌다', combos.some(c => c.kind === 'rankup' && c.cls === 'knight'));
}

/* ---------- ⑥ 레시피 재료: 같은 등급 2명끼리만 ----------
 * 실제로 이런 일이 있었다: 전설 검사 + 일반 마법사를 조합하면 "최고 등급" 재료를
 * 소비해서 전설이 갈려 나가고 희귀 마검사가 나왔다 — 조합할수록 약해지고,
 * 플레이어 눈에는 영웅이 사라진 것처럼 보인다. 지금은 등급업과 규칙이 하나다:
 * 같은 등급 2명 = 등급 UP. 등급이 다른 용사는 재료 후보조차 되지 않는다. */
{
  /* 전설 검사(배치) + 일반 검사 + 일반 마법사: 일반끼리 조합돼야 한다 (전설 보호) */
  const st = fresh();
  const legend = put(st, 'knight', 3, 0);
  put(st, 'knight', 0, null);
  put(st, 'mage', 0, null);
  const r = E.combineRecipe(st, 'spellblade');
  ok('같은 등급(일반) 짝으로 조합된다', r.ok && r.hero.tier === 1, JSON.stringify(r));
  ok('전설 용사는 재료로 소비되지 않는다', st.field.some(h => h.id === legend.id));

  /* 전설 검사 + 일반 마법사뿐: 같은 등급 짝이 없다 — 조합이 아예 나오지 않는다 */
  const st2 = fresh();
  put(st2, 'knight', 3, 0);
  put(st2, 'mage', 0, null);
  const combos = E.listCombos(st2);
  ok('등급이 다르면 조합이 제안되지 않는다',
    !combos.some(c => c.kind === 'recipe' && c.result === 'spellblade'));
  const rs = E.recipeStatus(st2, D.RECIPES.find(x => x.result === 'spellblade'));
  ok('그 이유가 gap으로 표시된다', rs.state === 'gap' && rs.low === 'mage', JSON.stringify(rs));
  ok('gap 상태에선 실행도 거부된다', !E.combineRecipe(st2, 'spellblade').ok);

  /* 한 등급 차이(전설+영웅)도 이제 안 된다 — 같은 등급만 */
  const st3 = fresh();
  put(st3, 'knight', 3, 0);
  put(st3, 'mage', 2, null);
  ok('한 등급 차이도 조합 불가', !E.combineRecipe(st3, 'spellblade').ok
    && E.recipeStatus(st3, D.RECIPES.find(x => x.result === 'spellblade')).state === 'gap');

  /* 같은 등급이면 된다 — 영웅 검사 + 영웅 마법사 = 전설 마검사 */
  const st4 = fresh();
  put(st4, 'knight', 2, 0);
  put(st4, 'mage', 2, null);
  const r4 = E.combineRecipe(st4, 'spellblade');
  ok('같은 등급 조합은 그 등급 +1', r4.ok && r4.hero.tier === 3, JSON.stringify(r4));

  /* 여러 등급이 겹치면 가장 높은 결과를 만드는 짝을 고른다 */
  const st5 = fresh();
  put(st5, 'knight', 0, null); put(st5, 'knight', 2, null);
  put(st5, 'mage', 0, null); put(st5, 'mage', 2, null);
  const pair = E.bestRecipePair(st5, D.RECIPES.find(x => x.result === 'spellblade'));
  ok('같은 등급 짝이 여럿이면 높은 쪽 우선', pair && pair.ta === 2 && pair.tb === 2 && pair.resultTier === 3,
    JSON.stringify(pair));
}

/* ---------- ⑦ 무작위 상태에서도: 제안된 조합은 언제나 "같은 등급 → +1" ---------- */
{
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let bad = 0;
  for (let trial = 0; trial < 300; trial++) {
    const st = fresh();
    const n = 2 + Math.floor(rnd() * 6);
    for (let i = 0; i < n; i++) {
      const cls = D.CLASS_KEYS[Math.floor(rnd() * D.CLASS_KEYS.length)];
      put(st, cls, Math.floor(rnd() * (D.maxTierOf(cls) + 1)), null);
    }
    for (const c of E.listCombos(st)) {
      if (c.kind === 'recipe' && (c.ta !== c.tb || c.resultTier !== c.ta + 1)) bad++;
      if (c.kind === 'rankup' && c.resultTier < c.tier) bad++;
    }
  }
  ok('무작위 300판: 재료 등급 불일치·등급 하락 제안 없음', bad === 0, `${bad}건`);
}

/* ---------- ⑧ 저장/불러오기 왕복 ---------- */
{
  const st = fresh(777);
  st.wave = 9;
  st.castle.fortify = 2;
  st.castle.tower = 1;
  st.castleMax = 160;
  st.castleHp = 120;
  put(st, 'knight', 3, 0);
  put(st, 'spellblade', 2, 5);
  put(st, 'archer', 1, null);
  st.discovered.add('spellblade');
  st.kills = 123;
  st.combos = 7;
  st.runMemory = {
    byLane: [1, 4, 2], byKind: { flare: 3, tide: 2, bloom: 2 },
    largest: { size: 5, kind: 'flare', lane: 1 },
    biggestHeal: 21, biggestPush: 3, lowestCastleHp: 34,
  };
  const data = E.serialize(st);
  const back = E.deserialize(JSON.parse(JSON.stringify(data)));   // 파일 왕복과 같다
  const memory = E.summarizeRun(back);
  ok('불러오기: 수호의 기억 유지', memory.favoriteLane === 1 && memory.favoriteCasts === 4
    && memory.largest.size === 5 && memory.biggestHeal === 21 && memory.lowestCastleHp === 34);
  ok('불러오기: 복원된다', !!back);
  ok('불러오기: 골드/웨이브/성 유지',
    back.gold === 777 && back.wave === 9 && back.castleHp === 120 && back.castleMax === 160
    && back.castle.fortify === 2 && back.castle.tower === 1);
  ok('불러오기: 용사와 배치 유지',
    back.field.length === 2 && back.bench.length === 1
    && back.field.some(h => h.cls === 'knight' && h.tier === 3 && h.padIndex === 0)
    && back.field.some(h => h.cls === 'spellblade' && h.tier === 2 && h.padIndex === 5)
    && back.bench.some(h => h.cls === 'archer' && h.tier === 1));
  ok('불러오기: 도감/통계 유지', back.discovered.has('spellblade') && back.kills === 123 && back.combos === 7);
  ok('불러오기: 준비 단계에서 시작',
    back.phase === 'prep' && Array.isArray(back.pendingWave) && back.pendingWave.length > 0
    && back.enemies.length === 0 && back.projectiles.length === 0);
  padIndexSane(back, '불러온 뒤');

  ok('망가진 파일은 null', E.deserialize({ hello: 1 }) === null && E.deserialize(null) === null);

  /* 손으로 고친 파일: 겹친 발판·초과 등급·모르는 직업이 게임을 깨면 안 된다 */
  const evil = JSON.parse(JSON.stringify(data));
  evil.field[1].pad = 0;                                   // 발판 겹침
  evil.bench[0].tier = 99;                                 // 등급 초과
  evil.bench.push({ cls: 'no-such-class', tier: 1, pad: 3 });
  const b2 = E.deserialize(evil);
  ok('겹친 발판의 용사는 벤치로 대피', b2.field.length === 1 && b2.bench.length === 2,
    `field=${b2.field.length} bench=${b2.bench.length}`);
  ok('등급은 그 직업의 천장으로 잘린다', [...b2.bench, ...b2.field].every(h => h.tier <= D.maxTierOf(h.cls)));
  padIndexSane(b2, '망가진 파일 복원 후');
}

/* ---------- ⑥ 별지기: 성장 · 스킬 선행 · 부활 · 마법 · 저장 왕복 ---------- */
{
  const st = fresh();
  ok('별지기 초기 상태', st.champ && st.champ.level === 1 && st.champ.hp === st.champ.maxHp && !st.champ.ko);

  E.gainChampXp(st, 10000, []);
  ok('별지기 레벨업과 포인트', st.champ.level > 1 && st.champ.sp >= st.champ.level - 1);

  const locked = E.takeSkill(st, 'blade3');                 // 선행 3포인트 없이 → 거부
  ok('스킬 선행 조건이 막는다', !locked.ok && locked.reason === 'need');
  E.takeSkill(st, 'blade1'); E.takeSkill(st, 'blade1'); E.takeSkill(st, 'blade1');
  ok('선행을 채우면 열린다', E.takeSkill(st, 'blade3').ok);
  ok('랭크 상한', !E.takeSkill(st, 'blade3').ok);           // max 1

  const spBefore = st.champ.sp;
  const data = E.serialize(st);
  const back = E.deserialize(JSON.parse(JSON.stringify(data)));
  ok('별지기 저장 왕복', back.champ.level === st.champ.level
    && (back.champ.skills.blade1 || 0) === 3 && (back.champ.skills.blade3 || 0) === 1
    && back.champ.sp === spBefore && back.champ.hp === back.champ.maxHp);

  /* 손으로 고친 파일: 모르는 스킬은 버리고 랭크는 상한으로 */
  const evil = JSON.parse(JSON.stringify(data));
  evil.champ.skills.hack = 99;
  evil.champ.skills.blade1 = 99;
  evil.champ.level = 9999;
  const b2 = E.deserialize(evil);
  ok('별지기 파일 방어', !('hack' in b2.champ.skills)
    && b2.champ.skills.blade1 === D.CHAMP_SKILLS.blade1.max
    && b2.champ.level <= D.CHAMP_XP.maxLevel);
}
{
  /* KO → 웨이브가 끝나면 부활 + 붙잡힌 적이 남지 않는다 */
  const st = fresh();
  E.startWave(st);
  st.champ.hp = 0;
  st.champ.ko = true;
  st.spawnQueue = [];
  st.enemies = [];
  E.tick(st, 0.05);                                         // endWave 유도
  ok('별지기 부활', st.phase === 'prep' && !st.champ.ko && st.champ.hp === st.champ.maxHp);
}
{
  /* 별똥별: 시전 → 쿨다운 → 재시전 거부, 피해가 실제로 들어간다 */
  const st = fresh();
  E.startWave(st);
  let guard = 0;
  while (!st.enemies.length && guard++ < 4000) E.tick(st, 0.05);
  ok('(전제) 적이 스폰된다', st.enemies.length > 0);
  const total = () => st.enemies.reduce((s, e) => s + e.hp, 0);
  const before = total();
  const r = E.castStar(st);
  ok('별똥별 시전', r.ok && st.champ.spellCd > 0 && st.starCasts === 1);
  ok('별똥별 피해', total() < before || st.enemies.some(e => e.dead));
  const r2 = E.castStar(st);
  ok('별똥별 쿨다운이 막는다', !r2.ok && r2.reason === 'cd');
  /* 은하수: 충전 없이는 거부, 채우면 전 화면 타격.
   * 별똥별이 첫 분대를 전멸시켰을 수 있으니 산 적이 다시 나올 때까지 돌린다 */
  st.champ.ult = 0;
  ok('은하수 충전 부족 거부', !E.castUlt(st).ok);
  guard = 0;
  while (st.phase === 'wave' && !st.enemies.some(e => !e.dead) && guard++ < 4000) E.tick(st, 0.05);
  ok('(전제) 적이 다시 있다', st.phase === 'wave' && st.enemies.some(e => !e.dead));
  st.champ.ult = 1;
  const b4 = total();
  const u = E.castUlt(st);
  /* 시전하면 0에서 다시 시작한다 — 단, 은하수가 잡은 적들이 곧바로 조금 재충전한다 */
  ok('은하수 시전', u.ok && st.champ.ult < 0.5 && st.ultCasts === 1);
  ok('은하수 전체 타격', total() < b4 || st.enemies.some(e => e.dead));
}
{
  /* 준비 단계에는 마법이 잠긴다 (마법은 전투의 손이다) */
  const st = fresh();
  const r = E.castStar(st);
  ok('준비 단계 마법 잠금', !r.ok && r.reason === 'phase');
}

/* ---------- ⑦ 별자리 전술: 효과별 결과와 잭팟 보정 ---------- */
function tacticState(route = 0, count = 1) {
  const st = fresh();
  E.startWave(st);
  /* 웨이브 난수에 기대지 않고, 원하는 길에 실제 스폰 경로로 적을 만든다. */
  st.spawnQueue = Array.from({ length: count }, () => ({ t: 0, type: 'goblin', route }));
  E.tick(st, 0.001);
  return st;
}
{
  const prep = fresh();
  const locked = E.castTactic(prep, 0, 'flare', 3);
  ok('전술: 준비 단계 잠금', !locked.ok && locked.reason === 'phase');

  const flare = tacticState(0, 6);
  const hpBefore = flare.enemies.reduce((sum, e) => sum + e.hp, 0);
  const fr = E.castTactic(flare, 0, 'flare', 3);
  const flareMemory = E.summarizeRun(flare);
  ok('전술: 가장 큰 성좌와 집중 방어로를 기억한다', flareMemory.largest.size === 3
    && flareMemory.largest.kind === 'flare' && flareMemory.favoriteLane === 0);
  const hpAfter = flare.enemies.reduce((sum, e) => sum + e.hp, 0);
  ok('전술: Flare가 피해·별똥별 이벤트를 낸다', fr.ok && fr.events.filter(e => e.type === 'starfall').length === 3 && hpAfter < hpBefore);
  ok('전술: Flare 별똥별이 착탄 피해 표식을 낸다', fr.events.filter(e => e.type === 'starfall')
    .every(e => e.tactic === 'flare' && e.dmg > 0 && [3, 4, 5].includes(e.stars)));
  ok('전술: 성공한 시전만 전술 기록에 남는다', flare.tacticCasts === 1);

  const linked = tacticState(0, 2);
  linked.field = [
    { id: 91, heroKey: 'arin', name: '아린', activeCd: 5, x: 140, y: 190 },
    { id: 92, heroKey: 'sera', name: '세라', activeCd: 1.5, x: 210, y: 190 },
    { id: 93, heroKey: 'luna', name: '루나', activeCd: 5, x: 280, y: 190 },
  ];
  const linkedCast = E.castTactic(linked, 0, 'flare', 4);
  ok('전술 영웅 연계: Flare 퍼즐이 아린·세라 액티브를 충전한다', linkedCast.ok
    && linked.field[0].activeCd === 3 && linked.field[1].activeCd === 0 && linked.field[2].activeCd === 5
    && linkedCast.events.filter((event) => event.type === 'tacticHeroLink').length === 2
    && linkedCast.events.some((event) => event.type === 'tacticHeroLink' && event.heroKey === 'sera' && event.ready));

  const flare4 = tacticState(0, 6);
  const flare5 = tacticState(0, 6);
  const f4 = E.castTactic(flare4, 0, 'flare', 4);
  const f5 = E.castTactic(flare5, 0, 'flare', 5);
  const aid = tacticState(1, 2);
  const aid4 = E.castTactic(aid, 1, 'tide', 4);
  const aid5 = E.castTactic(aid, 1, 'tide', 5);
  ok('constellation aid: four/five matches add one/two marks and finish the set', aid4.ok && aid5.ok
    && aid.constellationAid.charge === D.TACTICS.constellationAid.chargeNeeded
    && aid5.events.some((event) => event.type === 'constellationReady'));
  const heldAid = E.deserialize(JSON.parse(JSON.stringify(E.serialize(aid))));
  ok('constellation aid: a completed set survives save/load for a later boss',
    heldAid.constellationAid.charge === D.TACTICS.constellationAid.chargeNeeded && heldAid.constellationAids.length === 0);
  const target = aid.enemies[0];
  target.boss = true;
  const castAid = E.castConstellationAid(aid, 1);
  const aidEvents = E.tick(aid, .11);
  const aidShot = aid.projectiles.find((projectile) => projectile.kind === 'constellation');
  ok('constellation aid: combat summon fires a boss-strengthened star shot', castAid.ok
    && aid.constellationAid.charge === 0 && aid.constellationAidCasts === 1
    && aidEvents.some((event) => event.type === 'constellationAidAttack')
    && aidShot?.dmg === Math.round(D.TACTICS.constellationAid.damage * D.TACTICS.constellationAid.bossDamageMul));
  aid.constellationAids[0].life = .01;
  const dismissEvents = E.tick(aid, .02);
  ok('constellation aid: temporary guardian ends inside the defense boundary', aid.constellationAids.length === 0
    && dismissEvents.some((event) => event.type === 'constellationAidDismiss'));
  ok('전술: 4매치는 Flare 대상을 다섯까지 넓힌다', f4.ok && f4.events.filter(e => e.type === 'starfall').length === 5);
  ok('전술: 5매치는 Flare 대상을 전부 넓힌다', f5.ok && f5.events.filter(e => e.type === 'starfall').length === 6);

  const tide = tacticState(1, 2);
  const tr = E.castTactic(tide, 1, 'tide', 5);
  ok('전술: Tide가 전 적을 강하게 감속한다', tr.ok && tide.enemies.every(e => e.slowMul === 0.18 && e.slowT === 4.5));

  const bloom = tacticState(2, 2);
  bloom.castleHp = bloom.castleMax - 30;
  for (const e of bloom.enemies) {
    e.s = 160;
    const p = D.routePoint(e.route, e.s);
    e.x = p.x; e.y = p.y;
  }
  const beforeS = bloom.enemies.map(e => e.s);
  const br = E.castTactic(bloom, 2, 'bloom', 4);
  const bloomMemory = E.summarizeRun(bloom);
  ok('전술: 실제 회복량과 후퇴 수를 기억한다', bloomMemory.biggestHeal === Math.min(30, br.events.find(e => e.type === 'castleHeal').amount)
    && bloomMemory.biggestPush === 2 && bloomMemory.lowestCastleHp === bloom.castleMax - 30);
  ok('전술: Bloom이 성을 회복하고 적을 밀어낸다', br.ok && bloom.castleHp > bloom.castleMax - 30
    && bloom.enemies.every((e, i) => e.s < beforeS[i]) && br.events.filter(e => e.type === 'tacticPush').length === 2);

  const empty = tacticState(0, 1);
  const none = E.castTactic(empty, 1, 'tide', 3);
  ok('전술: 적 없는 길은 상태를 바꾸지 않고 거부한다', !none.ok && none.reason === 'none' && empty.tacticCasts === 0);

  const skilledFlare = tacticState(0, 6);
  skilledFlare.field.push({ skills: { knight_edge: 1, archer_pierce: 1 } });
  const sfr = E.castTactic(skilledFlare, 0, 'flare', 3);
  ok('전문화: 별날은 Flare 피해를 높인다', sfr.events.find(e => e.type === 'starfall').dmg > fr.events.find(e => e.type === 'starfall').dmg);
  ok('전문화: 관통 성시는 3매치 Flare 대상을 늘린다', sfr.events.filter(e => e.type === 'starfall').length === 4);

  const skilledTide = tacticState(1, 1);
  skilledTide.field.push({ skills: { guard_tide: 1, mage_frost: 1 } });
  E.castTactic(skilledTide, 1, 'tide', 3);
  ok('전문화: 파도 방패와 성운 냉기는 Tide 지속시간을 늘린다', skilledTide.enemies[0].slowT > D.TACTICS.tide.slow[3].dur);

  const skilledBloom = tacticState(2, 1);
  skilledBloom.castleHp = skilledBloom.castleMax - 40;
  skilledBloom.enemies[0].s = 160;
  skilledBloom.field.push({ skills: { guard_mend: 1, knight_vow: 1 } });
  const bloomStart = skilledBloom.enemies[0].s;
  const sbr = E.castTactic(skilledBloom, 2, 'bloom', 3);
  ok('전문화: 별빛 수리는 Bloom 회복을 높인다', sbr.events.find(e => e.type === 'castleHeal').amount > D.TACTICS.bloom.baseHeal + 3 * D.TACTICS.bloom.healPerStar);
  ok('전문화: 수호 맹세는 Bloom 후퇴 거리를 늘린다', bloomStart - skilledBloom.enemies[0].s > D.TACTICS.bloom.pushDistance[3]);
}

/* ---------- ✦ 성좌 공명: 조합은 정상 완료, 정확한 합만 한 웨이브 길 보너스 ---------- */
{
  const st = fresh();
  st.resonance = { targets: [2, 5, 7], active: [false, false, false] };
  put(st, 'knight', 0, null);
  put(st, 'knight', 0, null);
  const rank = E.listCombos(st).find(c => c.kind === 'rankup' && c.cls === 'knight');
  ok('공명: 같은 직업 조합의 별 합을 계산한다', E.comboStarValue(rank) === 2);
  const rr = E.combineRankUp(st, 'knight', 0);
  ok('공명: 정확한 합은 왼쪽 길을 켠다', rr.ok && rr.resonance.activated && rr.resonance.lane === 0 && st.resonance.active[0]);
  ok('공명: 길 피해 배율은 설정값과 같다', E.resonanceDamageMul(st, 0) === D.RESONANCE_DAMAGE_MUL && E.resonanceDamageMul(st, 1) === 1);

  const saved = E.serialize(st);
  const back = E.deserialize(JSON.parse(JSON.stringify(saved)));
  ok('공명: 저장 후에도 켠 길과 결정적 목표가 유지된다',
    back.resonance.active[0] && back.resonance.targets.join(',') === st.resonance.targets.join(','));
  ok('공명: 특수·신화 값은 실제 레시피 재료의 합을 이어받는다', D.RECIPES.every(recipe =>
    D.HERO_STAR_VALUE[recipe.result] === D.HERO_STAR_VALUE[recipe.a] + D.HERO_STAR_VALUE[recipe.b]));
}
{
  const st = fresh();
  st.resonance = { targets: [2, 5, 7], active: [false, false, false] };
  put(st, 'knight', 0, null);
  put(st, 'mage', 0, null);
  const recipe = E.listCombos(st).find(c => c.kind === 'recipe' && c.result === 'spellblade');
  ok('공명: 특수 레시피의 별 합을 계산한다', E.comboStarValue(recipe) === 5);
  const rc = E.combineRecipe(st, 'spellblade');
  ok('공명: 레시피도 맞는 길을 켜며 용사는 정상 탄생한다', rc.ok && rc.hero.cls === 'spellblade' && rc.resonance.lane === 1 && st.resonance.active[1]);
}
{
  const st = fresh();
  st.resonance = { targets: [4, 5, 7], active: [false, false, false] };
  put(st, 'knight', 0, null);
  put(st, 'knight', 0, null);
  const normal = E.combineRankUp(st, 'knight', 0);
  ok('공명: 합이 달라도 일반 승급은 막히지 않는다', normal.ok && !normal.resonance.matched && !st.resonance.active.some(Boolean));
}
{
  const st = fresh();
  st.resonance = { targets: [2, 5, 7], active: [true, false, false] };
  E.startWave(st);
  st.spawnQueue = [{ t: 0, type: 'goblin', route: 0 }];
  E.tick(st, 0.001);
  const enemy = st.enemies[0];
  const h = put(st, 'guard', 0, 0);
  enemy.hp = 100; enemy.maxHp = 100;
  h.cd = 0;
  E.tick(st, 0.001);
  ok('공명: 켜진 길에서 용사 실제 타격 피해가 증가한다', enemy.hp === 100 - Math.round(h.dmg * D.RESONANCE_DAMAGE_MUL));
}
{
  const st = fresh();
  st.resonance = { targets: [2, 4, 7], active: [true, false, false] };
  put(st, 'knight', 0, null); put(st, 'knight', 0, null);
  put(st, 'guard', 0, null); put(st, 'guard', 0, null);
  ok('공명: 자동·밸런스 봇도 같은 등급이면 새 공명을 우선한다', E.bestCombo(st)?.cls === 'guard');
}

/* ---------- ⑧ 잔치: 랜덤 승급 · 준비마다 한 번 · 저장해도 리롤 불가 ---------- */
{
  const st = fresh();
  put(st, 'knight', 0, 0);
  put(st, 'archer', 1, null);
  const goldBefore = st.gold;
  const r = E.holdFeast(st);
  ok('잔치: 하나가 승급한다', r.ok && r.hero.tier === r.from + 1 && st.feasts === 1);
  ok('잔치: 골드가 나간다', st.gold === goldBefore - r.cost);
  ok('잔치: 배치는 유지된다', st.field.length === 1);
  const r2 = E.holdFeast(st);
  ok('잔치: 준비마다 한 번', !r2.ok && r2.reason === 'done');
  /* 저장 → 불러오기: 같은 웨이브에선 여전히 못 연다 */
  const back = E.deserialize(JSON.parse(JSON.stringify(E.serialize(st))));
  ok('잔치: 불러와도 리롤 불가', !E.holdFeast(back).ok);
  /* 웨이브를 치르면 다시 열린다 */
  E.startWave(st);
  st.spawnQueue = [];
  st.enemies = [];
  E.tick(st, 0.05);
  st.gold = 99999;
  ok('잔치: 다음 준비에 다시 열린다', E.holdFeast(st).ok);
  /* 전원 신화면 잔치를 열 수 없다 */
  const st2 = fresh();
  put(st2, 'knight', 4, null);
  const r3 = E.holdFeast(st2);
  ok('잔치: 전원 신화면 없다', !r3.ok && r3.reason === 'none');
}

/* ---------- ⑨ 서른 번째 아침 · 별의 시련 (회차) ---------- */
{
  /* 30웨이브를 클리어하면 victory 이벤트가 정확히 한 번 나온다 */
  const st = fresh();
  st.wave = 30;
  E.startWave(st);
  st.spawnQueue = [];
  st.enemies = [];
  const evs = E.tick(st, 0.05);
  const vics = evs.filter(e => e.type === 'victory');
  ok('승리: 30웨이브 클리어에 victory 이벤트', vics.length === 1 && vics[0].wave === 30);
  ok('승리: 별조각 보상이 실려 있다', vics.length === 1 && vics[0].shards >= 1);
  ok('승리 후에도 게임은 계속된다', st.phase === 'prep' && st.wave === 31);
  /* 29·31웨이브 클리어에는 없다 */
  const st2 = fresh();
  st2.wave = 29;
  E.startWave(st2); st2.spawnQueue = []; st2.enemies = [];
  const evs2 = E.tick(st2, 0.05);
  ok('승리: 다른 웨이브에는 없다', !evs2.some(e => e.type === 'victory'));
}
{
  /* 별의 시련: 별지기는 이어지고 나머지는 리셋, 적은 세진다 */
  const st = fresh();
  put(st, 'knight', 3, 0);
  st.wave = 31;
  st.champ.level = 12;
  st.champ.sp = 3;
  st.champ.skills = { blade1: 2 };
  st.seenStory = new Set(['w30']);
  const next = E.nextLoop(st);
  ok('시련: 회차가 오른다', next.loop === 1);
  ok('시련: 별지기 성장 유지', next.champ.level === 12 && next.champ.sp === 3 && next.champ.skills.blade1 === 2);
  ok('시련: 용사는 리셋', next.bench.length === 0 && next.field.length === 0);
  ok('시련: 웨이브·성 리셋', next.wave === 1 && next.castleHp === next.castleMax);
  ok('시련: 본 이야기는 다시 안 본다', next.seenStory.has('w30'));
  ok('시련: 은하수는 0부터', next.champ.ult === 0);
  /* 적 체력·골드가 회차 배율만큼 오른다 */
  ok('시련: 체력 배율 단조 증가', D.loopHpMul(1) > D.loopHpMul(0) && D.loopHpMul(2) > D.loopHpMul(1));
  E.startWave(next);
  next.waveT = 999;                       // 스폰 큐를 전부 쏟는다
  const evs = E.tick(next, 0.001);
  const spawned = next.enemies.find(e => e.type === 'goblin');
  const base = D.ENEMY_TYPES.goblin;
  if (spawned) {
    const minHp = Math.round(base.hp * D.hpScale(1) * next.diff.hpMul * D.loopHpMul(1)) - 1;
    ok('시련: 스폰 몬스터가 실제로 세다', spawned.hp >= minHp, );
  } else {
    ok('시련: 스폰 몬스터가 실제로 세다', false, '고블린이 스폰되지 않음');
  }
  /* 저장 → 불러오기가 회차를 기억한다 */
  const back = E.deserialize(JSON.parse(JSON.stringify(E.serialize(next))));
  ok('시련: 저장/불러오기가 회차 유지', back.loop === 1);
}

console.log(failed ? `\n❌ 불변식 ${failed}건 실패` : '\n✅ 엔진 불변식 모두 통과');
process.exit(failed ? 1 : 0);
