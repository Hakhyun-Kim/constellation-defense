/* Runtime art selection stays deterministic and rule-free. The five named
 * heroes use one Quaternius character family; each campaign region selects a
 * small monster family from the matching Ultimate Monsters rig. */
export const ART_PILOT_REGION = 'verdant-dawn';

export const ART_REGIONS = Object.freeze([
  'verdant-dawn',
  'ember-gate',
  'neon-ruins',
  'ashen-margin',
  'manuscript-core',
]);

const ART_REGION_SET = new Set(ART_REGIONS);
const BLOB_TYPES = new Set(['goblin', 'wolf']);

const GATE_LANDMARK = Object.freeze({
  wall: 'quaternius-gate-wall',
  straight: 'quaternius-gate-wall-straight',
  door: 'quaternius-gate-door',
  tower: 'quaternius-gate-tower',
});

const HERO_MODELS = Object.freeze({
  arin: Object.freeze({
    id: 'quaternius-warrior', height: 1.72, yawOffset: Math.PI,
    idle: ['Idle_Attacking', 'Idle_Weapon', 'Idle'],
    attack: ['Sword_Attack', 'Sword_Attack2', 'Punch'],
  }),
  luna: Object.freeze({
    id: 'quaternius-wizard', height: 1.70, yawOffset: Math.PI,
    idle: ['Idle_Attacking', 'Idle_Weapon', 'Idle'],
    attack: ['Spell1', 'Staff_Attack', 'Spell2'],
  }),
  doyun: Object.freeze({
    id: 'quaternius-monk', height: 1.76, yawOffset: Math.PI,
    idle: ['Idle_Attacking', 'Idle'],
    attack: ['Attack', 'Attack2'],
  }),
  sera: Object.freeze({
    id: 'quaternius-ranger', height: 1.68, yawOffset: Math.PI,
    idle: ['Idle_Attacking', 'Idle_Weapon', 'Idle'],
    attack: ['Bow_Shoot', 'Bow_Draw', 'Punch'],
  }),
  yuna: Object.freeze({
    id: 'quaternius-cleric', height: 1.69, yawOffset: Math.PI,
    idle: ['Idle_Weapon', 'Idle'],
    attack: ['Spell1', 'Staff_Attack', 'Punch'],
  }),
});

const monster = (id, heightMul, extra = {}) => Object.freeze({
  id,
  heightMul,
  yawOffset: Math.PI,
  idle: ['Walk', 'Idle'],
  attack: ['Punch', 'Weapon', 'Idle'],
  ...extra,
});

const REGIONAL_MONSTERS = Object.freeze({
  'ember-gate': Object.freeze({
    normal: monster('quaternius-orc', .76),
    mid: monster('quaternius-orc-skull', .86),
    boss: monster('quaternius-blue-demon', .98),
  }),
  'neon-ruins': Object.freeze({
    normal: monster('quaternius-alien', .74),
    mid: monster('quaternius-blue-demon', .87),
    boss: monster('quaternius-alien', 1.02),
  }),
  'ashen-margin': Object.freeze({
    normal: monster('quaternius-mushroom-king', .70),
    mid: monster('quaternius-mushroom-king', .86),
    boss: monster('quaternius-mushroom-king', 1.02),
  }),
  'manuscript-core': Object.freeze({
    normal: monster('quaternius-orc-skull', .73),
    mid: monster('quaternius-alien', .88),
    boss: monster('quaternius-blue-demon', 1.04),
  }),
});

export const supportsArtRegion = (regionId) => ART_REGION_SET.has(regionId);

export function landmarkPilotSlot(regionId) {
  return regionId === ART_PILOT_REGION ? GATE_LANDMARK : null;
}

export function heroPilotSlot(regionId, hero) {
  if (!supportsArtRegion(regionId)) return null;
  return HERO_MODELS[hero?.heroKey] || null;
}

export function enemyPilotSlot(regionId, enemy) {
  if (!supportsArtRegion(regionId) || !enemy) return null;
  if (regionId === ART_PILOT_REGION) {
    if (enemy.boss) return monster('quaternius-blue-demon', .98);
    if (enemy.midBoss) return monster('quaternius-yeti', .82);
    if (BLOB_TYPES.has(enemy.type)) return monster('quaternius-green-blob', .78);
    return monster('quaternius-demon', .88, {
      hover: .18, idle: ['Flying_Idle'], attack: ['Flying_Idle'],
    });
  }
  const family = REGIONAL_MONSTERS[regionId];
  return enemy.boss ? family.boss : enemy.midBoss ? family.mid : family.normal;
}
