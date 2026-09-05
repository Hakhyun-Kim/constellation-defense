/* Three.js renderer with the distant castle above three incoming lanes. world.js supplies terrain/castle construction and fx.js supplies effects; optional external assets supplement procedural models through a separate loader. */
import * as THREE from 'three';
import { CastleCosmetics } from './cosmetics.js';
import * as D from '../data.js';
import { CHAMP_CHAT } from '../story.js';
import { S, wx, wz, emojiTexture, blobTexture } from './common.js';
import { makeHumanHero, makeChampion } from './units3d.js';
import { worldMethods } from './world.js';
import { fxMethods } from './fx.js';
import { WindGrass, Sea, Fireflies, makePalette, daylightPalette, clockPhase, moonPhaseNow } from './nature.js';
import { SkyBand } from './sky.js';
import { RegionScenery, regionTheme } from './regions.js';
import { ART_PILOT_REGION, enemyPilotSlot, heroPilotSlot, landmarkPilotSlot, supportsArtRegion } from './art-pilot.js';
import { instantiateGltfAsset } from './gltf-assets.js';

export class Renderer3D {
  constructor(container, opts = {}) {
    this.container = container;
    this.quality = opts.quality || 'high';
    this.reducedEffects = opts.reducedEffects !== false;
    /* External art is an optional view dependency; null or failed loads preserve procedural fallback construction. */
    this.assets = opts.assets || null;
    /* Disable expensive grass, sea, sky and fireflies on mobile, returning the sky's screen area to the battlefield. Keep time-of-day lighting and fog. */
    this.decor = opts.decor !== false;
    /* Pad hit radius as a PAD_RADIUS multiplier, enlarged for touch. */
    this.padSlop = opts.touch ? 2.4 : 1.5;
    this.time = 0;
    this.cameraCutscene = null;

    const r = new THREE.WebGLRenderer({
      antialias: this.quality !== 'min',
      powerPreference: 'high-performance',
      preserveDrawingBuffer: !!opts.preserve,
    });
    r.setPixelRatio(this._targetDpr());
    r.setClearColor(0xbfe3ff);
    /* Tone mapping and real-time shadows improve depth and material readability. */
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.08;
    r.outputColorSpace = THREE.SRGBColorSpace;
    if (this.quality === 'high') {
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    container.appendChild(r.domElement);
    this.renderer = r;

    this.scene = new THREE.Scene();
    /* Extend fog range for the sea horizon while preserving battlefield framing. Without sea scenery, retain the shorter ground-only range. */
    if (this.decor) { this.fogNear = 30; this.fogFar = 78; }
    else { this.fogNear = 24; this.fogFar = 44; }
    this.scene.fog = new THREE.Fog(0xcfe9ff, this.fogNear, this.fogFar);
    this.scene.background = new THREE.Color(0xcfe9ff);
    /* Real time controls light, fog and water color; combat events never override this global palette. */
    this.palette = makePalette();
    /* Use ?hour=18.5 to inspect a fixed time of day. */
    const hp = new URLSearchParams(location.search).get('hour');
    this.forcedHour = hp != null && hp !== '' && Number.isFinite(Number(hp)) ? Number(hp) : null;
    /* Initialize the correct palette before the first frame to avoid a night-to-day flash. */
    this.dayPhase = clockPhase(this.forcedHour);
    this.dayTarget = this.dayPhase;
    daylightPalette(this.dayPhase, this.palette);
    this.baseFog = this.palette.fog.clone();
    this.baseClear = this.palette.sky.clone();
    this.baseSunI = this.palette.sunI;
    this.baseHemiI = this.palette.hemiI;
    this.region = regionTheme('verdant-dawn');
    this._regionGroundColor = new THREE.Color(this.region.ground);
    this._regionRoadColor = new THREE.Color(this.region.road);
    this._regionRoadEdgeColor = new THREE.Color(this.region.roadEdge);
    this._regionWallColor = new THREE.Color(this.region.wall);

    /* Reserve the upper band for sky by widening FOV and raising the look target. Without scenery, reclaim that area and enlarge pads for touch interaction. */
    this.skyFraction = this.decor ? 0.19 : 0;
    this.camera = new THREE.PerspectiveCamera(this.decor ? 54 : 46, 16 / 10, 0.1, 120);
    this.camBase = this.decor ? new THREE.Vector3(0, 13.2, 13.6)
                              : new THREE.Vector3(0, 13.2, 12.8);
    this.camLook = this.decor ? new THREE.Vector3(0, 2.4, -0.6)
                              : new THREE.Vector3(0, 0, -0.6);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.camLook);

    this.hemi = new THREE.HemisphereLight(0xeaf6ff, 0x5d8742, 1.25);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
    sun.position.set(8, 14, 6);
    if (this.quality === 'high') {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const c = sun.shadow.camera;
      c.left = -14; c.right = 14; c.top = 11; c.bottom = -11;
      c.near = 1; c.far = 40;
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.02;
    }
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    this._buildTerrain();
    this._buildCastle();
    this.cosmetics = new CastleCosmetics(this.castle);
    this._buildParticles();
    this._buildDamageNumbers();
    this.regions = new RegionScenery(this.scene);
    this.setRegionTheme('verdant-dawn');

    /* Construct scenery only when enabled, avoiding hidden geometry and shader compilation costs on lightweight devices. */
    this.moonPhase = 0.15;
    if (this.decor) {
      this.grass = new WindGrass(this.scene, this.quality, wx, wz);
      this.sea = new Sea(this.scene, this.quality);
      this.fireflies = new Fireflies(this.scene, this.quality);
      /* The sky band is a camera child, so the camera must belong to the scene. */
      this.scene.add(this.camera);
      this.sky = new SkyBand(this.camera, this.skyFraction);
    }

    this.heroViews = new Map();
    this.enemyViews = new Map();
    this.projViews = new Map();
    this.blueprintViews = new Map();
    this.constellationAidViews = new Map();
    this.gatePilot = null;
    this.gatePilotRequest = null;
    this.castleFortify = 0;
    this.disposed = false;
    this._attachGatePilot();
    this.placementMode = false;
    this.placeRange = 0;
    this.selectedHeroId = null;
    this.hoverPad = null;

    this._resize = this._resize.bind(this);
    this.ro = new ResizeObserver(this._resize);
    this.ro.observe(container);
    this._resize();

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  }

  _targetDpr() {
    const d = window.devicePixelRatio || 1;
    if (this.quality === 'high') return Math.min(d, 2);
    if (this.quality === 'lite') return Math.min(d, 1.4);
    return 0.6;
  }

  setQuality(q) {
    if (this.quality === q) return;
    this.quality = q;
    this.renderer.setPixelRatio(this._targetDpr());
    if (this.grass) this.grass.setQuality(q);
    if (this.sea) this.sea.setQuality(q);
    if (this.fireflies) this.fireflies.setQuality(q);
    this._resize();
  }

  setReducedEffects(reduced) {
    this.reducedEffects = !!reduced;
    this._resize();
  }

  performanceSnapshot() {
    const info = this.renderer.info;
    return Object.freeze({
      calls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      lines: info.render.lines,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
    });
  }

  _resize() {
    const w = this.container.clientWidth || 700;
    const h = this.container.clientHeight || 430;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.sky) this.sky.layout();     // Resize the sky band when the frustum changes.
  }

  /* View creation. */
  _attachGatePilot() {
    const slot = landmarkPilotSlot(this.region?.id);
    if (!slot || !this.assets?.enabled || this.gatePilotRequest) return;
    const request = {};
    this.gatePilotRequest = request;
    const ids = [slot.wall, slot.straight, slot.door, slot.tower];
    void Promise.all(ids.map((id) => this.assets.load(id))).then((loaded) => {
      if (this.disposed || this.gatePilotRequest !== request || loaded.some((asset) => !asset)) return;
      const [wallAsset, straightAsset, doorAsset, towerAsset] = loaded;
      const group = new THREE.Group();
      group.name = 'art-v2-verdant-gate';
      const parts = [];
      const add = (asset, { height, x, y = 0, z, stretchX = 1, rotationY = 0 }) => {
        const instance = instantiateGltfAsset(asset, { targetHeight: height, centerXZ: true });
        const anchor = new THREE.Group();
        anchor.position.set(x, y, z);
        anchor.rotation.y = rotationY;
        anchor.scale.x = stretchX;
        anchor.add(instance.root);
        group.add(anchor);
        parts.push(instance);
        return instance;
      };

      /* Preserve the central gate's proportions and stretch only side modules for a readable distant silhouette with bounded instances and draw calls. */
      add(wallAsset, { height: 2.22, x: 0, z: -3.98 });
      for (const x of [-4.45, -2.05, 2.05, 4.45]) {
        add(straightAsset, { height: 2.22, x, z: -4.0, stretchX: 1.72 });
      }
      const door = add(doorAsset, { height: 1.62, x: 0, z: -3.69 });
      add(towerAsset, { height: 4.8, x: -5.3, z: -5.18 });
      add(towerAsset, { height: 4.8, x: 5.3, z: -5.18 });

      this.castle.add(group);
      this.gatePilot = { group, parts, door };
      this._syncGatePilotVisibility();
    }).catch((error) => {
      console.warn('[art-v2] 성문 랜드마크 조립 실패 · 절차형 성 유지', error);
    });
  }

  _syncGatePilotVisibility(fortify = this.castleFortify) {
    fortify = Number.isFinite(fortify) ? fortify : 0;
    const show = !!this.gatePilot && this.region?.id === ART_PILOT_REGION;
    if (this.gatePilot) {
      this.gatePilot.group.visible = show;
      this.gatePilot.door.root.visible = show && fortify < 4;
    }
    if (this.wall) this.wall.visible = !show;
    for (const tower of this.castleWatchTowers || []) tower.visible = !show;
    for (const roof of this.castleWatchRoofs || []) roof.visible = !show;
    if (this.gate) this.gate.visible = !show && fortify < 4;
    if (this.steelGate) this.steelGate.visible = fortify >= 4;
  }

  _syncPilotVisibility(view) {
    if (!view?.externalPilot) return;
    const showExternal = supportsArtRegion(this.region?.id);
    view.externalPilot.root.visible = showExternal;
    if (view.pilotFallback) view.pilotFallback.visible = !showExternal;
  }

  _attachPilotModel(view, slot, parent, fallback, targetHeight) {
    if (!slot || !this.assets?.enabled) return;
    view.pilotFallback = fallback;
    view.pilotSlot = slot;
    view.pilotAssetId = slot.id;
    void this.assets.load(slot.id).then((asset) => {
      if (!asset || view.disposed || view.pilotAssetId !== slot.id) return;
      const external = instantiateGltfAsset(asset, {
        targetHeight,
        idle: slot.idle,
        hover: slot.hover || 0,
        yawOffset: slot.yawOffset || 0,
      });
      parent.add(external.root);
      view.externalPilot = external;
      view.externalAttacking = false;
      this._syncPilotVisibility(view);
    });
  }

  _disposePilotView(view) {
    if (!view) return;
    view.disposed = true;
    view.externalPilot?.dispose();
    view.externalPilot = null;
  }

  _makeHeroView(hero) {
    const { group, refs } = makeHumanHero(hero.cls, hero.tier);
    group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    const holder = new THREE.Group();
    holder.add(group);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 0.95),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.12;
    holder.add(shadow);

    const isSpecial = !!D.CLASSES[hero.cls].special;
    const squadColor = { knight: 0xe56b5d, guard: 0x5a96e8, archer: 0x63b56f, mage: 0xa779e8 }[hero.cls]
      || D.TIERS[hero.tier].color;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.52, 0.64, 24),
      new THREE.MeshBasicMaterial({ color: squadColor, transparent: true, opacity: 0.95, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.145;
    holder.add(ring);
    /* Special classes receive a subtle purple secondary ring. */
    if (isSpecial) {
      const sring = new THREE.Mesh(
        new THREE.RingGeometry(0.66, 0.72, 24),
        new THREE.MeshBasicMaterial({ color: 0xd8b4ff, transparent: true, opacity: 0.55, depthWrite: false })
      );
      sring.rotation.x = -Math.PI / 2;
      sring.position.y = 0.14;
      holder.add(sring);
    }

    let legendGlow = null;
    if (hero.tier >= 3) {
      legendGlow = new THREE.Mesh(
        new THREE.RingGeometry(0.76, 0.94, 26),
        new THREE.MeshBasicMaterial({ color: hero.tier >= 4 ? 0xff4d9d : 0xffc93d, transparent: true, opacity: 0.5, depthWrite: false })
      );
      legendGlow.rotation.x = -Math.PI / 2;
      legendGlow.position.y = 0.14;
      holder.add(legendGlow);
    }

    this.scene.add(holder);
    const view = {
      holder, model: group, refs, legendGlow,
      attackT: 0, faceY: Math.PI, targetFaceY: Math.PI,
      cls: hero.cls, heroKey: hero.heroKey,
    };
    const slot = heroPilotSlot(this.region?.id, hero);
    this._attachPilotModel(view, slot, holder, group, slot?.height || 1.58);
    return view;
  }

  /* Champion view. */
  /* Rebuild the view after wardrobe changes while preserving position and facing. */
  setChampLook(look) {
    this.champLook = D.champLookOf(look);
    if (this.champView) {
      const old = this.champView;
      this.scene.remove(old.holder);
      this._champCarry = { pos: { ...old.pos }, dest: { ...old.dest }, faceY: old.faceY };
      this.champView = null;               // The next sync reconstructs the updated appearance.
    }
  }

  _makeChampView() {
    const { group, refs } = makeChampion(this.champLook);
    group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    const holder = new THREE.Group();
    holder.add(group);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 0.95),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.05;
    holder.add(shadow);

    /* A pentagonal star ring beneath the champion follows the selected starlight color. */
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.62, 5),
      new THREE.MeshBasicMaterial({ color: refs.starColor || 0xffe27a, transparent: true, opacity: 0.8, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.07;
    holder.add(ring);

    const barW = 1.2;
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, 0.13),
      new THREE.MeshBasicMaterial({ color: 0x1c2333, transparent: true, opacity: 0.75, depthTest: false })
    );
    const fg = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x7fe08a, depthTest: false })
    );
    fg.position.z = 0.001;
    bg.renderOrder = 40; fg.renderOrder = 41;
    bar.add(bg, fg);
    bar.position.y = 2.1;
    bar.visible = false;
    holder.add(bar);

    /* Preserve the previous position when changing clothes. */
    const carry = this._champCarry;
    this._champCarry = null;
    const pos = carry ? carry.pos : { x: D.CHAMP_HOME.x, y: D.CHAMP_HOME.y };
    holder.position.set(wx(pos.x), 0, wz(pos.y));
    this.scene.add(holder);
    return {
      holder, model: group, refs, ring, bar, barFg: fg, barW,
      pos: { ...pos },
      dest: carry ? { ...carry.dest } : { ...pos },
      faceY: carry ? carry.faceY : Math.PI, targetFaceY: carry ? carry.faceY : Math.PI,
      walkPhase: 0, attackT: 0, koT: 0, ko: false, phase: 'prep',
      wanderT: 1.2, chatWith: null, chatCd: 3, chatSeq: null,
    };
  }

  /* Preparation wandering is presentation-only. The engine does not move the champion during preparation; the renderer chooses idle destinations and chatter. */
  _champWander(dt, state, v) {
    if (v.chatSeq) {
      const s = v.chatSeq;
      s.t += dt;
      if (!s.saidQ) { s.saidQ = true; this.showBubble(v.pos.x, v.pos.y, s.q, 2.6); }
      if (!s.saidA && s.t >= 1.5) {
        s.saidA = true;
        const h = state.field.find(x => x.id === s.hero);
        if (h) this.showBubble(h.x, h.y, s.a, 2.6);
      }
      if (s.t >= 3.6) v.chatSeq = null;
      return;
    }
    v.chatCd -= dt;
    const arrived = Math.hypot(v.pos.x - v.dest.x, v.pos.y - v.dest.y) <= 4;
    if (!arrived) return;
    v.wanderT -= dt;
    if (v.wanderT > 0) {
      /* At a destination, talk to nearby heroes or use idle dialogue. */
      if (v.chatCd <= 0) {
        const h = v.chatWith != null ? state.field.find(x => x.id === v.chatWith) : null;
        if (h && Math.hypot(h.x - v.pos.x, h.y - v.pos.y) < 70) {
          const cls = CHAMP_CHAT.byCls[h.cls];
          const pool = cls && Math.random() < 0.4 ? cls : CHAMP_CHAT.any;
          const [q, a] = pool[Math.floor(Math.random() * pool.length)];
          v.chatSeq = { t: 0, q, a, hero: h.id, saidQ: false, saidA: false };
        } else {
          const solo = CHAMP_CHAT.solo;
          this.showBubble(v.pos.x, v.pos.y, solo[Math.floor(Math.random() * solo.length)], 2.6);
        }
        v.chatCd = 9 + Math.random() * 7;
      }
      return;
    }
    /* Choose a new destination near a hero or beside a path. */
    v.wanderT = 1.6 + Math.random() * 2.2;
    const heroes = state.field;
    if (heroes.length && Math.random() < 0.6) {
      const h = heroes[Math.floor(Math.random() * heroes.length)];
      const a = Math.random() * Math.PI * 2;
      v.dest = { x: h.x + Math.cos(a) * 34, y: h.y + Math.sin(a) * 24 };
      v.chatWith = h.id;
    } else {
      const r = Math.floor(Math.random() * D.ROUTES.length);
      const s = 60 + Math.random() * Math.max(40, D.ROUTE_LENS[r] - 140);
      const p = D.routePoint(r, s);
      v.dest = { x: p.x + (-p.dy) * 28, y: p.y + p.dx * 28 };
      v.chatWith = null;
    }
    v.dest.x = Math.max(30, Math.min(D.FIELD_W - 30, v.dest.x));
    v.dest.y = Math.max(30, Math.min(D.FIELD_H - 20, v.dest.y));
  }

  _champFrame(dt, t, state) {
    const v = this.champView;
    if (!v || !state || !state.champ) return;
    const c = state.champ;
    const wave = state.phase === 'wave';

    /* Combat destinations come from the engine; preparation destinations come from visual wandering. */
    if (wave || state.phase === 'over' || v.ko) {
      v.dest.x = c.x; v.dest.y = c.y;
      v.chatSeq = null;
    } else {
      this._champWander(dt, state, v);
    }

    /* Catch up quickly to distant targets, including the wave-start plaza. */
    const dx = v.dest.x - v.pos.x, dy = v.dest.y - v.pos.y;
    const dist = Math.hypot(dx, dy);
    let moving = false;
    if (dist > 2.5) {
      const base = D.CHAMP.moveSpd * (wave ? 1.05 : 0.55);
      const spd = dist > 60 ? Math.max(base * 2.4, dist * 2.2) : base;
      const step = Math.min(spd * dt, dist);
      v.pos.x += (dx / dist) * step;
      v.pos.y += (dy / dist) * step;
      v.targetFaceY = Math.atan2(dx, dy);
      moving = true;
    }
    v.holder.position.set(wx(v.pos.x), 0, wz(v.pos.y));

    /* Facing uses the same sign for logical y and world z. */
    let dyaw = v.targetFaceY - v.faceY;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    v.faceY += dyaw * Math.min(1, dt * 10);
    v.model.rotation.y = v.faceY;

    /* Knockout pose: lie down with the companion star near the shoulder. */
    v.koT += ((v.ko ? 1 : 0) - v.koT) * Math.min(1, dt * 4);
    v.model.rotation.x = -1.35 * v.koT;
    v.model.position.y = 0.14 * v.koT;
    v.ring.material.opacity = 0.8 * (1 - v.koT * 0.7);
    if (v.ko && Math.random() < dt * 1.4) {
      this.burst(v.holder.position.x, 0.5, v.holder.position.z, 0xaab4d4, 1, 0.5, { grav: -0.6, ttl: 0.9, size: 0.5 });
    }

    /* Walking swings legs and arms in opposite phases. */
    v.walkPhase += dt * (moving ? 11 : 0);
    const swing = moving ? Math.sin(v.walkPhase) * 0.55 : 0;
    const k14 = Math.min(1, dt * 14);
    v.refs.legs[0].rotation.x += (swing - v.refs.legs[0].rotation.x) * k14;
    v.refs.legs[1].rotation.x += (-swing - v.refs.legs[1].rotation.x) * k14;
    if (v.attackT <= 0) v.refs.armL.rotation.x += (swing * -0.5 - v.refs.armL.rotation.x) * k14;

    /* Breathing, cape and companion-star motion. */
    v.refs.body.scale.y = 1 + Math.sin(t * 2.8) * 0.025;
    v.refs.cape.rotation.x = 0.16 + Math.sin(t * 3.2) * 0.1 + (moving ? 0.28 : 0);
    const sa = t * 2.2;
    v.refs.star.position.set(Math.cos(sa) * 0.45, (v.ko ? 0.5 : 1.2) + Math.sin(t * 3.1) * 0.08, Math.sin(sa) * 0.45);
    v.refs.star.rotation.y = t * 3;
    v.refs.emblem.rotation.y = t * 2;
    if (v.refs.staffOrb) v.refs.staffOrb.scale.setScalar(1 + Math.sin(t * 5) * 0.15);

    /* Attack swing. */
    if (v.attackT > 0) {
      v.attackT = Math.max(0, v.attackT - dt * 3.6);
      const k = Math.sin((1 - v.attackT) * Math.PI);
      v.refs.armPivot.rotation.x = -1.8 * k;
    } else {
      v.refs.armPivot.rotation.x *= 0.8;
    }

    v.bar.quaternion.copy(this.camera.quaternion);
  }

  setRegionTheme(id) {
    const theme = regionTheme(id);
    if (this.region?.id === theme.id && this.regions) return;
    this.region = theme;
    this._regionGroundColor.setHex(theme.ground);
    this._regionRoadColor.setHex(theme.road);
    this._regionRoadEdgeColor.setHex(theme.roadEdge);
    this._regionWallColor.setHex(theme.wall);
    if (this.forcedHour == null) this.dayTarget = theme.phase;
    if (this.roadMaterial) this.roadMaterial.color.copy(this._regionRoadColor);
    if (this.roadEdgeMaterial) this.roadEdgeMaterial.color.copy(this._regionRoadEdgeColor);
    if (this.ground?.material) {
      const groundMap = theme.grass === false ? null : this.groundTexture;
      if (this.ground.material.map !== groundMap) {
        this.ground.material.map = groundMap;
        this.ground.material.needsUpdate = true;
      }
    }
    this.grass?.setVisible(theme.grass !== false);
    this.regions?.setTheme(theme.id);
    this._syncGatePilotVisibility();
    for (const view of this.heroViews?.values?.() || []) this._syncPilotVisibility(view);
    for (const view of this.enemyViews?.values?.() || []) this._syncPilotVisibility(view);
  }

  /* Real time, not wave progression, controls day/night and lunar phase. ?hour overrides it for inspection. Combat events and bosses must never overwrite this palette. */
  _updateDaylight(dt, state) {
    /* Read the clock once per second instead of allocating Date objects every frame. */
    this._clockT = (this._clockT || 0) - dt;
    if (this._clockT <= 0) {
      this._clockT = 1;
      this.dayTarget = this.forcedHour == null ? this.region.phase : clockPhase(this.forcedHour);
      this.moonPhase = Math.max(0.12, moonPhaseNow());
    }
    /* Interpolate smoothly rather than abruptly switching palette values. */
    this.dayPhase += (this.dayTarget - this.dayPhase) * Math.min(1, dt * 0.5);
    const p = daylightPalette(this.dayPhase, this.palette);

    this.baseFog.copy(p.fog);
    this.baseClear.copy(p.sky);
    this.sun.color.copy(p.sun);
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGnd);
    /* Rotate light direction at a fixed distance to preserve the shadow-camera bounds. */
    this.sun.position.copy(p.sunPos).setLength(17);
    this.baseSunI = p.sunI;
    this.baseHemiI = p.hemiI;
    this.scene.fog.color.copy(this.baseFog);
    this.scene.background.copy(this.baseClear);
    this.renderer.setClearColor(this.baseClear);
    this.scene.fog.far = this.fogFar;
    this.hemi.intensity = this.baseHemiI;
    this.sun.intensity = this.baseSunI;
    /* Darken ground at night so grass does not look fluorescent under lighting alone. */
    const n = p.night;
    this.ground.material.color.setRGB(0.82 - n * 0.65, 0.89 - n * 0.71, 0.76 - n * 0.56);
    this.ground.material.color.lerp(this._regionGroundColor, 0.38);
  }

  _makeEnemyView(e) {
    const E = D.ENEMY_TYPES[e.type];
    const scale = (e.size / 30) * 1.55;
    const g = new THREE.Group();

    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(E.emoji), transparent: true }));
    spr.scale.set(scale, scale, 1);
    spr.position.y = scale * 0.62;
    g.add(spr);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(scale * 0.85, scale * 0.6),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    g.add(shadow);

    /* A single gold outline identifies elite enemies immediately without introducing extra tier categories. */
    let eliteRing = null;
    if (e.elite) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(scale * 0.4, scale * 0.5, 20),
        new THREE.MeshBasicMaterial({ color: 0xffd452, transparent: true, opacity: 0.9, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      g.add(ring);
      eliteRing = ring;
      /* Tint slightly red to distinguish the same base icon. */
      spr.material.color.setHex(0xffd9a8);
    }

    let auraRing = null;
    if (e.boss || e.midBoss) {
      const col = e.boss ? 0xff4444 : 0xff9a3d;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(scale * 0.42, scale * 0.54, 24),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      g.add(ring);
      auraRing = ring;
      /* Aura rising from the feet. */
      const aura = new THREE.Mesh(
        new THREE.RingGeometry(scale * 0.6, scale * 0.78, 26),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.4, depthWrite: false })
      );
      aura.rotation.x = -Math.PI / 2;
      aura.position.y = 0.05;
      g.add(aura);
      g.userData.aura = aura;
    }

    const barW = e.boss ? 2.1 : (e.midBoss ? 1.6 : 1.1);
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, 0.14),
      new THREE.MeshBasicMaterial({ color: 0x1c2333, transparent: true, opacity: 0.75, depthTest: false })
    );
    const fg = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, 0.11),
      new THREE.MeshBasicMaterial({ color: e.boss ? 0xc084fc : (e.midBoss ? 0xffa040 : 0xf87171), depthTest: false })
    );
    fg.position.z = 0.001;
    bg.renderOrder = 40; fg.renderOrder = 41;
    bar.add(bg, fg);
    bar.position.y = scale * 1.32;
    bar.visible = false;
    g.add(bar);

    this.scene.add(g);
    const view = {
      group: g, spr, bar, barFg: fg, barW, baseScale: scale,
      boss: e.boss, midBoss: e.midBoss, auraRing, eliteRing,
      faceY: Math.PI, targetFaceY: Math.PI, lastWorld: null,
    };
    const slot = enemyPilotSlot(this.region?.id, e);
    this._attachPilotModel(view, slot, g, spr, scale * (slot?.heightMul || 1));
    return view;
  }

  _makeBlueprintView(summon) {
    const spec = D.monsterBlueprintSpec(summon.blueprint);
    const group = new THREE.Group();
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: emojiTexture(spec?.emoji || '👺'), transparent: true, color: 0xdfffea,
    }));
    sprite.scale.set(1.25, 1.25, 1);
    sprite.position.y = .82;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(.5, .68, 24),
      new THREE.MeshBasicMaterial({ color: 0x66efb2, transparent: true, opacity: .78, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = .06;
    group.add(sprite, ring);
    this.scene.add(group);
    return { group, sprite, ring, attackT: 0 };
  }

  _makeConstellationAidView() {
    const group = new THREE.Group();
    const { group: model, refs } = makeHumanHero('mage', 2);
    model.scale.setScalar(.78);
    model.rotation.y = Math.PI;
    model.position.y = .05;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(.52, .7, 24),
      new THREE.MeshBasicMaterial({ color: 0xd8b4ff, transparent: true, opacity: .78, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = .04;
    const star = new THREE.Mesh(
      new THREE.OctahedronGeometry(.16),
      new THREE.MeshBasicMaterial({ color: 0xffe27a }),
    );
    star.position.set(0, 1.28, 0);
    group.add(model, ring, star);
    this.scene.add(group);
    return { group, model, refs, ring, star, attackT: 0 };
  }

  /* State synchronization. */
  sync(state) {
    const fieldIds = new Set();
    for (const h of state.field) {
      fieldIds.add(h.id);
      let v = this.heroViews.get(h.id);
      if (!v) {
        v = this._makeHeroView(h);
        /* Initially face the nearest path. */
        let bx = 0, bz = 0, bd = Infinity;
        for (let r = 0; r < D.ROUTES.length; r++) {
          for (let s = 0; s < D.ROUTE_LENS[r]; s += 24) {
            const p = D.routePoint(r, s);
            const d = Math.hypot(p.x - h.x, p.y - h.y);
            if (d < bd) { bd = d; bx = p.x; bz = p.y; }
          }
        }
        v.faceY = v.targetFaceY = Math.atan2(wx(bx) - wx(h.x), wz(bz) - wz(h.y));
        this.heroViews.set(h.id, v);
      }
      v.holder.position.set(wx(h.x), 0, wz(h.y));
    }
    for (const [id, v] of this.heroViews) {
      if (!fieldIds.has(id)) {
        this._disposePilotView(v);
        this.scene.remove(v.holder);
        this.heroViews.delete(id);
      }
    }

    const blueprintIds = new Set();
    for (const summon of state.blueprintSummons || []) {
      blueprintIds.add(summon.id);
      let view = this.blueprintViews.get(summon.id);
      if (!view) {
        view = this._makeBlueprintView(summon);
        this.blueprintViews.set(summon.id, view);
      }
      view.group.position.set(wx(summon.x), 0, wz(summon.y));
    }
    for (const [id, view] of this.blueprintViews) {
      if (!blueprintIds.has(id)) {
        this.scene.remove(view.group);
        this.blueprintViews.delete(id);
      }
    }

    const aidIds = new Set();
    for (const summon of state.constellationAids || []) {
      aidIds.add(summon.id);
      let view = this.constellationAidViews.get(summon.id);
      if (!view) {
        view = this._makeConstellationAidView();
        this.constellationAidViews.set(summon.id, view);
      }
      view.group.position.set(wx(summon.x), 0, wz(summon.y));
    }
    for (const [id, view] of this.constellationAidViews) {
      if (!aidIds.has(id)) {
        this.scene.remove(view.group);
        this.constellationAidViews.delete(id);
      }
    }

    /* Reflect champion growth and health; _champFrame owns position updates. */
    if (state.champ) {
      if (!this.champView) this.champView = this._makeChampView();
      const v = this.champView;
      v.ko = state.champ.ko;
      v.phase = state.phase;
      const ratio = state.champ.maxHp ? Math.max(0, state.champ.hp / state.champ.maxHp) : 1;
      v.bar.visible = state.phase === 'wave' && !v.ko;
      v.barFg.scale.x = Math.max(0.001, ratio);
      v.barFg.position.x = -(1 - ratio) * v.barW / 2;
      v.barFg.material.color.setHex(ratio < 0.3 ? 0xff6b6b : ratio < 0.6 ? 0xffc93d : 0x7fe08a);
    }

    const enemyIds = new Set();
    for (const e of state.enemies) {
      enemyIds.add(e.id);
      let v = this.enemyViews.get(e.id);
      if (!v) {
        v = this._makeEnemyView(e);
        this.enemyViews.set(e.id, v);
      }
      const nx = wx(e.x), nz = wz(e.y);
      if (v.lastWorld) {
        const dx = nx - v.lastWorld.x, dz = nz - v.lastWorld.z;
        if (dx * dx + dz * dz > 1e-7) v.targetFaceY = Math.atan2(dx, dz);
      }
      v.lastWorld = { x: nx, z: nz };
      v.group.position.set(nx, 0, nz);
      const ratio = Math.max(0, e.hp / e.maxHp);
      v.bar.visible = ratio < 1;
      v.barFg.scale.x = Math.max(0.001, ratio);
      v.barFg.position.x = -(1 - ratio) * v.barW / 2;
      v.burning = !!e.burn;
      v.slowed = !!e.slowed;
      v.enraged = !!e.enraged;
      v.stunned = !!e.stunned;
      v.held = !!e.held;
    }
    for (const [id, v] of this.enemyViews) {
      if (!enemyIds.has(id)) {
        this._disposePilotView(v);
        this.scene.remove(v.group);
        this.enemyViews.delete(id);
      }
    }

    const projIds = new Set();
    for (const p of state.projectiles) {
      projIds.add(p.id);
      let v = this.projViews.get(p.id);
      if (!v) {
        v = this._makeProjView(p);
        this.projViews.set(p.id, v);
      }
      const y3 = p.kind === 'bolt' ? 1.6 : p.kind === 'constellation' ? 1.25 : 0.85;
      const nx = wx(p.x), nz = wz(p.y);
      if (p.kind === 'arrow' && v.lastPos) {
        const dx = nx - v.lastPos.x, dz = nz - v.lastPos.z;
        if (dx * dx + dz * dz > 1e-6) v.group.rotation.y = -Math.atan2(dz, dx);
      }
      v.lastPos = { x: nx, z: nz };
      v.group.position.set(nx, y3, nz);
    }
    for (const [id, v] of this.projViews) {
      if (!projIds.has(id)) { this.scene.remove(v.group); this.projViews.delete(id); }
    }

    for (let k = 0; k < this.crystals.length; k++) this.crystals[k].visible = k < state.castle.tower;
    for (let k = 0; k < this.fortifyBands.length; k++) this.fortifyBands[k].visible = k < state.castle.fortify;

    /* Change the castle silhouette at each upgrade, not merely its decorative bands. */
    const fo = state.castle.fortify, tw = state.castle.tower;
    this.castleFortify = fo;
    this.wall.scale.y = 1 + Math.min(fo, 1) * 0.14;
    this.wall.position.y = 1.05 + Math.min(fo, 1) * 0.1;
    for (const m of this.extraMerlons) m.visible = fo >= 2;
    for (const sp of this.spikes) sp.visible = fo >= 3;
    if (this.steelGate) { this.steelGate.visible = fo >= 4; this.gate.visible = fo < 4; }
    this._syncGatePilotVisibility(fo);
    if (this.wallBaseColor) {
      this.wall.material.color.copy(fo >= 5 ? new THREE.Color(0xe8ecf6) : this.wallBaseColor);
    }
    for (let k = 0; k < this.towerPillars.length; k++) this.towerPillars[k].visible = k < tw;
    if (this.towerRing) this.towerRing.visible = tw >= 3;
    /* Default flag color summarizes castle upgrade level at a distance. */
    const lv = fo + tw;
    const flagColor = lv >= 8 ? 0xff6bd6 : lv >= 6 ? 0x9b7bff : lv >= 4 ? 0x62d0ff : lv >= 2 ? 0x7ff08a : 0xffc93d;
    for (const f of this.flags) f.material.color.setHex(flagColor);
    const hpRatio = state.castleMax > 0 ? state.castleHp / state.castleMax : 1;
    this.castleHpRatio = hpRatio;
    const char = new THREE.Color(0x554f5e);
    for (const m of this.castleStoneMats) {
      m.color.copy(m.userData.baseColor)
        .lerp(this._regionWallColor, this.region.stoneMix)
        .lerp(char, (1 - hpRatio) * 0.55);
    }

    if (this.placementMode) {
      /* In swap mode, occupied pads are valid targets. Green means move to an empty pad; blue means swap with a hero. */
      for (let i = 0; i < D.PADS.length; i++) {
        const occ = state.field.find(h => h.padIndex === i);
        const self = occ && occ.id === this.selectedHeroId;
        const hl = this.padHighlights[i];
        hl.visible = self ? false : (!occ || this.swapMode);
        hl.material.color.setHex(occ ? 0x4aa8ff : 0x3ddc6e);
      }
    } else {
      for (const hl of this.padHighlights) hl.visible = false;
    }

    let rangeShown = false;
    if (this.placementMode && this.hoverPad != null && this.placeRange > 0) {
      const pad = D.PADS[this.hoverPad];
      this.rangeGroup.position.set(wx(pad.x), 0.16, wz(pad.y));
      this.rangeGroup.scale.setScalar(this.placeRange * S);
      this.rangeGroup.visible = true;
      rangeShown = true;
    }
    if (this.selectedHeroId != null) {
      const h = state.field.find(v => v.id === this.selectedHeroId);
      if (h) {
        this.selRing.visible = true;
        this.selRing.position.set(wx(h.x), 0.15, wz(h.y));
        if (!rangeShown) {
          this.rangeGroup.position.set(wx(h.x), 0.16, wz(h.y));
          this.rangeGroup.scale.setScalar(D.CLASSES[h.cls].range * S);
          this.rangeGroup.visible = true;
          rangeShown = true;
        }
      } else this.selRing.visible = false;
    } else this.selRing.visible = false;
    if (!rangeShown) this.rangeGroup.visible = false;
  }

  _makeProjView(p) {
    const g = new THREE.Group();
    if (p.kind === 'arrow') {
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0x8a5a2b }));
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 6), new THREE.MeshBasicMaterial({ color: 0xe8e8e8 }));
      head.rotation.z = -Math.PI / 2;
      head.position.x = 0.36;
      g.add(shaft, head);
      if (p.splash > 0) {   /* Spirit archer uses glowing arrows. */
        const glowTip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color: 0xd8b4ff }));
        glowTip.position.x = 0.36;
        g.add(glowTip);
      }
    } else if (p.kind === 'orb') {
      const color = p.splashSlow ? 0x9fdcff : 0xd08bff;   /* Cryomancer uses icy colors. */
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), new THREE.MeshBasicMaterial({ color }));
      g.add(orb);
      g.userData.pulse = true;
    } else if (p.kind === 'blueprint') {
      const stamp = new THREE.Mesh(
        new THREE.OctahedronGeometry(.18),
        new THREE.MeshBasicMaterial({ color: 0x65f0af }),
      );
      g.add(stamp);
      g.userData.pulse = true;
    } else if (p.kind === 'constellation') {
      const star = new THREE.Mesh(
        new THREE.OctahedronGeometry(.2),
        new THREE.MeshBasicMaterial({ color: 0xffe27a }),
      );
      g.add(star);
      g.userData.pulse = true;
    } else {
      const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: 0x8df3ff }));
      g.add(bolt);
      g.userData.pulse = true;
    }
    this.scene.add(g);
    return { group: g, lastPos: null };
  }

  /* Engine events to visual effects. */
  _heroAttackAnim(heroId, tx, ty) {
    const v = this.heroViews.get(heroId);
    if (!v) return;
    v.attackT = 1;
    if (tx != null) {
      const hx = v.holder.position.x, hz = v.holder.position.z;
      v.targetFaceY = Math.atan2(wx(tx) - hx, wz(ty) - hz);
    }
  }

  onEvents(state, events) {
    for (const ev of events) {
      const x3 = ev.x != null ? wx(ev.x) : 0;
      const z3 = ev.y != null ? wz(ev.y) : 0;
      switch (ev.type) {
        case 'enemyHit': {
          if (ev.tactic === 'flare') {
            /* Flare damage numbers and rings appear on the starfall impact frame. */
          } else if (ev.kind === 'burn') {
            if (Math.random() < 0.4) this.showNumber(x3, 1.7, z3, `${ev.dmg}`, '#ff9a3d', 0.72);
          } else if (ev.kind === 'slow') {
            /* Use explicit frost feedback because a zero-damage number would imply nothing happened. */
            this.showNumber(x3, 2.0, z3, '❄ 감속!', '#b9f5ff', 0.82);
            this.burst(x3, 0.9, z3, 0x9fdcff, 5, 1.8, { grav: -0.8, ttl: 0.45, size: 0.65 });
          } else if (ev.kind === 'crit') {
            /* Large yellow critical numbers emphasize melee bursts. */
            this.showNumber(x3, 2.0, z3, `${ev.dmg}!`, '#ffd93d', 1.35);
            this.burst(x3, 1.0, z3, 0xffd93d, 10, 4, { grav: 3, ttl: 0.3 });
            this.addShake(0.14);
          } else {
            this.showNumber(x3, 1.8, z3, `${ev.dmg}`, '#ffffff', ev.dmg >= 100 ? 1.15 : 0.85);
          }
          break;
        }
        case 'tacticPush': {
          const fromX = wx(ev.fromX), fromZ = wz(ev.fromY);
          this._shockRing(fromX, fromZ, 0.72, 0x8dff9e, 0.32);
          this.burst(fromX, 0.8, fromZ, 0xb8ffad, 8, 2.3, { grav: 1.2, ttl: 0.38 });
          this.burst(x3, 0.55, z3, 0x71d993, 5, 1.4, { grav: -0.7, ttl: 0.42 });
          this.showNumber(x3, 1.65, z3, '↩ 밀침', '#baffad', 0.76);
          break;
        }
        case 'block': {
          /* Shield barrier feedback combines a ground ring with a stopped marker. */
          this._blockWave(x3, z3, ev.range * S);
          this.burst(x3, 0.5, z3, 0x9fd0ff, 16, 3.2, { grav: 1.5, ttl: 0.4 });
          this.showNumber(x3, 2.4, z3, '🛡️ 멈춰!', '#9fd0ff', 1.1);
          this.addShake(0.2);
          break;
        }
        case 'heroActive': {
          const palette = {
            strike: [0xffd66b, '#ffe8a3'], nova: [0xbd8cff, '#e6caff'],
            ward: [0x85c9ff, '#b9e2ff'], volley: [0xffb66e, '#ffd5a6'],
            frost: [0x8de8ff, '#c6f5ff'],
          };
          const [color, textColor] = palette[ev.kind] || [0xd8b4ff, '#eadcff'];
          const first = ev.hits?.[0];
          this._heroAttackAnim(ev.heroId, first?.x, first?.y);
          this._shockRing(x3, z3, 1.15, color, .5, .18);
          this.burst(x3, 1.05, z3, color, 14, 2.8, { grav: 1.2, ttl: .44 });
          this.showNumber(x3, 2.45, z3, `${ev.emoji} ${ev.ability}`, textColor, 1.02);
          for (const hit of (ev.hits || []).slice(0, 7)) {
            const hx = wx(hit.x), hz = wz(hit.y);
            this._shockRing(hx, hz, ev.kind === 'nova' ? 1.15 : .58, color, .42, .12);
            this.burst(hx, .75, hz, color, ev.kind === 'nova' ? 10 : 5, 2.2, { grav: .8, ttl: .38 });
          }
          this.addShake(.1);
          break;
        }
        case 'blueprintSummon': {
          this._shockRing(x3, z3, 1.05, 0x65f0af, .48, .16);
          this.burst(x3, .8, z3, 0x65f0af, 12, 2.2, { grav: .8, ttl: .42 });
          this.showNumber(x3, 2.0, z3, `${ev.emoji} ${ev.name}`, '#c8ffe4', .95);
          break;
        }
        case 'blueprintAttack': {
          const view = this.blueprintViews.get(ev.summonId);
          if (view) view.attackT = 1;
          this.burst(x3, .82, z3, 0x65f0af, 4, 1.3, { grav: .4, ttl: .3 });
          break;
        }
        case 'blueprintDismiss': {
          this.burst(x3, .62, z3, 0x8aa69a, 6, 1.4, { grav: .5, ttl: .35 });
          break;
        }
        case 'tacticHeroLink': {
          const view = this.heroViews.get(ev.heroId);
          if (view) {
            view.attackT = Math.max(view.attackT || 0, .55);
            this.burst(view.holder.position.x, .9, view.holder.position.z,
              ev.kind === 'flare' ? 0xffb05c : ev.kind === 'tide' ? 0x77d9ff : 0x8fe39c,
              ev.ready ? 10 : 5, ev.ready ? 2.4 : 1.5, { grav: -1, ttl: .45 });
            if (ev.primary) this.showBubble(ev.x, ev.y, ev.ready ? `${ev.emoji} 준비 완료!` : `${ev.ability} 연계`, 1.3);
          }
          break;
        }
        case 'constellationAidSummon': {
          this._shockRing(x3, z3, 1.12, 0xd8b4ff, .5, .16);
          this.burst(x3, .85, z3, 0xd8b4ff, 14, 2.5, { grav: .7, ttl: .46 });
          this.showNumber(x3, 2.05, z3, '✦ 별자리 수호자', '#fff0ae', 1.02);
          break;
        }
        case 'constellationAidAttack': {
          const view = this.constellationAidViews.get(ev.summonId);
          if (view) view.attackT = 1;
          this.burst(x3, 1.1, z3, 0xffe27a, 5, 1.6, { grav: .2, ttl: .32 });
          break;
        }
        case 'constellationAidDismiss': {
          this.burst(x3, .72, z3, 0xb9a0dc, 8, 1.8, { grav: .4, ttl: .38 });
          break;
        }
        case 'kill': {
          const col = ev.boss ? 0xffd93d : (ev.midBoss ? 0xffa040
            : ({ goblin: 0x7fd45e, wolf: 0x9aa7ba, orc: 0xd46e5e, troll: 0x5ea7d4, shaman: 0xb08bff }[ev.etype] || 0xffffff));
          const n = ev.boss ? 56 : (ev.midBoss ? 28 : 12);
          const spd = ev.boss ? 6.5 : (ev.midBoss ? 4.4 : 3.2);
          this.burst(x3, 0.9, z3, col, n, spd);
          if (ev.boss) this.burst(x3, 1.4, z3, 0xffffff, 24, 4.5);
          this.showNumber(x3, 2.2, z3, `+${ev.gold}💰`, '#ffd93d', ev.boss ? 1.3 : (ev.midBoss ? 1.1 : 0.9));
          /* Announce only multiplier increases, not every kill, to prevent overlapping text. */
          if (ev.combo === D.COMBO.x2At || ev.combo === D.COMBO.x3At) {
            this.showNumber(x3, 3.0, z3, `골드 ${ev.mul}배!`, '#ff8a3d', 1.25);
          }
          this.addShake(ev.boss ? 0.6 : (ev.midBoss ? 0.3 : 0.07));
          break;
        }
        case 'meleeHit':
          this._heroAttackAnim(ev.heroId, ev.tx, ev.ty);
          if (ev.cleave) {
            this.burst(x3, 0.8, z3, 0xffffff, 18, 4.5, { grav: 2, ttl: 0.3 });
            this.addShake(0.12);
          } else if (ev.slow) {
            this.burst(x3, 0.9, z3, 0x9fdcff, 6, 2.4, { grav: 3, ttl: 0.3 });
          } else if (ev.burn) {
            this.burst(x3, 0.9, z3, 0xff8830, 6, 2.6, { grav: 3, ttl: 0.28 });
          } else {
            this.burst(x3, 0.9, z3, 0xffffff, 4, 2.6, { grav: 3, ttl: 0.22 });
          }
          break;
        case 'shoot':
          this._heroAttackAnim(ev.heroId, ev.tx, ev.ty);
          break;
        case 'explode': {
          /* Show blast radius with a ring so the affected area is readable. */
          const r3 = (ev.radius || 62) * S;
          if (ev.frost) {
            this._shockRing(x3, z3, r3, 0x9fdcff, 0.45, 0.2);
            this._shockRing(x3, z3, r3 * 0.6, 0xe8fbff, 0.35, 0.22);
            this.burst(x3, 0.9, z3, 0x9fdcff, ev.big ? 26 : 16, ev.big ? 4.2 : 3.2);
            this.burst(x3, 1.1, z3, 0xe8fbff, 10, 2.2, { grav: -0.5, ttl: 0.6 });
          } else {
            this._shockRing(x3, z3, r3, 0xffa040, 0.45, 0.2);
            this._shockRing(x3, z3, r3 * 0.55, 0xffe08a, 0.32, 0.22);
            this.burst(x3, 0.9, z3, 0xffa040, ev.big ? 30 : 18, ev.big ? 4.6 : 3.4);
            this.burst(x3, 0.9, z3, 0xff5533, ev.big ? 14 : 8, 2.6);
          }
          this.addShake(ev.big ? 0.22 : 0.12);
          break;
        }
        case 'boltHit':
          this.burst(x3, 1.1, z3, 0x8df3ff, 8, 3);
          break;
        case 'pierceHit':
          this.burst(x3, 1.0, z3, 0xffffff, 5, 3.4, { grav: 2 });
          break;
        case 'castleHit':
          this.burst(0, 1.2, -4.0, 0xff5544, 20, 4);
          this.burst(0, 1.6, -4.1, 0x9aa2b8, 10, 3);
          this.showNumber(0, 2.5, -3.7, `-${ev.dmg}`, '#ff4444', 1.25);
          this.addShake(0.42);
          break;
        case 'castleHeal':
          this.burst(0, 1.5, -4.1, 0x8dff9e, 8, 1.8, { grav: -1.5, ttl: 0.6 });
          this.showNumber(0, 2.6, -3.7, `+${ev.amount}`, '#7dff8e', 0.95);
          break;
        case 'heal':
          this.burst(x3, 1.3, z3, 0x6effa0, 7, 1.6, { grav: -1.5, ttl: 0.5 });
          break;
        case 'spawn':
          if (ev.boss) {
            this.burst(x3, 0.9, z3, 0xff3322, 40, 5.5);
            this.burst(x3, 1.2, z3, 0xc478f0, 20, 3.4);
            this.addShake(0.62);
          } else if (ev.midBoss) {
            this.burst(x3, 0.9, z3, 0xff9a3d, 22, 4);
            this.addShake(0.3);
          } else {
            this.burst(x3, 0.9, z3, 0xc478f0, 6, 2.2);
          }
          break;
        case 'bossWarn':
          /* Local red portal feedback. */
          this.burst(0, 1.0, wz(430), ev.tier === 'great' ? 0xff2222 : 0xff9a3d, ev.tier === 'great' ? 26 : 14, 3.2, { grav: -1 });
          this.addShake(ev.tier === 'great' ? 0.22 : 0.12);
          break;
        case 'bossSpawn':
          /* The cut-in uses the live GLB/fallback actor already entering the
           * simulation, so the appearance can never drift from gameplay art. */
          this.cameraCutscene = {
            t: ev.tier === 'great' ? 2.6 : 2.15,
            duration: ev.tier === 'great' ? 2.6 : 2.15,
            target: new THREE.Vector3(x3, ev.tier === 'great' ? 1.35 : 1.05, z3),
          };
          break;
        case 'bossEnrage':
          this.burst(x3, 1.2, z3, 0xff2200, 36, 5.5, { grav: 2 });
          this.burst(x3, 0.8, z3, 0xffcc00, 18, 3.2);
          this.showNumber(x3, 3.0, z3, '분노!!', '#ff3322', 1.4);
          this.addShake(0.55);
          break;
        case 'waveEnd':
          for (let k = 0; k < 5; k++) {
            this.burst((Math.random() - 0.5) * 10, 3 + Math.random() * 2, (Math.random() - 0.5) * 8,
              [0xffd93d, 0x7fd45e, 0x6eb5ff, 0xff8ac2][k % 4], 12, 3, { grav: 3 });
          }
          break;
        case 'gameOver':
          this.addShake(0.8);
          this.burst(0, 1.5, -4.5, 0xff5533, 60, 6);
          break;

        /* Champion feedback. */
        case 'champAttack': {
          const v = this.champView;
          if (v) {
            v.attackT = 1;
            v.targetFaceY = Math.atan2(ev.tx - v.pos.x, ev.ty - v.pos.y);
          }
          if (ev.cleave) this.burst(x3, 0.8, z3, 0xfff3b0, 10, 3.6, { grav: 2, ttl: 0.3 });
          break;
        }
        case 'champHurt':
          /* Throttle small repeated damage numbers to avoid filling the screen. */
          if (Math.random() < 0.35) this.showNumber(x3, 2.3, z3, `-${ev.dmg}`, '#ff8a8a', 0.78);
          break;
        case 'champKo':
          this.burst(x3, 0.8, z3, 0xaab4d4, 22, 3.6);
          this.showBubble(ev.x, ev.y - 6, '으윽… 별이 빙글빙글…', 2.6);
          this.addShake(0.3);
          break;
        case 'champLevel': {
          const v = this.champView;
          const px = v ? v.holder.position.x : x3;
          const pz = v ? v.holder.position.z : z3;
          this._lightPillar(px, pz, 3);
          this._shockRing(px, pz, 1.7, 0xffe27a, 0.6);
          this.burst(px, 1.2, pz, 0xffe27a, 20, 3.6, { grav: 2 });
          this.showNumber(px, 2.6, pz, `⬆ Lv ${ev.level}!`, '#ffe27a', 1.25);
          break;
        }
        case 'starfall':
          this._starfall(x3, z3, 0, ev.tactic === 'flare'
            ? { tactic: 'flare', dmg: ev.dmg, stars: ev.stars, lethal: ev.lethal }
            : null);
          break;
        case 'starAuto':
          if (this.champView) this.showBubble(this.champView.pos.x, this.champView.pos.y, '별똥별은 아껴 두면 녹슬어요!', 2.2);
          break;
        case 'ultCast': {
          const hits = ev.hits || [];
          hits.forEach((h, i) => this._starfall(wx(h.x), wz(h.y), Math.min(1.2, i * 0.05)));
          this.addShake(0.55);
          break;
        }
        case 'ultReady':
          if (this.champView) {
            const p = this.champView.holder.position;
            this.burst(p.x, 1.4, p.z, 0xd8b4ff, 14, 2.6, { grav: -0.5, ttl: 0.7 });
          }
          break;
        case 'champWave':
          if (ev.perfect) this.burst(0, 2.5, -4.3, 0xffe27a, 26, 4, { grav: 2 });
          break;
        case 'feast': {
          /* Rebuild a promoted hero's model with its new tier cape and crown. */
          const hv = this.heroViews.get(ev.heroId);
          if (hv) {
            this._disposePilotView(hv);
            this.scene.remove(hv.holder);
            this.heroViews.delete(ev.heroId);
          }
          /* Feast effects use the promoted hero's pad or the plaza when benched. */
          const fx = ev.pad >= 0 ? wx(D.PADS[ev.pad].x) : 0;
          const fz = ev.pad >= 0 ? wz(D.PADS[ev.pad].y) : 2.6;
          this._lightPillar(fx, fz, ev.to);
          this._shockRing(fx, fz, 2.2, 0xffd93d, 0.7);
          const cols = [0xffd93d, 0x7fd45e, 0x6eb5ff, 0xff8ac2];
          for (let k = 0; k < 4; k++) {
            this.burst(fx + (Math.random() - 0.5) * 1.6, 1 + Math.random(), fz + (Math.random() - 0.5) * 1.6,
              cols[k], 14, 4, { grav: 3 });
          }
          if (this.champView) {
            this.showBubble(this.champView.pos.x, this.champView.pos.y, '잔치다~!! 🎉', 2.4);
            /* Redirect the champion's preparation wandering toward the feast. */
            this.champView.dest = ev.pad >= 0
              ? { x: D.PADS[ev.pad].x + 30, y: D.PADS[ev.pad].y + 16 }
              : { x: 350, y: 300 };
            this.champView.wanderT = 4;
          }
          this.addShake(0.25);
          break;
        }
      }
    }
  }

  /* Frame updates. */
  frame(dt, state) {
    this.time += dt;
    const t = this.time;

    this.portal.rotation.z = t * 1.6;
    const ps = 1 + Math.sin(t * 3) * 0.08;
    this.portal.scale.set(ps, ps, ps);

    for (let i = 0; i < this.flags.length; i++) {
      this.flags[i].rotation.y = Math.sin(t * 4 + i * 2) * 0.28;
    }
    for (let i = 0; i < this.crystals.length; i++) {
      const c = this.crystals[i];
      if (!c.visible) continue;
      c.rotation.y = t * 2 + i;
      c.position.y = (4.6 + (i === 1 ? 0.5 : 0)) + Math.sin(t * 2.4 + i * 1.4) * 0.12;
    }

    for (const [id, v] of this.heroViews) {
      const pilotAttacking = v.attackT > 0;
      v.refs.body.scale.y = 1 + Math.sin(t * 2.6 + id) * 0.025;
      v.refs.head.position.y = 0.93 + Math.sin(t * 2.6 + id) * 0.012;
      if (v.refs.cape) v.refs.cape.rotation.x = 0.16 + Math.sin(t * 3 + id) * 0.09;
      if (v.refs.halo) v.refs.halo.rotation.z = t * 1.4;
      if (v.refs.wings) {
        v.refs.wings[0].rotation.y = 0.5 + Math.sin(t * 3 + id) * 0.22;
        v.refs.wings[1].rotation.y = -0.5 - Math.sin(t * 3 + id) * 0.22;
      }
      if (v.refs.flame && Math.random() < dt * 5) {
        this.burst(v.holder.position.x, 1.0, v.holder.position.z, 0xff8830, 1, 0.7, { grav: -1.4, ttl: 0.35, size: 0.45 });
      }
      let dy = v.targetFaceY - v.faceY;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      v.faceY += dy * Math.min(1, dt * 9);
      v.model.rotation.y = v.faceY;
      if (v.externalPilot) {
        v.externalPilot.root.rotation.y = v.faceY + v.externalPilot.yawOffset;
        if (pilotAttacking !== v.externalAttacking) {
          v.externalAttacking = pilotAttacking;
          v.externalPilot.play(pilotAttacking ? v.pilotSlot.attack : v.pilotSlot.idle, { once: pilotAttacking });
        }
        v.externalPilot.mixer.update(dt);
      }
      if (v.attackT > 0) {
        v.attackT = Math.max(0, v.attackT - dt * 3.4);
        const k = Math.sin((1 - v.attackT) * Math.PI);
        const C = D.CLASSES[v.cls];
        if (C.atk === 'melee') {
          v.refs.armPivot.rotation.x = -1.7 * k;
          if (v.cls === 'windblade') v.refs.armL.rotation.x = -1.7 * (1 - k) * (v.attackT > 0 ? 1 : 0);
        } else if (C.atk === 'arrow') {
          v.refs.armPivot.rotation.x = -1.1 * k;
          if (v.refs.bow) v.refs.bow.scale.x = 1 - 0.25 * k;
        } else {
          v.refs.armPivot.rotation.x = -2.1 * k;
        }
      } else {
        v.refs.armPivot.rotation.x *= 0.8;
        if (v.refs.armL.rotation) v.refs.armL.rotation.x *= 0.8;
      }
      if (v.legendGlow) {
        v.legendGlow.material.opacity = 0.35 + Math.sin(t * 4 + id) * 0.2;
        v.legendGlow.rotation.z = t * 1.2;
        if (Math.random() < dt * 2.2) {
          this.burst(v.holder.position.x, 0.4, v.holder.position.z, 0xffd93d, 1, 0.9, { grav: -0.8, ttl: 0.6, size: 0.5 });
        }
      }
      if (v.refs.staffOrb) {
        const os = 1 + Math.sin(t * 5 + id) * 0.18;
        v.refs.staffOrb.scale.setScalar(os);
      }
    }

    for (const [id, view] of this.blueprintViews) {
      const bob = Math.sin(t * 5 + id) * .08;
      view.sprite.position.y = .82 + bob;
      view.ring.rotation.z = t * 1.6;
      view.ring.material.opacity = .58 + Math.sin(t * 4 + id) * .16;
      if (view.attackT > 0) {
        view.attackT = Math.max(0, view.attackT - dt * 4);
        view.sprite.scale.setScalar(1.25 + Math.sin((1 - view.attackT) * Math.PI) * .24);
      } else {
        view.sprite.scale.set(1.25, 1.25, 1);
      }
    }

    for (const [id, view] of this.constellationAidViews) {
      view.ring.rotation.z = t * 1.8;
      view.ring.material.opacity = .56 + Math.sin(t * 4 + id) * .18;
      view.star.rotation.y = t * 3.2;
      view.star.position.y = 1.28 + Math.sin(t * 3.4 + id) * .09;
      if (view.refs.staffOrb) view.refs.staffOrb.scale.setScalar(1 + Math.sin(t * 5 + id) * .16);
      if (view.attackT > 0) {
        view.attackT = Math.max(0, view.attackT - dt * 3.8);
        const k = Math.sin((1 - view.attackT) * Math.PI);
        view.refs.armPivot.rotation.x = -1.9 * k;
        view.star.scale.setScalar(1 + k * .5);
      } else {
        view.refs.armPivot.rotation.x *= .8;
        view.star.scale.setScalar(1);
      }
    }

    for (const [id, v] of this.enemyViews) {
      const bossHop = v.boss ? 4.2 : (v.midBoss ? 5.5 : 7);
      const hop = Math.abs(Math.sin(t * bossHop + id)) * (v.boss || v.midBoss ? 0.2 : 0.14);
      v.spr.position.y = v.baseScale * 0.62 + hop;
      let faceDelta = v.targetFaceY - v.faceY;
      while (faceDelta > Math.PI) faceDelta -= Math.PI * 2;
      while (faceDelta < -Math.PI) faceDelta += Math.PI * 2;
      v.faceY += faceDelta * Math.min(1, dt * 10);
      if (v.externalPilot) {
        v.externalPilot.root.rotation.y = v.faceY + v.externalPilot.yawOffset;
        v.externalPilot.root.position.y = v.externalPilot.baseY + hop * 0.3;
        v.externalPilot.mixer.update(dt);
      }
      /* Rotate and pulse the local boss foot aura. */
      if (v.group.userData.aura) {
        const a = v.group.userData.aura;
        a.rotation.z = t * (v.boss ? 1.6 : 1.1);
        const s = 1 + Math.sin(t * 3 + id) * 0.12;
        a.scale.set(s, s, s);
        a.material.opacity = (v.enraged ? 0.6 : 0.4) + Math.sin(t * 5 + id) * 0.15;
        if (v.enraged) a.material.color.setHex(0xff2200);
      }
      if (v.enraged && Math.random() < dt * 9) {
        this.burst(v.group.position.x, 0.8, v.group.position.z, 0xff3311, 1, 1.4, { grav: -2, ttl: 0.5, size: 0.8 });
      }
      /* Stopped or champion-held enemies shiver locally with a blue aura. */
      if (v.stunned) {
        v.spr.position.x = Math.sin(t * 40 + id) * 0.05;
        if (Math.random() < dt * 5) {
          this.burst(v.group.position.x, 1.2, v.group.position.z, 0x9fd0ff, 1, 0.8, { grav: -1, ttl: 0.4, size: 0.6 });
        }
      } else if (v.held) {
        v.spr.position.x = Math.sin(t * 34 + id) * 0.04;
      } else {
        v.spr.position.x = 0;
      }
      if (v.externalPilot) v.externalPilot.root.position.x = v.spr.position.x;
      if (v.burning) {
        v.spr.material.color.setRGB(1, 0.72, 0.5);
        if (Math.random() < dt * 7) {
          this.burst(v.group.position.x, 0.7, v.group.position.z, 0xff8830, 1, 1.1, { grav: -2.2, ttl: 0.45, size: 0.6 });
        }
      } else if (v.stunned) {
        v.spr.material.color.setRGB(0.72, 0.86, 1);
      } else if (v.enraged) {
        v.spr.material.color.setRGB(1, 0.55, 0.5);
      } else if (v.slowed) {
        /* Slow feedback uses a deeper blue tint, frost ring and snow particles. */
        v.spr.material.color.setRGB(0.48, 0.74, 1);
        if (!v.frostRing) {
          const fr = new THREE.Mesh(
            new THREE.RingGeometry(v.baseScale * 0.34, v.baseScale * 0.5, 20),
            new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.8, depthWrite: false })
          );
          fr.rotation.x = -Math.PI / 2;
          fr.position.y = 0.07;
          v.group.add(fr);
          v.frostRing = fr;
        }
        v.frostRing.visible = true;
        v.frostRing.rotation.z = t * 1.4;
        v.frostRing.material.opacity = 0.55 + Math.sin(t * 6 + id) * 0.25;
        if (Math.random() < dt * 6) {
          this.burst(v.group.position.x, 0.5, v.group.position.z, 0x9fdcff, 1, 0.7, { grav: -1, ttl: 0.55, size: 0.6 });
        }
      } else {
        if (v.frostRing) v.frostRing.visible = false;
        v.spr.material.color.setRGB(1, 1, 1);
      }
    }

    for (const [, v] of this.projViews) {
      if (v.group.userData.pulse) {
        const s = 1 + Math.sin(t * 18) * 0.22;
        v.group.scale.set(s, s, s);
      }
    }

    if (state && this.castleHpRatio < 0.66 && Math.random() < dt * 5) {
      this.burst((Math.random() - 0.5) * 1.6, 3.4, -5.7, 0x8b8b95, 2, 0.8, { grav: -1.6, ttl: 1.1, size: 1.1 });
    }
    if (state && this.castleHpRatio < 0.33 && Math.random() < dt * 7) {
      this.burst((Math.random() - 0.5) * 2.4, 2.6, -5.5, 0xff7a30, 2, 1.4, { grav: -2.8, ttl: 0.7, size: 0.8 });
    }

    if (this.placementMode) {
      const op = 0.25 + Math.sin(t * 5) * 0.13;
      for (const hl of this.padHighlights) hl.material.opacity = op;
    }
    this.selRing.rotation.z = t * 1.5;

    const q = this.camera.quaternion;
    for (const [, v] of this.enemyViews) v.bar.quaternion.copy(q);

    this._champFrame(dt, t, state);
    this._updateParticles(dt);
    this._updateNumbers(dt);
    this._updateWaves(dt);
    this._updatePillars(dt);
    this._updateBubbles(dt);
    this._updateStars(dt);
    this._updateDaylight(dt, state);
    this.regions?.frame(t);

    if (this.decor) {
      this.grass.frame(dt, t, this.palette, 0);
      this.sea.frame(dt, t, this.palette, 0);
      this.fireflies.frame(dt, t, this.palette);
      this.sky.frame(dt, t, this.palette, this.moonPhase);
    }

    /* Combat feedback never shakes the camera or pulses global brightness. Effects preferences change only local impact particle density. */
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.camLook);
    if (this.cameraCutscene) {
      const cut = this.cameraCutscene;
      cut.t = Math.max(0, cut.t - dt);
      const progress = 1 - cut.t / cut.duration;
      const ramp = Math.min(1, progress / .16, (1 - progress) / .2);
      const eased = Math.max(0, ramp) ** 2 * (3 - 2 * Math.max(0, ramp));
      const amount = eased * (this.reducedEffects ? .28 : 1);
      const close = cut.target.clone().add(new THREE.Vector3(2.2, 3.8, 5.6));
      const look = this.camLook.clone().lerp(cut.target, amount);
      this.camera.position.lerp(close, amount);
      this.camera.lookAt(look);
      if (cut.t <= 0) this.cameraCutscene = null;
    }

    this.renderer.render(this.scene, this.camera);
  }

  /* Input handling. */
  _screenToLogical(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const pt = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, pt)) return null;
    return { x: pt.x / S + D.FIELD_W / 2, y: pt.z / S + D.FIELD_H / 2 };
  }

  screenToPad(clientX, clientY) {
    const p = this._screenToLogical(clientX, clientY);
    if (!p) return null;
    let best = null, bd = Infinity;
    for (let i = 0; i < D.PADS.length; i++) {
      const d = Math.hypot(D.PADS[i].x - p.x, D.PADS[i].y - p.y);
      if (d < bd) { bd = d; best = i; }
    }
    /* Increase hit tolerance on touch devices where pads are only around 20 pixels wide. */
    return bd <= D.PAD_RADIUS * this.padSlop ? best : null;
  }

  setHover(padIndex) {
    this.hoverPad = padIndex;
    if (padIndex == null) { this.hoverRing.visible = false; return; }
    const pad = D.PADS[padIndex];
    this.hoverRing.visible = true;
    this.hoverRing.position.set(wx(pad.x), 0.15, wz(pad.y));
  }

  setPlacementMode(on, rangePx = 0, swap = false) {
    this.placementMode = on;
    this.placeRange = rangePx;
    this.swapMode = !!swap;      // Occupied pads are valid swap targets.
  }
  setSelectedHero(id) { this.selectedHeroId = id; }

  dispose() {
    this.disposed = true;
    this.cosmetics.dispose();
    this.gatePilotRequest = null;
    this.ro.disconnect();
    for (const part of this.gatePilot?.parts || []) part.dispose();
    this.gatePilot?.group.removeFromParent();
    this.gatePilot = null;
    for (const view of this.heroViews.values()) this._disposePilotView(view);
    for (const view of this.enemyViews.values()) this._disposePilotView(view);
    for (const view of this.blueprintViews.values()) view.group.removeFromParent();
    this.blueprintViews.clear();
    for (const view of this.constellationAidViews.values()) view.group.removeFromParent();
    this.constellationAidViews.clear();
    if (this.decor) {
      this.grass.dispose();
      this.sea.dispose();
      this.fireflies.dispose();
      this.sky.dispose();
    }
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

/* Compose world construction and effects from separate mixins to keep the renderer organized by responsibility. */
Object.assign(Renderer3D.prototype, worldMethods, fxMethods);
