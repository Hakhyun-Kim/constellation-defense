/* Thirteen chibi hero classes and the champion face +Z. makeHumanBase shares body construction; portrait rendering reuses the same models. */
import * as THREE from 'three';
import * as D from '../data.js';
import { lam, glow } from './common.js';

const SKIN = 0xffd9b3;
const CLASS_LOOK = {
  knight:       { tunic: 0xcf5548, sleeve: 0xa93b30, pants: 0x54423a },
  guard:        { tunic: 0x5a7fd6, sleeve: 0x3f5fae, pants: 0x3d4666 },
  archer:       { tunic: 0x4f9e57, sleeve: 0x3b7f44, pants: 0x5a4a32 },
  mage:         { tunic: 0x7a5fd0, sleeve: 0x6448b8, pants: 0x453a6b },
  spellblade:   { tunic: 0x9b3a5e, sleeve: 0x7a2c48, pants: 0x3f2735 },
  windblade:    { tunic: 0x3fa08a, sleeve: 0x2f8070, pants: 0x2c4a44 },
  paladin:      { tunic: 0xe8e0c8, sleeve: 0xcfc4a0, pants: 0x8a8064 },
  frostmage:    { tunic: 0x5db4e8, sleeve: 0x4394c8, pants: 0x2f5a78 },
  sentinel:     { tunic: 0x5a6478, sleeve: 0x454e60, pants: 0x32384a },
  spiritarcher: { tunic: 0x9a7fd8, sleeve: 0x7f64bd, pants: 0x54487a },
  /* Three mythic classes. */
  swordsaint:   { tunic: 0xffe08a, sleeve: 0xe0b955, pants: 0x8a6a2a },
  archmage:     { tunic: 0x3a2a6e, sleeve: 0x2a1e52, pants: 0x1e1640 },
  seraph:       { tunic: 0xfaf6ea, sleeve: 0xe8e0c8, pants: 0xc8bfa0 },
};

/* Equipment-part helpers. */
function makeSword(bladeMat) {
  const sword = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.46, 0.02), bladeMat);
  blade.position.y = 0.28;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.045), lam(0xd9a93d));
  guard.position.y = 0.05;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12), lam(0x5a3a22));
  grip.position.y = -0.03;
  sword.add(blade, guard, grip);
  return sword;
}
function makeShield(plateColor) {
  const shield = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.05, 6), lam(plateColor));
  plate.rotation.x = Math.PI / 2;
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), lam(0xd9a93d));
  boss.position.z = 0.04;
  shield.add(plate, boss);
  return shield;
}
function makeBow(woodMat, horizontal = false) {
  const bow = new THREE.Group();
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.02, 6, 14, Math.PI), woodMat);
  arc.rotation.z = Math.PI / 2;
  const string = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.5, 0.008), lam(0xe8e8e8));
  bow.add(arc, string);
  if (horizontal) bow.rotation.z = Math.PI / 2;   // Rotate horizontally like a crossbow.
  return bow;
}
function makeStaff(headMesh) {
  const staff = new THREE.Group();
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.68), lam(0x6b4c2a));
  rod.position.y = 0.2;
  headMesh.position.y = 0.58;
  staff.add(rod, headMesh);
  return staff;
}
function makeHood(color, headGroup) {
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.3, 10), lam(color));
  hood.position.y = 0.14;
  headGroup.add(hood);
}
function makeWizardHat(color, headGroup) {
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 14), lam(color));
  brim.position.y = 0.12;
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.23, 0.4, 12), lam(color));
  hat.position.y = 0.32;
  headGroup.add(brim, hat);
}
function makeKnightHelm(headGroup, plumeColor) {
  const helm = new THREE.Mesh(
    new THREE.SphereGeometry(0.225, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), lam(0xc8ccd8));
  helm.position.y = 0.03;
  headGroup.add(helm);
  if (plumeColor != null) {
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 6), lam(plumeColor));
    plume.position.y = 0.3;
    headGroup.add(plume);
  }
}
function makeFullHelm(headGroup) {
  const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.235, 0.2, 12), lam(0xb9c0cf));
  helm.position.y = 0.08;
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.225, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), lam(0xb9c0cf));
  top.position.y = 0.16;
  headGroup.add(helm, top);
}

/* Build legs, torso, belt, arms and head with eyes. Walking characters expose leg pivots through refs.legs. */
function makeHumanBase({ tunic, sleeve, pants, belt, legPivots = false }) {
  const g = new THREE.Group();
  const refs = {};

  if (legPivots) {
    refs.legs = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.09 * sx, 0.2, 0);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 0.13), lam(pants));
      leg.position.y = -0.1;
      pivot.add(leg);
      g.add(pivot);
      refs.legs.push(pivot);
    }
  } else {
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 0.13), lam(pants));
      leg.position.set(0.09 * sx, 0.1, 0);
      g.add(leg);
    }
  }

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.3), lam(tunic));
  body.position.y = 0.41;
  g.add(body);
  refs.body = body;
  const beltM = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.32), lam(belt));
  beltM.position.y = 0.24;
  g.add(beltM);

  const armL = new THREE.Group();
  armL.position.set(-0.27, 0.6, 0);
  const armLmesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), lam(sleeve));
  armLmesh.position.y = -0.12;
  armL.add(armLmesh);
  g.add(armL);
  refs.armL = armL;

  const armPivot = new THREE.Group();
  armPivot.position.set(0.27, 0.6, 0);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), lam(sleeve));
  armR.position.y = -0.12;
  armPivot.add(armR);
  g.add(armPivot);
  refs.armPivot = armPivot;

  const head = new THREE.Group();
  head.position.y = 0.93;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 12), lam(SKIN));
  head.add(skull);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 6, 6), lam(0x232323));
    eye.position.set(0.075 * sx, 0.02, 0.185);
    head.add(eye);
  }
  g.add(head);
  refs.head = head;

  return { g, refs, head, armL, armPivot };
}

export function makeHumanHero(cls, tier) {
  const look = CLASS_LOOK[cls];
  const { g, refs, head, armL, armPivot } = makeHumanBase({ ...look, belt: 0x3a2f24 });

  const holdRight = (mesh) => {
    mesh.position.set(0, -0.26, 0.06);
    mesh.rotation.x = Math.PI / 5;
    armPivot.add(mesh);
  };
  const holdLeft = (mesh, z = 0.14) => {
    mesh.position.set(-0.1, -0.16, z);
    armL.add(mesh);
  };
  /* The offhand sword uses the left-arm equivalent of holdRight for dual wielders. */
  const holdLeftSword = (mesh) => {
    mesh.position.set(0, -0.26, 0.06);
    mesh.rotation.x = Math.PI / 5;
    armL.add(mesh);
  };

  /* Class-specific equipment. */
  switch (cls) {
    case 'knight':
      makeKnightHelm(head, 0xd83a3a);
      holdRight(makeSword(lam(0xe8ecf4)));
      break;
    case 'guard':
      makeFullHelm(head);
      holdLeft(makeShield(0xd0d6e2));
      {
        const mace = new THREE.Group();
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3), lam(0x5a3a22));
        handle.position.y = 0.1;
        const headM = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), lam(0x8b93a8));
        headM.position.y = 0.28;
        mace.add(handle, headM);
        holdRight(mace);
      }
      break;
    case 'archer':
      makeHood(0x35703c, head);
      { const bow = makeBow(lam(0x7a4a22)); holdLeft(bow, 0.16); refs.bow = bow; }
      break;
    case 'mage':
      makeWizardHat(0x5b43a8, head);
      {
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 10), glow(0x9ff3ff));
        holdRight(makeStaff(orb));
        refs.staffOrb = orb;
      }
      break;
    case 'spellblade': {  /* Spellblade: flaming sword. */
      makeKnightHelm(head, 0xb14fd8);
      const flameBlade = makeSword(glow(0xff8a3d));
      holdRight(flameBlade);
      refs.flame = flameBlade;
      break;
    }
    case 'windblade': {   /* Gale swordsman: twin swords and headband. */
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.215, 0.05, 12, 1, true),
        new THREE.MeshLambertMaterial({ color: 0x2f8070, side: THREE.DoubleSide }));
      band.position.y = 0.06;
      head.add(band);
      holdRight(makeSword(lam(0xd8f4ec)));
      holdLeftSword(makeSword(lam(0xd8f4ec)));
      break;
    }
    case 'paladin': {     /* Paladin: gold shield and halo. */
      makeFullHelm(head);
      holdLeft(makeShield(0xf2d98a));
      holdRight(makeSword(lam(0xfff2c8)));
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 8, 20), glow(0xffe27a));
      halo.rotation.x = Math.PI / 2.3;
      halo.position.y = 0.34;
      head.add(halo);
      refs.halo = halo;
      break;
    }
    case 'frostmage': {   /* Cryomancer: crystal staff. */
      makeWizardHat(0x3a7fc0, head);
      const ice = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), glow(0xaef4ff));
      holdRight(makeStaff(ice));
      refs.staffOrb = ice;
      break;
    }
    case 'sentinel': {    /* Sentinel: horizontal crossbow. */
      makeHood(0x3a4152, head);
      const crossbow = makeBow(lam(0x4a3a28), true);
      crossbow.rotation.x = Math.PI / 2.2;
      holdRight(crossbow);
      break;
    }
    case 'spiritarcher': { /* Spirit archer: glowing bow. */
      makeHood(0x6a52a8, head);
      const bow = makeBow(glow(0xd8b4ff));
      holdLeft(bow, 0.16);
      refs.bow = bow;
      break;
    }
    /* Mythic equipment. */
    case 'swordsaint': {        /* Sword saint: glowing twin blades and gold helmet. */
      makeKnightHelm(head, 0xff4d9d);
      const s1 = makeSword(glow(0xfff3b0)); holdRight(s1);
      holdLeftSword(makeSword(glow(0xfff3b0)));
      refs.flame = s1;
      break;
    }
    case 'archmage': {          /* Archmage: star staff and wide-brimmed hat. */
      makeWizardHat(0x2a1e52, head);
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 1), glow(0xff9ecb));
      holdRight(makeStaff(star));
      refs.staffOrb = star;
      break;
    }
    case 'seraph': {            /* Guardian angel: halo, wings and glowing bow. */
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 8, 22), glow(0xfff3b0));
      halo.rotation.x = Math.PI / 2.3;
      halo.position.y = 0.32;
      head.add(halo);
      refs.halo = halo;
      for (const sx of [-1, 1]) {
        const wing = new THREE.Mesh(
          new THREE.PlaneGeometry(0.5, 0.62),
          new THREE.MeshBasicMaterial({ color: 0xfffdf2, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
        );
        wing.position.set(0.22 * sx, 0.55, -0.2);
        wing.rotation.y = 0.5 * sx;
        g.add(wing);
        if (!refs.wings) refs.wings = [];
        refs.wings.push(wing);
      }
      const bow = makeBow(glow(0xfff3b0));
      holdLeft(bow, 0.16);
      refs.bow = bow;
      break;
    }
  }

  if (tier >= 1) {
    const cape = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.52),
      new THREE.MeshLambertMaterial({ color: D.TIERS[tier].color, side: THREE.DoubleSide })
    );
    cape.position.set(0, 0.52, -0.19);
    cape.rotation.x = 0.16;
    g.add(cape);
    refs.cape = cape;
  }
  if (tier >= 3) {
    const crown = new THREE.Group();
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd93d, side: THREE.DoubleSide }));
    crown.add(band);
    for (let k = 0; k < 4; k++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 4), glow(0xffd93d));
      const a = (k / 4) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.12, 0.07, Math.sin(a) * 0.12);
      crown.add(spike);
    }
    crown.position.y = 0.24;
    head.add(crown);
  }

  g.scale.setScalar(1.18 + tier * 0.1);
  return { group: g, refs };
}

/* The walking champion includes leg pivots. Wardrobe data selects colors and model parts. */
export function makeChampion(look) {
  const L = D.champLookOf(look);
  const outfit = D.CHAMP_WARDROBE.outfit.options[L.outfit];
  const hairColor = D.CHAMP_WARDROBE.hair.options[L.hair].color;
  const starColor = D.CHAMP_WARDROBE.star.options[L.star].color;
  const { g, refs, head, armL, armPivot } = makeHumanBase({
    tunic: outfit.tunic, sleeve: outfit.sleeve, pants: outfit.pants,
    belt: 0xd9a93d, legPivots: true,
  });

  /* Star emblem on the chest. */
  const emblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.055), glow(starColor));
  emblem.position.set(0, 0.47, 0.17);
  g.add(emblem);
  refs.emblem = emblem;

  /* Hair and star hairpin use wardrobe colors. */
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.225, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), lam(hairColor));
  hair.position.y = 0.03;
  head.add(hair);
  const pin = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), glow(starColor));
  pin.position.set(0.14, 0.15, 0.1);
  head.add(pin);

  /* Weapon choices: starlight sword, twin swords or star staff. */
  const bladeMat = glow(0xfff0b8);
  const hold = (mesh, arm, rot = Math.PI / 5) => {
    mesh.position.set(0, -0.26, 0.06);
    mesh.rotation.x = rot;
    arm.add(mesh);
  };
  if (L.weapon === 'staff') {
    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), glow(starColor));
    hold(makeStaff(orb), armPivot, Math.PI / 6);
    refs.staffOrb = orb;
  } else {
    hold(makeSword(bladeMat), armPivot);
    if (L.weapon === 'dual') hold(makeSword(bladeMat), armL);
  }

  /* Cape. */
  const cape = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, 0.55),
    new THREE.MeshLambertMaterial({ color: outfit.cape, side: THREE.DoubleSide })
  );
  cape.position.set(0, 0.5, -0.19);
  cape.rotation.x = 0.16;
  g.add(cape);
  refs.cape = cape;

  /* Orbiting companion star identifies the champion. */
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.085), glow(starColor));
  star.position.set(0.4, 1.25, 0);
  g.add(star);
  refs.star = star;
  refs.starColor = starColor;

  g.scale.setScalar(1.26);
  return { group: g, refs };
}

/* Render one offscreen frame of the actual model into a PNG data URL for portraits, including tier capes and crowns. Return null on failure so callers can use emoji fallbacks. */
let _pr = null;
function snapshot(group, px) {
  if (!_pr) {
    _pr = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    _pr.setSize(px, px);
    _pr.outputColorSpace = THREE.SRGBColorSpace;
    _pr.toneMapping = THREE.ACESFilmicToneMapping;
    _pr.toneMappingExposure = 1.15;
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5a6a, 1.5));
  const key = new THREE.DirectionalLight(0xfff2d8, 2.1);
  key.position.set(2.2, 3.4, 3.0);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd4ff, 1.1);
  rim.position.set(-2.6, 1.6, -2.2);
  scene.add(rim);
  group.rotation.y = Math.PI * 0.12;      // Use a slight angle rather than a flat frontal portrait.
  scene.add(group);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
  cam.position.set(0, 1.28, 3.5);
  cam.lookAt(0, 0.95, 0);
  _pr.render(scene, cam);
  const url = _pr.domElement.toDataURL('image/png');
  scene.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  return url;
}

const _portraits = new Map();
export function heroPortrait(cls, tier, px = 320) {
  const key = `${cls}:${tier}`;
  if (_portraits.has(key)) return _portraits.get(key);
  let url = null;
  try {
    url = snapshot(makeHumanHero(cls, tier).group, px);
  } catch (e) {
    url = null;                              // Fallback for devices unable to allocate another WebGL context.
  }
  _portraits.set(key, url);
  return url;
}

/* Cache portraits by appearance; wardrobe changes render a new preview. */
const _champPortraits = new Map();
export function champPortrait(look, px = 320) {
  const key = JSON.stringify(D.champLookOf(look));
  if (_champPortraits.has(key)) return _champPortraits.get(key);
  let url = null;
  try {
    url = snapshot(makeChampion(look).group, px);
  } catch (e) {
    url = null;
  }
  _champPortraits.set(key, url);
  return url;
}
