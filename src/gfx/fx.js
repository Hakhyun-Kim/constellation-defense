/* Renderer3D effect mixin: pooled particles, damage text, speech bubbles, falling stars, impact rings and light columns. Reuse geometry during runtime effects. */
import * as THREE from 'three';
import * as D from '../data.js';
import { wx, wz, glowTexture } from './common.js';

export const fxMethods = {
  /* Particles. */
  _buildParticles() {
    const MAX = 320;
    this.pMax = MAX;
    this.particles = [];
    const geo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.pMesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pMesh.frustumCulled = false;
    const m = new THREE.Matrix4();
    m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX; i++) {
      this.pMesh.setMatrixAt(i, m);
      this.pMesh.setColorAt(i, new THREE.Color(0xffffff));
      this.particles.push({ live: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), ttl: 0, life: 1, size: 1, grav: 6 });
    }
    this.pMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.pMesh);
  },

  burst(x3, y3, z3, color, n = 10, speed = 3, opts = {}) {
    if (this.reducedEffects) {
      n = Math.max(2, Math.ceil(n * .34));
      speed *= .78;
    }
    const col = new THREE.Color(color);
    let spawned = 0;
    for (let i = 0; i < this.pMax && spawned < n; i++) {
      const p = this.particles[i];
      if (p.live) continue;
      p.live = true;
      p.pos.set(x3, y3, z3);
      const a = Math.random() * Math.PI * 2;
      const up = opts.up != null ? opts.up : 1;
      p.vel.set(
        Math.cos(a) * speed * (0.3 + Math.random() * 0.7),
        (Math.random() * 0.9 + 0.4) * speed * up,
        Math.sin(a) * speed * (0.3 + Math.random() * 0.7)
      );
      p.life = p.ttl = opts.ttl || (0.4 + Math.random() * 0.35);
      p.size = opts.size || (0.7 + Math.random() * 0.7);
      p.grav = opts.grav != null ? opts.grav : 7;
      this.pMesh.setColorAt(i, col);
      spawned++;
    }
    this.pMesh.instanceColor.needsUpdate = true;
  },

  _updateParticles(dt) {
    const m = new THREE.Matrix4();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.pMax; i++) {
      const p = this.particles[i];
      if (!p.live) continue;
      p.ttl -= dt;
      if (p.ttl <= 0) {
        p.live = false;
        this.pMesh.setMatrixAt(i, zero);
        continue;
      }
      p.vel.y -= p.grav * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.05) { p.pos.y = 0.05; p.vel.y *= -0.35; }
      const s = p.size * (p.ttl / p.life) * 0.9;
      m.makeScale(s, s, s);
      m.setPosition(p.pos);
      this.pMesh.setMatrixAt(i, m);
    }
    this.pMesh.instanceMatrix.needsUpdate = true;
  },

  /* Damage numbers. */
  _buildDamageNumbers() {
    this.dmgPool = [];
    for (let i = 0; i < 22; i++) {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 96;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      spr.scale.set(2.3, 0.86, 1);
      spr.visible = false;
      spr.renderOrder = 50;
      this.scene.add(spr);
      this.dmgPool.push({ spr, tex, c, ttl: 0, life: 1, vy: 1.6 });
    }
  },

  showNumber(x3, y3, z3, text, color = '#ffffff', scale = 1) {
    let slot = this.dmgPool.find(s => s.ttl <= 0);
    if (!slot) slot = this.dmgPool[0];
    const g = slot.c.getContext('2d');
    g.clearRect(0, 0, 256, 96);
    g.font = `bold ${Math.round(52 * Math.min(scale, 1.35))}px Jua, "Segoe UI", "Segoe UI Emoji", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.strokeText(text, 128, 48);
    g.fillStyle = color;
    g.fillText(text, 128, 48);
    slot.tex.needsUpdate = true;
    slot.spr.position.set(x3, y3, z3);
    slot.spr.scale.set(2.3 * scale, 0.86 * scale, 1);
    slot.spr.visible = true;
    slot.ttl = slot.life = 0.85;
  },

  _updateNumbers(dt) {
    for (const s of this.dmgPool) {
      if (s.ttl <= 0) continue;
      s.ttl -= dt;
      s.spr.position.y += s.vy * dt;
      s.spr.material.opacity = Math.min(1, s.ttl / (s.life * 0.6));
      if (s.ttl <= 0) s.spr.visible = false;
    }
  },

  /* Champion speech bubbles. */
  _buildBubbles() {
    this.bubbles = [];
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 128;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      spr.scale.set(4.0, 1.0, 1);
      spr.center.set(0.5, 0);            // Anchor at the bottom so the bubble sits above the head.
      spr.visible = false;
      spr.renderOrder = 60;
      this.scene.add(spr);
      this.bubbles.push({ spr, tex, c, ttl: 0, life: 1 });
    }
  },

  /* Use logical coordinates and rotate slots to avoid overlap. White text on a dark bubble remains readable across daylight and background changes. */
  showBubble(lx, ly, text, ttl = 2.4) {
    if (!this.bubbles) this._buildBubbles();
    const slot = this.bubbles.find(b => b.ttl <= 0) || this.bubbles[0];
    const g = slot.c.getContext('2d');
    g.clearRect(0, 0, 512, 128);
    g.font = '700 42px Jua, "Segoe UI", "Segoe UI Emoji", sans-serif';
    const w = Math.min(494, g.measureText(text).width + 52);
    const x0 = (512 - w) / 2;
    /* Rounded speech box with a tail. */
    const r = 22, y0 = 6, h = 84;
    g.beginPath();
    g.moveTo(x0 + r, y0);
    g.arcTo(x0 + w, y0, x0 + w, y0 + h, r);
    g.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
    g.arcTo(x0, y0 + h, x0, y0, r);
    g.arcTo(x0, y0, x0 + w, y0, r);
    g.closePath();
    g.fillStyle = 'rgba(24, 29, 47, 0.92)';
    g.strokeStyle = 'rgba(255, 226, 122, 0.95)';
    g.lineWidth = 5;
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(240, y0 + h + 1);
    g.lineTo(272, y0 + h + 1);
    g.lineTo(256, y0 + h + 27);
    g.closePath();
    g.fillStyle = 'rgba(24, 29, 47, 0.92)';
    g.fill();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, y0 + h / 2 + 2, w - 36);
    slot.tex.needsUpdate = true;
    slot.spr.position.set(wx(lx), 2.05, wz(ly));
    slot.ttl = slot.life = ttl;
    slot.spr.material.opacity = 1;
    slot.spr.visible = true;
  },

  _updateBubbles(dt) {
    if (!this.bubbles) return;
    for (const b of this.bubbles) {
      if (b.ttl <= 0) continue;
      b.ttl -= dt;
      b.spr.material.opacity = Math.min(1, b.ttl / 0.35);
      if (b.ttl <= 0) b.spr.visible = false;
    }
  },

  /* Falling stars. */
  _starfall(x3, z3, delay = 0, impact = null) {
    if (!this.stars) this.stars = [];
    let s = this.stars.find(v => !v.live);
    if (!s) {
      if (this.stars.length >= 48) s = this.stars[0];   // Bound the pool for repeated Galaxy casts.
      else {
        const mesh = new THREE.Group();
        const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshBasicMaterial({ color: 0xfff3b0 }));
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd97a, transparent: true, depthWrite: false }));
        halo.scale.set(1.7, 1.7, 1);
        mesh.add(core, halo);
        mesh.visible = false;
        this.scene.add(mesh);
        s = { mesh, live: false, t: 0, dur: 0.36, from: new THREE.Vector3(), to: new THREE.Vector3(), impact: null };
        this.stars.push(s);
      }
    }
    s.live = true;
    s.t = -delay;
    /* Tactic meteors reward a resolved board move; shorten flight and impact by about 30% to preserve input rhythm. */
    s.dur = 0.23 + Math.random() * 0.07;
    s.from.set(x3 + 2.6, 10.5, z3 + 1.8);
    s.to.set(x3, 0.25, z3);
    s.impact = impact;
    s.mesh.visible = false;
  },

  /* Display Flare damage numbers on visual impact rather than board resolution so match, flight and hit read as one sequence. */
  _tacticFlareImpact(x3, z3, impact) {
    const bonus = impact.stars >= 6 ? 3 : impact.stars === 5 ? 2 : impact.stars === 4 ? 1 : 0;
    this._shockRing(x3, z3, 1.55 + bonus * 0.32, 0xffa253, 0.42 + bonus * 0.05);
    this.burst(x3, 0.85, z3, 0xffad5c, 18 + bonus * 9, 4.8 + bonus, { grav: 3.2, ttl: 0.42 });
    this.burst(x3, 1.04, z3, 0xffffff, 9 + bonus * 4, 3.1, { grav: 1.6, ttl: 0.3, size: 0.75 });
    this.showNumber(x3, 2.08, z3, `☄ -${impact.dmg}`, '#ffe5a4', 1.2 + bonus * 0.15);
    if (impact.lethal) this.showNumber(x3, 2.82, z3, '격파!', '#fff0b3', 0.86 + bonus * 0.08);
    this.addShake(0.06 + bonus * 0.025);
  },

  _updateStars(dt) {
    if (!this.stars) return;
    for (const s of this.stars) {
      if (!s.live) continue;
      s.t += dt;
      if (s.t < 0) continue;
      const k = Math.min(1, s.t / s.dur);
      const ke = k * k;                        // Accelerating descent.
      s.mesh.visible = true;
      s.mesh.position.lerpVectors(s.from, s.to, ke);
      s.mesh.rotation.y += dt * 14;
      if (!this.reducedEffects && Math.random() < dt * 30) {
        this.burst(s.mesh.position.x, s.mesh.position.y, s.mesh.position.z, 0xffe9a0, 1, 0.4, { grav: 0.5, ttl: 0.3, size: 0.5 });
      }
      if (k >= 1) {
        s.live = false;
        s.mesh.visible = false;
        this._shockRing(s.to.x, s.to.z, 1.9, 0xffd97a, 0.38);
        this._shockRing(s.to.x, s.to.z, 1.1, 0xfff3b0, 0.3);
        this.burst(s.to.x, 0.7, s.to.z, 0xffd97a, 16, 4.8, { grav: 4, ttl: 0.38 });
        this.burst(s.to.x, 0.9, s.to.z, 0xffffff, 8, 3, { ttl: 0.34 });
        if (s.impact?.tactic === 'flare') this._tacticFlareImpact(s.to.x, s.to.z, s.impact);
        s.impact = null;
        this.addShake(0.15);
      }
    }
  },

  /* Pooled expanding impact ring shared by shields and area blasts. */
  _shockRing(x3, z3, radius, color = 0x9fd0ff, life = 0.5, y = 0.18) {
    if (!this.waves) {
      this.waves = [];
      for (let i = 0; i < 10; i++) {
        const m = new THREE.Mesh(
          new THREE.RingGeometry(0.84, 1, 40),
          new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0, depthWrite: false })
        );
        m.rotation.x = -Math.PI / 2;
        m.visible = false;
        this.scene.add(m);
        this.waves.push({ mesh: m, ttl: 0, life: 0.5, radius: 1 });
      }
    }
    const slot = this.waves.find(w => w.ttl <= 0) || this.waves[0];
    slot.mesh.position.set(x3, y, z3);
    slot.mesh.material.color.setHex(color);
    slot.radius = radius;
    slot.ttl = slot.life = life;
    slot.mesh.visible = true;
  },
  _blockWave(x3, z3, radius) { this._shockRing(x3, z3, radius, 0x9fd0ff, 0.5); },

  _updateWaves(dt) {
    if (!this.waves) return;
    for (const w of this.waves) {
      if (w.ttl <= 0) continue;
      w.ttl -= dt;
      const k = 1 - w.ttl / w.life;
      w.mesh.scale.setScalar(w.radius * (0.25 + k * 0.85));
      w.mesh.material.opacity = 0.85 * (1 - k);
      if (w.ttl <= 0) w.mesh.visible = false;
    }
  },

  /* Summon presentation in the castle plaza scales with tier. */
  summonBurst(tier) {
    const x = 0, z = 2.6;
    const col = new THREE.Color(D.TIERS[tier].color).getHex();
    const n = [10, 18, 34, 60][tier];
    const spd = [2.4, 3.2, 4.4, 6][tier];
    this.burst(x, 0.8, z, col, n, spd, { grav: 4 });
    this._shockRing(x, z, 1.2 + tier * 0.5, col, 0.55);
    if (tier >= 2) {
      /* Light column. */
      this._lightPillar(x, z, tier);
      this.burst(x, 1.6, z, 0xffffff, 16, 3, { grav: 1.5, ttl: 0.6 });
      this.addShake(tier === 3 ? 0.32 : 0.16);
    }
    if (tier === 3) {
      this._shockRing(x, z, 3.2, 0xffd93d, 0.8);
      for (let k = 0; k < 3; k++) {
        setTimeout(() => this.burst(x + (Math.random() - 0.5) * 2, 1 + Math.random() * 2, z + (Math.random() - 0.5) * 2,
          0xffd93d, 14, 4, { grav: 3 }), k * 130);
      }
    }
  },

  /* Heroic-or-higher combination presentation uses the result pad, or the plaza if benched. */
  combineFlourish(padIndex, tier) {
    const x = padIndex >= 0 ? wx(D.PADS[padIndex].x) : 0;
    const z = padIndex >= 0 ? wz(D.PADS[padIndex].y) : 2.6;
    const col = new THREE.Color(D.TIERS[tier].color).getHex();
    this._lightPillar(x, z, tier);
    this._shockRing(x, z, 1.6 + tier * 0.6, col, 0.6);
    this._shockRing(x, z, 2.6 + tier * 0.6, 0xffffff, 0.8);
    this.burst(x, 1.0, z, col, 26 + tier * 12, 4 + tier, { grav: 3 });
    this.burst(x, 1.8, z, 0xffffff, 14, 2.6, { grav: 1 });
    this.addShake(tier === 3 ? 0.4 : 0.22);
  },

  /* Group tactic result coordinates visually to clarify the spell without changing combat rules. */
  tacticCast(state, result, kind, route, size = 3) {
    const events = result?.events || [];
    const mark = events.find(ev => ev.type === 'starfall' || ev.type === 'enemyHit'
      || ev.type === 'castleHeal' || ev.type === 'tacticPush');
    const logical = mark ? { x: mark.x, y: mark.y } : D.routePoint(route, D.ROUTE_LENS[route] * 0.52);
    const x = wx(logical.x), z = wz(logical.y);
    const jackpot = size >= 6 ? 3 : size === 5 ? 2 : size === 4 ? 1 : 0;

    if (kind === 'flare') {
      this._shockRing(x, z, 1.35 + jackpot * 0.55, 0xff9a62, 0.34 + jackpot * 0.08);
      this.burst(x, 1.1, z, 0xffa05d, 16 + jackpot * 14, 4.6 + jackpot, { grav: 2.1, ttl: 0.38 });
      if (jackpot) this._lightPillar(x, z, jackpot + 1);
      this.showNumber(x, 2.55, z, size === 6 ? '✦ 영웅 문양!' : size === 5 ? '☄ 별똥별!' : size === 4 ? '☄ 노바!' : '☄ 유성!', '#ffe1a5', 1 + jackpot * 0.18);
      this.addShake(0.12 + jackpot * 0.12);
    } else if (kind === 'tide') {
      const targets = (state?.enemies || []).filter(e => !e.dead && e.route === route).slice(0, 6);
      for (const e of targets) {
        const tx = wx(e.x), tz = wz(e.y);
        this._shockRing(tx, tz, 0.72 + jackpot * 0.12, 0x8de8ff, 0.4 + jackpot * 0.06);
        this.burst(tx, 0.72, tz, 0xc8f9ff, 5 + jackpot * 3, 2.2, { grav: -0.8, ttl: 0.4, size: 0.65 });
      }
      this._shockRing(x, z, 1.6 + jackpot * 0.45, 0x65cfff, 0.42 + jackpot * 0.08);
      this.showNumber(x, 2.45, z, size === 6 ? '✦ 영웅 문양!' : size === 5 ? '❄ 빙결 폭풍!' : size === 4 ? '❄ 서리 폭발!' : '❄ 서리 결계!', '#dcfbff', 1 + jackpot * 0.16);
    } else if (kind === 'bloom') {
      const cx = wx(D.CASTLE_POS.x), cz = wz(D.CASTLE_POS.y);
      this._shockRing(cx, cz, 2.2 + jackpot * 0.45, 0x88ed97, 0.48 + jackpot * 0.08, 0.32);
      this.burst(cx, 1.55, cz, 0x9cff9d, 15 + jackpot * 12, 2.7, { grav: -1.1, ttl: 0.5 });
      this._shockRing(x, z, 1.25 + jackpot * 0.35, 0xbaffad, 0.38);
      this.showNumber(cx, 3.1, cz, size === 6 ? '✦ 영웅 문양!' : size === 5 ? '🛡 별의 수호!' : size === 4 ? '🛡 수호 폭발!' : '🛡 수호 성좌!', '#c9ffb6', 1 + jackpot * 0.16);
    }
  },

  /* Rising light column with automatic cleanup. */
  _lightPillar(x, z, tier) {
    const col = new THREE.Color(D.TIERS[tier].color);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5 + tier * 0.12, 0.7 + tier * 0.15, 6, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
    );
    mesh.position.set(x, 3, z);
    this.scene.add(mesh);
    if (!this.pillars) this.pillars = [];
    this.pillars.push({ mesh, ttl: 0.7, life: 0.7 });
  },
  _updatePillars(dt) {
    if (!this.pillars) return;
    for (let i = this.pillars.length - 1; i >= 0; i--) {
      const p = this.pillars[i];
      p.ttl -= dt;
      const k = 1 - p.ttl / p.life;
      p.mesh.material.opacity = 0.55 * (1 - k);
      p.mesh.scale.set(1 + k * 0.8, 1 + k * 0.4, 1 + k * 0.8);
      p.mesh.rotation.y += dt * 3;
      if (p.ttl <= 0) { this.scene.remove(p.mesh); this.pillars.splice(i, 1); }
    }
  },

  /* Celebration fireworks use the center when a benched result has no world position. */
  celebrate(color = 0xffd93d, big = false) {
    this.burst(0, 2.2, 2, color, big ? 40 : 20, big ? 5 : 3.4, { grav: 3 });
  },

  addShake(_v) {
    /* Battlefield-wide movement is prohibited. Keep callers for event intensity but render only local impact particles and rings. */
  },

  /* Local castle-upgrade feedback along the walls. */
  castleUpgradeFx(kind) {
    const color = kind === 'tower' ? 0x7ff3ff : 0xffd76e;
    this._shockRing(0, -4.35, 7.5, color, 0.7, 0.22);
    for (let i = 0; i < 5; i++) {
      this.burst(-5 + i * 2.5, 1.4, -4.35, color, 8, 2.4);
    }
    this.addShake(0.22);
  },
};
