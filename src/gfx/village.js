/* A small, self-contained exploration scene for town visits.  It never reads
 * combat state or decides rewards; app/ui owns walking, proximity and actions. */
import * as THREE from 'three';
import { VILLAGE_BUILDINGS, VILLAGE_START } from '../app/village-layout.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .82, ...extra });

function labelSprite(text, color = '#fff4c4') {
  const canvas = document.createElement('canvas');
  canvas.width = 384; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '700 34px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 9; ctx.strokeStyle = 'rgba(25,28,48,.72)';
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = color; ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(2.8, .7, 1);
  sprite.userData.texture = texture;
  return sprite;
}

function villager({ body, hair, skin = 0xf0cfab, cloak = null, accent = 0xffd37a }) {
  const group = new THREE.Group();
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.42, 18), new THREE.MeshBasicMaterial({ color: 0x18232b, transparent: true, opacity: .28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .012; shadow.scale.set(1.2, .7, 1);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(.58, .67, .38), mat(body));
  torso.position.y = .73;
  const belt = new THREE.Mesh(new THREE.BoxGeometry(.62, .12, .42), mat(accent));
  belt.position.set(0, .55, .015);
  const head = new THREE.Mesh(new THREE.BoxGeometry(.46, .45, .42), mat(skin));
  head.position.y = 1.3;
  const hairTop = new THREE.Mesh(new THREE.BoxGeometry(.5, .14, .46), mat(hair));
  hairTop.position.set(0, 1.56, -.015);
  const hairBack = new THREE.Mesh(new THREE.BoxGeometry(.5, .34, .12), mat(hair));
  hairBack.position.set(0, 1.35, -.24);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x292538 });
  const eyeA = new THREE.Mesh(new THREE.BoxGeometry(.055, .065, .025), eyeMat);
  const eyeB = eyeA.clone();
  eyeA.position.set(-.105, 1.32, .225); eyeB.position.set(.105, 1.32, .225);
  const legMat = mat(cloak || 0x3d4658);
  const legA = new THREE.Mesh(new THREE.BoxGeometry(.16, .4, .18), legMat);
  const legB = legA.clone(); legA.position.set(-.15, .25, 0); legB.position.set(.15, .25, 0);
  const armA = new THREE.Mesh(new THREE.BoxGeometry(.14, .48, .16), mat(body));
  const armB = armA.clone(); armA.position.set(-.37, .76, 0); armB.position.set(.37, .76, 0);
  const cape = new THREE.Mesh(new THREE.BoxGeometry(.5, .62, .08), mat(cloak || body));
  cape.position.set(0, .76, -.24);
  group.add(shadow, legA, legB, cape, torso, belt, armA, armB, head, hairBack, hairTop, eyeA, eyeB);
  group.userData.rig = { shadow, legA, legB, armA, armB, torso, head };
  return group;
}

function tree(scale = 1, leaf = 0x315e42) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.12 * scale, .18 * scale, 1.35 * scale, 7), mat(0x704936));
  trunk.position.y = .65 * scale;
  const low = new THREE.Mesh(new THREE.ConeGeometry(.72 * scale, 1.4 * scale, 8), mat(leaf));
  low.position.y = 1.25 * scale;
  const high = new THREE.Mesh(new THREE.ConeGeometry(.5 * scale, 1.32 * scale, 8), mat(leaf));
  high.position.y = 2.02 * scale;
  group.add(trunk, low, high);
  return group;
}

function house({ x, z, wall, roof, width = 3.1, depth = 2.35, height = 2.05, sign = '' }) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const base = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat(wall));
  base.position.y = height / 2;
  const roofMesh = new THREE.Mesh(new THREE.ConeGeometry(Math.max(width, depth) * .78, 1.15, 4), mat(roof));
  roofMesh.rotation.y = Math.PI / 4;
  roofMesh.scale.z = depth / width;
  roofMesh.position.y = height + .55;
  const door = new THREE.Mesh(new THREE.BoxGeometry(.48, .82, .08), mat(0x4a3028));
  door.position.set(0, .42, depth / 2 + .045);
  const windowMat = new THREE.MeshBasicMaterial({ color: 0xffdc83 });
  for (const dx of [-.72, .72]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(.32, .35, .07), windowMat);
    win.position.set(dx, 1.2, depth / 2 + .05); group.add(win);
  }
  group.add(base, roofMesh, door);
  if (sign) {
    const sprite = labelSprite(sign); sprite.position.set(0, height + 1.65, 0); group.add(sprite);
  }
  return group;
}

function forgeSet() {
  const group = new THREE.Group();
  const forge = new THREE.Mesh(new THREE.BoxGeometry(1.05, .95, .8), mat(0x4a3b43));
  forge.position.set(-.75, .48, 1.5);
  const fire = new THREE.Mesh(new THREE.OctahedronGeometry(.25), new THREE.MeshBasicMaterial({ color: 0xffa04c, transparent: true, opacity: .95 }));
  fire.position.set(-.75, .72, 1.92);
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(.34, 1.45, .34), mat(0x4b454c));
  chimney.position.set(-.75, 1.5, 1.4);
  const anvil = new THREE.Mesh(new THREE.CylinderGeometry(.2, .34, .55, 6), mat(0x2d3541));
  anvil.rotation.z = Math.PI / 2; anvil.position.set(.8, .58, 1.15);
  group.add(forge, fire, chimney, anvil);
  group.userData.fire = fire;
  return group;
}

function shrineSet() {
  const group = new THREE.Group();
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.42, .22, 18), mat(0x7f86ac));
  platform.position.y = .11;
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.42), new THREE.MeshBasicMaterial({ color: 0x9ee6ff, transparent: true, opacity: .9 }));
  crystal.position.y = .9;
  group.add(platform, crystal);
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2 + .35;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(.11, .15, 1.35, 7), mat(0xd9def1));
    pillar.position.set(Math.cos(angle) * .92, .68, Math.sin(angle) * .92);
    group.add(pillar);
  }
  group.userData.crystal = crystal;
  return group;
}

function guildSet() {
  const group = new THREE.Group();
  const target = new THREE.Mesh(new THREE.CylinderGeometry(.54, .54, .1, 18), mat(0xf1dfbd));
  target.rotation.x = Math.PI / 2; target.position.set(-1.65, .9, 1.2);
  const bull = new THREE.Mesh(new THREE.CircleGeometry(.13, 14), new THREE.MeshBasicMaterial({ color: 0xd85652 }));
  bull.position.set(-1.65, .9, 1.26);
  const post = new THREE.Mesh(new THREE.BoxGeometry(.11, 1.65, .11), mat(0x704835));
  post.position.set(-1.65, .45, 1.08);
  const crate = new THREE.Mesh(new THREE.BoxGeometry(.65, .55, .65), mat(0x9a6d43));
  crate.position.set(.95, .28, 1.2);
  group.add(target, bull, post, crate);
  return group;
}

function wellSet() {
  const group = new THREE.Group();
  const stone = mat(0x737b83);
  for (let i = 0; i < 12; i++) {
    const angle = i / 12 * Math.PI * 2;
    const block = new THREE.Mesh(new THREE.BoxGeometry(.42, .34, .32), stone);
    block.position.set(Math.cos(angle) * .78, .2, Math.sin(angle) * .78);
    block.rotation.y = -angle;
    group.add(block);
  }
  const water = new THREE.Mesh(new THREE.CircleGeometry(.62, 24), new THREE.MeshBasicMaterial({ color: 0x5cb4cd, transparent: true, opacity: .72 }));
  water.rotation.x = -Math.PI / 2; water.position.y = .25; group.add(water);
  for (const x of [-.83, .83]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(.12, 1.35, .12), mat(0x76523b));
    post.position.set(x, .76, 0); group.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.86, .14, .14), mat(0x76523b));
  beam.position.y = 1.42; group.add(beam);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.22, .62, 4), mat(0x5c4050));
  roof.rotation.y = Math.PI / 4; roof.position.y = 1.78; roof.scale.z = .62; group.add(roof);
  group.userData.water = water;
  return group;
}

export class VillageRenderer {
  constructor(opts = {}) {
    this.active = false;
    this.reducedEffects = opts.reducedEffects !== false;
    this.host = null;
    this.time = 0;
    this.targetViews = new Map();
    this.playerTarget = new THREE.Vector3(VILLAGE_START.x, 0, VILLAGE_START.z);
    this.playerMotion = { x: 0, z: -1, moving: false };
    this.cameraGoal = new THREE.Vector3();
    this.cameraLookGoal = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._pointer = new THREE.Vector2();
    this.renderer = new THREE.WebGLRenderer({ antialias: opts.quality !== 'min', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.quality === 'high' ? 1.75 : 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = opts.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'village-canvas';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x7898a6);
    this.scene.fog = new THREE.Fog(0x7898a6, 13, 31);
    this.camera = new THREE.PerspectiveCamera(51, 1, .1, 70);
    this.camera.position.set(0, 10.6, 14.2);
    this.cameraLook = new THREE.Vector3(0, 0, .2);
    this.camera.lookAt(this.cameraLook);
    this.scene.add(new THREE.HemisphereLight(0xc5e4f0, 0x304633, 1.55));
    this.sun = new THREE.DirectionalLight(0xffe4ba, 2.25);
    this.sun.position.set(-7, 13, 8); this.sun.castShadow = opts.quality === 'high';
    if (this.sun.castShadow) { this.sun.shadow.mapSize.set(1024, 1024); this.sun.shadow.camera.left = -14; this.sun.shadow.camera.right = 14; this.sun.shadow.camera.top = 14; this.sun.shadow.camera.bottom = -14; }
    this.scene.add(this.sun);
    this._build();
    this._resize = this._resize.bind(this);
    this.ro = new ResizeObserver(this._resize);
  }

  _build() {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(14.5, 48), mat(0x6a8c58));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(7.2, 40), mat(0xc49a68));
    plaza.rotation.x = -Math.PI / 2; plaza.position.y = .01; plaza.receiveShadow = true; this.scene.add(plaza);
    for (const radius of [3.4, 5.5]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius - .045, radius + .045, 40), new THREE.MeshBasicMaterial({ color: 0xe8c98e }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = .025; this.scene.add(ring);
    }
    /* Short plaza stone paths clarify destinations and add compact diorama detail without external textures. */
    const paving = mat(0xd7b47d);
    for (const [axis, offset] of [['x', -3.2], ['x', 3.2], ['z', 0]]) {
      for (let i = -5; i <= 5; i++) {
        const stone = new THREE.Mesh(new THREE.BoxGeometry(.68, .055, .48), paving);
        stone.position.set(axis === 'x' ? offset : i * .72, .035, axis === 'x' ? i * .72 : offset);
        stone.rotation.y = (i % 2) * .08;
        stone.receiveShadow = true;
        this.scene.add(stone);
      }
    }
    const forge = house({ ...VILLAGE_BUILDINGS.forge, wall: 0x6d4d47, roof: 0x343847, sign: '별무기 대장간' });
    const shrine = house({ ...VILLAGE_BUILDINGS.shrine, wall: 0x6b719c, roof: 0x373660, width: 3.35, sign: '별빛 신전' });
    const guild = house({ ...VILLAGE_BUILDINGS.guild, wall: 0x7b5d4d, roof: 0x70404d, sign: '탐험가 길드' });
    this.scene.add(forge, shrine, guild);
    const forgeDecor = forgeSet(); forgeDecor.position.set(VILLAGE_BUILDINGS.forge.x, 0, VILLAGE_BUILDINGS.forge.z); this.scene.add(forgeDecor); this.forgeFire = forgeDecor.userData.fire;
    const shrineDecor = shrineSet(); shrineDecor.position.set(0, 0, 4.4); this.scene.add(shrineDecor); this.shrineCrystal = shrineDecor.userData.crystal;
    const guildDecor = guildSet(); guildDecor.position.set(VILLAGE_BUILDINGS.guild.x, 0, VILLAGE_BUILDINGS.guild.z); this.scene.add(guildDecor);
    const well = wellSet(); well.position.set(VILLAGE_BUILDINGS.well.x, 0, VILLAGE_BUILDINGS.well.z); this.scene.add(well); this.wellWater = well.userData.water;
    for (const [x, z, scale, leaf] of [[-11, 8, 1.2, 0x315d42], [10.6, 8.8, 1.05, 0x315d42], [-11.4, -6.8, .9, 0x426a43], [11.5, -5.4, 1.25, 0x315d42], [-2.8, -11.2, .8, 0x4b7045]]) {
      const item = tree(scale, leaf); item.position.set(x, 0, z); this.scene.add(item);
    }
    for (const x of [-10, -7.5, -5, -2.5, 0, 2.5, 5, 7.5, 10]) {
      const fence = new THREE.Mesh(new THREE.BoxGeometry(1.8, .45, .12), mat(0x795a3e));
      fence.position.set(x, .28, -10.8); this.scene.add(fence);
    }
    this.destinationMarker = new THREE.Mesh(new THREE.RingGeometry(.3, .43, 24), new THREE.MeshBasicMaterial({ color: 0xffe19a, transparent: true, opacity: .82, side: THREE.DoubleSide, depthWrite: false }));
    this.destinationMarker.rotation.x = -Math.PI / 2; this.destinationMarker.position.y = .045; this.destinationMarker.visible = false; this.scene.add(this.destinationMarker);
    this.player = villager({ body: 0x5b62aa, hair: 0x3c2d3a, cloak: 0x383a77, accent: 0xffcf67 });
    this.playerLabel = labelSprite('아린 · 수호단장', '#fff2ba');
    this.playerLabel.position.y = 2.1; this.player.add(this.playerLabel);
    this.player.position.copy(this.playerTarget); this.scene.add(this.player);
  }

  attach(host) {
    if (!host || this.host === host) return;
    this.ro.disconnect();
    this.host = host;
    host.appendChild(this.renderer.domElement);
    this.ro.observe(host);
    this._resize();
  }

  deactivate() {
    this.active = false;
    this.ro.disconnect();
    if (this.renderer.domElement.parentElement) this.renderer.domElement.remove();
    this.host = null;
  }

  setReducedEffects(reduced) {
    this.reducedEffects = !!reduced;
  }

  setPresentation({ active, host, player, motion, destination, targets, nearby }) {
    this.active = !!active;
    if (!this.active) { this.deactivate(); return; }
    this.attach(host);
    this.playerTarget.set(player.x, 0, player.z);
    if (motion) this.playerMotion = { x: motion.x, z: motion.z, moving: !!motion.moving };
    this.destinationMarker.visible = !!destination;
    if (destination) this.destinationMarker.position.set(destination.x, .045, destination.z);
    const keep = new Set();
    for (const target of targets) {
      keep.add(target.id);
      let view = this.targetViews.get(target.id);
      if (!view) {
        const colors = target.type === 'recruit' ? { body: 0x9d6c9f, hair: 0x3b2730, label: '#ffe0ef' } : { body: 0x7f9a7c, hair: 0x5e4636, label: '#fff0b4' };
        const group = villager(colors);
        const ring = new THREE.Mesh(new THREE.RingGeometry(.46, .58, 20), new THREE.MeshBasicMaterial({ color: 0x8ca6ff, transparent: true, opacity: .88, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = .028;
        const label = labelSprite(`${target.emoji} ${target.label}`, colors.label);
        label.position.y = 2.15;
        group.add(ring, label);
        view = { group, ring, label, near: false }; this.targetViews.set(target.id, view); this.scene.add(group);
      }
      view.group.position.set(target.x, 0, target.z);
      view.group.visible = true;
      view.near = target.id === nearby?.id;
      view.ring.material.color.setHex(view.near ? 0xffdf79 : target.type === 'recruit' ? 0xdba6ec : 0x85b7ff);
    }
    for (const [id, view] of this.targetViews) if (!keep.has(id)) view.group.visible = false;
  }

  pickWorld(clientX, clientY) {
    if (!this.active) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this._pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this._raycaster.ray.intersectPlane(this._plane, hit)) return null;
    return { x: clamp(hit.x, -10.5, 10.5), z: clamp(hit.z, -9.6, 9.2) };
  }

  frame(dt) {
    if (!this.active || !this.host) return;
    const frameDt = Math.min(dt, .05);
    this.time += frameDt;
    this.player.position.lerp(this.playerTarget, 1 - Math.pow(.0001, frameDt));
    const rig = this.player.userData.rig;
    const stride = this.playerMotion.moving ? Math.sin(this.time * 10) : 0;
    const bounce = this.playerMotion.moving && !this.reducedEffects ? Math.abs(stride) * .08 : 0;
    this.player.position.y = bounce;
    this.player.rotation.y = Math.atan2(this.playerMotion.x, this.playerMotion.z);
    if (rig) {
      const motionScale = this.reducedEffects ? .42 : 1;
      rig.legA.rotation.x = stride * .62 * motionScale;
      rig.legB.rotation.x = -stride * .62 * motionScale;
      rig.armA.rotation.x = -stride * .48 * motionScale;
      rig.armB.rotation.x = stride * .48 * motionScale;
      rig.torso.rotation.z = stride * .025 * motionScale;
    }
    const follow = 1 - Math.pow(.001, frameDt);
    this.cameraGoal.set(this.player.position.x * .7, 12.4, this.player.position.z + 10.3);
    this.cameraLookGoal.set(this.player.position.x * .48, .58, this.player.position.z - 1.25);
    this.camera.position.lerp(this.cameraGoal, follow);
    this.cameraLook.lerp(this.cameraLookGoal, follow);
    this.camera.lookAt(this.cameraLook);
    if (this.forgeFire) { const s = this.reducedEffects ? 1 : 1 + Math.sin(this.time * 8) * .22; this.forgeFire.scale.setScalar(s); }
    if (this.shrineCrystal) { this.shrineCrystal.rotation.y += dt * (this.reducedEffects ? .25 : .9); this.shrineCrystal.position.y = .9 + (this.reducedEffects ? 0 : Math.sin(this.time * 2) * .08); }
    if (this.wellWater) this.wellWater.material.opacity = this.reducedEffects ? .68 : .68 + Math.sin(this.time * 2.3) * .07;
    if (this.destinationMarker.visible) {
      this.destinationMarker.rotation.z -= frameDt * (this.reducedEffects ? .35 : 1.7);
      this.destinationMarker.scale.setScalar(this.reducedEffects ? 1 : 1 + Math.sin(this.time * 5) * .1);
    }
    for (const view of this.targetViews.values()) {
      if (!view.group.visible) continue;
      view.group.position.y = this.reducedEffects ? 0 : Math.sin(this.time * 2.5 + view.group.position.x) * .025;
      view.ring.rotation.z += dt * (this.reducedEffects ? .2 : 1.2);
      const scale = view.near ? 1.1 + (this.reducedEffects ? 0 : Math.sin(this.time * 4) * .025) : 1;
      const easedScale = view.group.scale.x + (scale - view.group.scale.x) * Math.min(1, frameDt * 8);
      view.group.scale.setScalar(easedScale);
      view.label.material.rotation = 0;
    }
    this.renderer.render(this.scene, this.camera);
  }

  _resize() {
    if (!this.host) return;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
