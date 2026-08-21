/* =====================================================
 * 3D 렌더러 본체 (Three.js)
 * 성이 위(멀리), 몬스터는 아래(카메라 쪽)에서 위로 — 세 갈래 길.
 * 지형·성 짓기는 world.js, 이펙트는 fx.js가 믹스인으로 붙는다.
 * 현재 지형·성·캐릭터·이펙트는 코드 생성이며, 외부 에셋은 별도 로더로 보강한다.
 * ===================================================== */
import * as THREE from 'three';
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
    /* 외부 아트는 엔진 상태와 분리된 선택적 뷰 의존성이다. null 또는 실패면
     * 아래 절차형 생성 경로가 언제나 정상 동작한다. */
    this.assets = opts.assets || null;
    /* 배경 장식(바람 잔디 · 바닷가 · 하늘 밴드 · 반딧불이)을 통째로 끄는 스위치.
     * 모바일은 이걸 끈다 — 화소당 셰이더 비용이 제일 비싼 것들이기도 하고,
     * 작은 화면에서는 하늘에 내줬던 19%를 전장에 돌려주는 게 훨씬 이득이다.
     * 시간대 조명(해 각도·안개·색)은 공짜라서 끄지 않는다. */
    this.decor = opts.decor !== false;
    /* 발판 클릭 허용 반경(PAD_RADIUS 배수). 터치는 넉넉하게. */
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
    /* 톤매핑 + 실시간 그림자 — 값싼 "AAA 느낌"의 8할 */
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
    /* 바다가 생기면서 시야가 훨씬 깊어졌다. 예전 far=44 는 수평선을 통째로
     * 하얗게 지워 버린다 — 전장(거리 ~35)은 그대로 두고 far 만 밀어낸다.
     * 바다가 없는 모드에서는 볼 게 잔디밭뿐이라 예전 값이 오히려 깊이가 산다. */
    if (this.decor) { this.fogNear = 30; this.fogFar = 78; }
    else { this.fogNear = 24; this.fogFar = 44; }
    this.scene.fog = new THREE.Fog(0xcfe9ff, this.fogNear, this.fogFar);
    this.scene.background = new THREE.Color(0xcfe9ff);
    /* 시간대(실제 시각) → 조명·안개·물빛. 전투 이벤트는 이 전역 팔레트를 바꾸지 않는다. */
    this.palette = makePalette();
    /* ?hour=18.5 로 시간대를 강제할 수 있다 (확인용 · 다른 시간대 구경용) */
    const hp = new URLSearchParams(location.search).get('hour');
    this.forcedHour = hp != null && hp !== '' && Number.isFinite(Number(hp)) ? Number(hp) : null;
    /* 첫 프레임부터 맞는 시간대로 시작한다 — 아침에 켰는데 밤이 한 번 스치면 어색하다 */
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

    /* 화면 위쪽을 하늘에 내준다. 그만큼 게임이 차지할 자리가 줄어드니
     * 시야각을 넓혀(내용이 작아진다) + 시선을 살짝 올려(내용이 내려간다)
     * 성 깃대부터 스폰 포탈까지가 밴드 아래에 들어오게 맞췄다.
     * 공짜는 없다 — 하늘을 얻는 대신 전장이 조금 작아진다.
     *
     * 장식을 끄면 그 19%를 도로 전장에 준다: 시야각을 좁히고 시선을 내려
     * 발판이 화면에서 커진다. 손가락으로 누르는 화면에서는 이게 곧 조작성이다. */
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
    this._buildParticles();
    this._buildDamageNumbers();
    this.regions = new RegionScenery(this.scene);
    this.setRegionTheme('verdant-dawn');

    /* 자연 배경 — 잔디 물결 · 성 뒤편 바다 · 밤 반딧불이 · 하늘 밴드.
     * 장식을 끄면 아예 만들지 않는다(감추는 게 아니라). 지오메트리도 셰이더
     * 컴파일도 없으니 첫 화면이 뜨는 시간까지 같이 짧아진다. */
    this.moonPhase = 0.15;
    if (this.decor) {
      this.grass = new WindGrass(this.scene, this.quality, wx, wz);
      this.sea = new Sea(this.scene, this.quality);
      this.fireflies = new Fireflies(this.scene, this.quality);
      /* 하늘 밴드 — 카메라 자식이라 카메라가 씬에 들어가 있어야 그려진다 */
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
    if (this.sky) this.sky.layout();     // 절두체가 바뀌면 밴드 크기도 다시 잡는다
  }

  /* ---------- 뷰 생성 ---------- */
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

      /* 중앙 문틀은 비율을 지키고, 양옆 모듈만 가로로 늘린다. 카메라에서 먼
       * 랜드마크라 실루엣은 선명해지고 인스턴스/드로우콜 수는 제한된다. */
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
    /* 특수 직업: 은은한 보라 보조 링 */
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

  /* ---------- 별지기 뷰 ---------- */
  /* 옷장에서 갈아입으면 뷰를 새로 짓는다 — 위치·방향은 이어받아 그 자리에서 변신한다 */
  setChampLook(look) {
    this.champLook = D.champLookOf(look);
    if (this.champView) {
      const old = this.champView;
      this.scene.remove(old.holder);
      this._champCarry = { pos: { ...old.pos }, dest: { ...old.dest }, faceY: old.faceY };
      this.champView = null;               // 다음 sync가 새 모습으로 되살린다
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

    /* 오각 링 — 별지기의 발밑에는 별이 그려져 있다 (별빛 색을 따른다) */
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

    /* 옷을 갈아입은 직후라면 서 있던 자리를 이어받는다 */
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

  /* 준비 단계의 배회 — 순수 연출. 엔진은 준비 중 별지기를 움직이지 않으므로
   * 어디를 걷고 누구와 수다를 떠는지는 전부 렌더러의 몫이다. */
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
      /* 도착해 서 있는 동안 — 곁에 용사가 있으면 말을 걸고, 없으면 혼잣말 */
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
    /* 새 목적지: 용사 곁 또는 길가의 아무 곳 */
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

    /* 목적지: 전투는 엔진이, 준비는 배회가 정한다 */
    if (wave || state.phase === 'over' || v.ko) {
      v.dest.x = c.x; v.dest.y = c.y;
      v.chatSeq = null;
    } else {
      this._champWander(dt, state, v);
    }

    /* 이동 — 목적지가 멀면 전력 질주로 따라잡는다 (웨이브 시작 때 광장으로 달려간다) */
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

    /* 얼굴 방향 (논리 y = 월드 z 방향과 부호가 같다) */
    let dyaw = v.targetFaceY - v.faceY;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    v.faceY += dyaw * Math.min(1, dt * 10);
    v.model.rotation.y = v.faceY;

    /* KO — 쓰러져 눕고, 별이 어깨에 내려앉는다 */
    v.koT += ((v.ko ? 1 : 0) - v.koT) * Math.min(1, dt * 4);
    v.model.rotation.x = -1.35 * v.koT;
    v.model.position.y = 0.14 * v.koT;
    v.ring.material.opacity = 0.8 * (1 - v.koT * 0.7);
    if (v.ko && Math.random() < dt * 1.4) {
      this.burst(v.holder.position.x, 0.5, v.holder.position.z, 0xaab4d4, 1, 0.5, { grav: -0.6, ttl: 0.9, size: 0.5 });
    }

    /* 걷기 — 다리 스윙 + 반대 위상 팔 스윙 */
    v.walkPhase += dt * (moving ? 11 : 0);
    const swing = moving ? Math.sin(v.walkPhase) * 0.55 : 0;
    const k14 = Math.min(1, dt * 14);
    v.refs.legs[0].rotation.x += (swing - v.refs.legs[0].rotation.x) * k14;
    v.refs.legs[1].rotation.x += (-swing - v.refs.legs[1].rotation.x) * k14;
    if (v.attackT <= 0) v.refs.armL.rotation.x += (swing * -0.5 - v.refs.armL.rotation.x) * k14;

    /* 숨쉬기 · 망토 · 동반 별 */
    v.refs.body.scale.y = 1 + Math.sin(t * 2.8) * 0.025;
    v.refs.cape.rotation.x = 0.16 + Math.sin(t * 3.2) * 0.1 + (moving ? 0.28 : 0);
    const sa = t * 2.2;
    v.refs.star.position.set(Math.cos(sa) * 0.45, (v.ko ? 0.5 : 1.2) + Math.sin(t * 3.1) * 0.08, Math.sin(sa) * 0.45);
    v.refs.star.rotation.y = t * 3;
    v.refs.emblem.rotation.y = t * 2;
    if (v.refs.staffOrb) v.refs.staffOrb.scale.setScalar(1 + Math.sin(t * 5) * 0.15);

    /* 공격 스윙 */
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

  /* ---------- 시간대: 지금 몇 시인가 ----------
   * 예전에는 웨이브가 지날수록 저물었는데, 13웨이브를 넘기면 계속 밤이었다.
   * 오래 버틸수록 화면이 어두워지기만 하니 잘하는 사람이 벌을 받는 꼴이었다.
   * 이제 **실제 시각**이 정한다 — 낮에 켜면 낮, 밤에 켜면 밤. 달도 진짜 위상을 따른다.
   * (?hour=18.5 로 강제할 수 있다 — 확인용이자 "다른 시간대를 보고 싶을 때"용)
   *
   * 전투 이벤트나 보스 등장으로 이 팔레트를 덮어쓰지 않는다. */
  _updateDaylight(dt, state) {
    /* 시계는 1초에 한 번만 본다 — 매 프레임 Date를 만들 이유가 없다 */
    this._clockT = (this._clockT || 0) - dt;
    if (this._clockT <= 0) {
      this._clockT = 1;
      this.dayTarget = this.forcedHour == null ? this.region.phase : clockPhase(this.forcedHour);
      this.moonPhase = Math.max(0.12, moonPhaseNow());
    }
    /* 웨이브가 넘어갈 때 뚝 끊기지 않게 천천히 따라간다 */
    this.dayPhase += (this.dayTarget - this.dayPhase) * Math.min(1, dt * 0.5);
    const p = daylightPalette(this.dayPhase, this.palette);

    this.baseFog.copy(p.fog);
    this.baseClear.copy(p.sky);
    this.sun.color.copy(p.sun);
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGnd);
    /* 그림자 카메라 범위가 고정이라 거리는 유지하고 방향만 돌린다 */
    this.sun.position.copy(p.sunPos).setLength(17);
    this.baseSunI = p.sunI;
    this.baseHemiI = p.hemiI;
    this.scene.fog.color.copy(this.baseFog);
    this.scene.background.copy(this.baseClear);
    this.renderer.setClearColor(this.baseClear);
    this.scene.fog.far = this.fogFar;
    this.hemi.intensity = this.baseHemiI;
    this.sun.intensity = this.baseSunI;
    /* 밤에는 땅도 같이 가라앉아야 한다 — 조명만으로는 잔디가 형광으로 뜬다 */
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

    /* 엘리트 — 금빛 테두리 하나로 "이건 특별하다"를 즉시 알린다.
     * 등급을 여러 단계로 나누는 대신 보통/특별 두 가지만 두기로 한 결정의 시각적 절반이다. */
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
      /* 살짝 붉게 물들여 같은 이모지라도 달라 보이게 */
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
      /* 발밑에서 피어오르는 기운 */
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

  /* ---------- 상태 동기화 ---------- */
  sync(state) {
    const fieldIds = new Set();
    for (const h of state.field) {
      fieldIds.add(h.id);
      let v = this.heroViews.get(h.id);
      if (!v) {
        v = this._makeHeroView(h);
        /* 처음엔 가장 가까운 길을 바라본다 */
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

    /* 별지기 — 성장/체력 상태를 뷰에 비춘다 (위치는 _champFrame이 다룬다) */
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

    /* 강화 단계마다 실루엣이 실제로 바뀐다 — 띠만 늘어나면 자란 게 안 보인다 */
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
    /* 깃발 색이 총 강화도를 말해 준다 — 멀리서도 보이는 가장 싼 신호 */
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
      /* 교환 모드(배치된 용사를 고른 상태)에서는 남의 자리도 후보다.
       * 빈 발판은 초록(이동), 다른 용사 자리는 파랑(교환)으로 구분해 준다. */
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
      if (p.splash > 0) {   /* 정령궁수: 빛나는 화살 */
        const glowTip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color: 0xd8b4ff }));
        glowTip.position.x = 0.36;
        g.add(glowTip);
      }
    } else if (p.kind === 'orb') {
      const color = p.splashSlow ? 0x9fdcff : 0xd08bff;   /* 빙결사는 얼음색 */
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

  /* ---------- 이벤트 → 시각 효과 ---------- */
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
            /* Flare는 starfall의 착탄 프레임에서 피해 숫자·충격파를 낸다. */
          } else if (ev.kind === 'burn') {
            if (Math.random() < 0.4) this.showNumber(x3, 1.7, z3, `${ev.dmg}`, '#ff9a3d', 0.72);
          } else if (ev.kind === 'slow') {
            /* 0 피해 숫자는 "아무 일도 없었다"로 읽힌다. 서리 전술의 결과를 말로도 고정한다. */
            this.showNumber(x3, 2.0, z3, '❄ 감속!', '#b9f5ff', 0.82);
            this.burst(x3, 0.9, z3, 0x9fdcff, 5, 1.8, { grav: -0.8, ttl: 0.45, size: 0.65 });
          } else if (ev.kind === 'crit') {
            /* 치명타는 크고 노랗게 — 근접의 쾌감 */
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
          /* 방패 장벽: 바닥에 퍼지는 충격파 + 정지 표시 */
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
          /* 배율이 "올라가는 순간"에만 알린다 — 처치마다 띄우면 글자가 겹쳐 쌓인다 */
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
          /* 폭발 반경을 링으로 그려 "어디까지 맞았는지" 확실히 보인다 */
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
          /* 포탈이 붉게 요동친다 */
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

        /* ---------- 별지기 ---------- */
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
          /* 매 틱 1씩 깎일 수 있어 다 그리면 숫자가 도배된다 — 가끔만 */
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
          /* 승급한 용사의 모델을 새 등급으로 다시 짓는다 (망토 색·왕관이 바뀐다) */
          const hv = this.heroViews.get(ev.heroId);
          if (hv) {
            this._disposePilotView(hv);
            this.scene.remove(hv.holder);
            this.heroViews.delete(ev.heroId);
          }
          /* 잔치 — 승급한 용사 자리(벤치면 광장)에서 색색 폭죽 + 빛기둥 */
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
            /* 별지기도 잔치 자리로 달려간다 (준비 단계 배회 목적지 변경) */
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

  /* ---------- 프레임 ---------- */
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
      /* 보스 발밑 기운이 회전·맥동 */
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
      /* 정지된 적: 제자리에서 부르르 떨고 파란 기운. 별지기에게 붙잡힌 적도 떤다 */
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
        /* 감속: 더 진한 청색 + 발밑 서리 고리 + 눈발 */
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

    /* 접근성 계약: 전투 피드백이 카메라 전체를 흔들거나 밝기를 펄스시키지 않는다.
     * 생동감 설정은 착탄 지점의 국소 파티클 밀도만 바꾼다. */
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

  /* ---------- 입력 ---------- */
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
    /* 손가락은 마우스보다 훨씬 뭉툭하다. 폰에서는 발판이 화면상 20px 남짓이라
     * 1.5배 반경으로는 자꾸 빗나간다 — 터치 기기에서만 넉넉하게 잡는다. */
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
    this.swapMode = !!swap;      // 배치된 용사 자리도 후보(= 자리 교환 가능)
  }
  setSelectedHero(id) { this.selectedHeroId = id; }

  dispose() {
    this.disposed = true;
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

/* 지형·성 짓기(world)와 이펙트(fx)는 별 파일의 믹스인으로 조립한다 —
 * 한 파일 2,500줄짜리 클래스를 기능별로 쪼개기 위한 장치다. */
Object.assign(Renderer3D.prototype, worldMethods, fxMethods);
