/* Procedural scenery: time of day, wind grass, sea and fireflies. Keep visual background systems separate from engine and bots. Favor features readable from the downward camera, including grass motion, water and shoreline foam. */
import * as THREE from 'three';
import * as D from '../data.js';

/* World-space z where ground ends and sand begins, behind the castle wall near z=-6.9. */
/* Bring the shoreline near the castle so grass, sand and sea fit in the limited space above it. */
export const SHORE_Z = -9.6;

/* The waterline begins here. Extend the plane toward SHORE_Z and shape its edge with shader alpha instead of exposing a straight polygon boundary. */
const WATER_LINE = -13.2;

/* Time-of-day palette progressing from morning through noon, golden hour, sunset and night. clockPhase now derives it from real time, independently of combat. */
/* Use zenith color at the sky band's top and fog color at its bottom. Sea and sky converge to hide the seam in this downward camera framing. */
const KEYS = [
  /* Fog also defines the horizon color. Avoid near-white values that wash out the entire daytime sea. */
  { /* Morning. */ p: 0.00, fog: 0xa8d2f0, sky: 0xbfe3ff, zenith: 0x2f7fce, sun: 0xfff2d8, sunI: 1.90,
    hemiSky: 0xeaf6ff, hemiGnd: 0x5d8742, hemiI: 1.25, sunPos: [8, 14, 6],
    deep: 0x1e5c86, shallow: 0x4fb3c9, night: 0, cloud: 0.55 },
  { /* Noon. */ p: 0.28, fog: 0xb2dcf8, sky: 0xcfeaff, zenith: 0x1f6ec4, sun: 0xfffaf0, sunI: 2.05,
    hemiSky: 0xf2faff, hemiGnd: 0x6a9a4a, hemiI: 1.35, sunPos: [4, 18, 3],
    deep: 0x14618f, shallow: 0x53c6da, night: 0, cloud: 0.40 },
  { /* Golden hour. */ p: 0.56, fog: 0xf5c194, sky: 0xffc98f, zenith: 0xe08a5a, sun: 0xffb066, sunI: 1.85,
    hemiSky: 0xffe3c0, hemiGnd: 0x6b7a3a, hemiI: 1.05, sunPos: [13, 6, 7],
    deep: 0x2a4f7a, shallow: 0xd79a63, night: 0.1, cloud: 0.70 },
  { /* Sunset. */ p: 0.80, fog: 0xb980a8, sky: 0x8a5f8f, zenith: 0x4a3a78, sun: 0xff7a55, sunI: 1.15,
    hemiSky: 0xc99ec0, hemiGnd: 0x47506a, hemiI: 0.80, sunPos: [15, 2.6, 6],
    deep: 0x27304f, shallow: 0x8e6a94, night: 0.45, cloud: 0.60 },
  /* Keep night moonlit and readable so enemies and placement pads remain visible. */
  { /* Night. */ p: 1.00, fog: 0x223060, sky: 0x16224a, zenith: 0x070c22, sun: 0xb2cdff, sunI: 1.02,
    hemiSky: 0x3b4f88, hemiGnd: 0x243050, hemiI: 0.96, sunPos: [-9, 13, 4],
    deep: 0x0d1838, shallow: 0x244577, night: 1, cloud: 0.25 },
];

const _cA = new THREE.Color(), _cB = new THREE.Color();
function mixHex(a, b, t, out) {
  _cA.setHex(a); _cB.setHex(b);
  return out.copy(_cA).lerp(_cB, t);
}

/* Map real time onto the palette instead of keeping successful long runs permanently at night. Traverse night, dawn, morning, noon, golden hour, sunset and night; dawn reverses the sunset palette. */
const CLOCK = [
  { h: 0,    p: 1.00 },   // Midnight.
  { h: 4.5,  p: 1.00 },
  { h: 6.0,  p: 0.80 },   // Dawn.
  { h: 7.5,  p: 0.30 },
  { h: 9.0,  p: 0.05 },   // Morning.
  { h: 12.0, p: 0.28 },   // Noon.
  { h: 15.0, p: 0.30 },
  { h: 17.0, p: 0.56 },   // Golden hour.
  { h: 18.5, p: 0.80 },   // Sunset.
  { h: 20.0, p: 1.00 },   // Night.
  { h: 24.0, p: 1.00 },
];
/* hour accepts a fractional value from 0 to 24; omit it to use the current time. */
export function clockPhase(hour) {
  let h = hour;
  if (h == null) { const d = new Date(); h = d.getHours() + d.getMinutes() / 60; }
  h = ((h % 24) + 24) % 24;
  let i = 0;
  while (i < CLOCK.length - 2 && h > CLOCK[i + 1].h) i++;
  const a = CLOCK[i], b = CLOCK[i + 1];
  const t = (h - a.h) / (b.h - a.h);
  return a.p + (b.p - a.p) * Math.max(0, Math.min(1, t));
}

/* Approximate lunar phase from the 29.53-day synodic month and the new moon at 2000-01-06 18:14 UTC, sufficient for visual presentation. */
const SYNODIC = 29.530588853;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
export function moonPhaseNow(now) {
  const days = (now == null ? Date.now() : now) / 86400000;
  const age = (((days - NEW_MOON) % SYNODIC) + SYNODIC) % SYNODIC;   // 0~29.53
  /* Phase 0 and 1 are new moon; 0.5 is full moon. Brightness follows a 0–1–0 triangle wave. */
  const frac = age / SYNODIC;
  return 1 - Math.abs(frac - 0.5) * 2;
}

/* Write the interpolated palette into out to avoid per-frame allocations. */
export function daylightPalette(phase, out) {
  const p = Math.max(0, Math.min(1, phase));
  let i = 0;
  while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = (p - a.p) / (b.p - a.p);

  mixHex(a.fog, b.fog, t, out.fog);
  mixHex(a.sky, b.sky, t, out.sky);
  mixHex(a.zenith, b.zenith, t, out.zenith);
  mixHex(a.sun, b.sun, t, out.sun);
  mixHex(a.hemiSky, b.hemiSky, t, out.hemiSky);
  mixHex(a.hemiGnd, b.hemiGnd, t, out.hemiGnd);
  mixHex(a.deep, b.deep, t, out.deep);
  mixHex(a.shallow, b.shallow, t, out.shallow);
  out.sunI = a.sunI + (b.sunI - a.sunI) * t;
  out.hemiI = a.hemiI + (b.hemiI - a.hemiI) * t;
  out.night = a.night + (b.night - a.night) * t;
  out.cloud = a.cloud + (b.cloud - a.cloud) * t;
  out.sunPos.set(
    a.sunPos[0] + (b.sunPos[0] - a.sunPos[0]) * t,
    a.sunPos[1] + (b.sunPos[1] - a.sunPos[1]) * t,
    a.sunPos[2] + (b.sunPos[2] - a.sunPos[2]) * t
  );
  return out;
}

export function makePalette() {
  return {
    fog: new THREE.Color(), sky: new THREE.Color(), zenith: new THREE.Color(),
    sun: new THREE.Color(),
    hemiSky: new THREE.Color(), hemiGnd: new THREE.Color(),
    deep: new THREE.Color(), shallow: new THREE.Color(),
    sunI: 1.9, hemiI: 1.25, night: 0, cloud: 0.55,
    sunPos: new THREE.Vector3(8, 14, 6),
  };
}

/* Wind grass uses an InstancedMesh with vertex-shader bending; CPU work mainly determines placement. */

/* Each blade is a tapered four-segment ribbon. Upward normals make the grass read as a sunlit surface instead of black vertical Lambert planes. */
function bladeGeometry(segments = 3) {
  const pos = [], nor = [], col = [], idx = [];
  const H = 1, W = 0.055;
  for (let i = 0; i <= segments; i++) {
    const v = i / segments;
    const w = W * (1 - v * 0.92);
    const shade = 0.74 + v * 0.26;          // Darken the roots and brighten the tips.
    pos.push(-w, v * H, 0, w, v * H, 0);
    nor.push(0, 1, 0, 0, 1, 0);
    col.push(shade, shade, shade, shade, shade, shade);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

const GRASS_COUNT = { high: 14000, lite: 4500, min: 0 };

export class WindGrass {
  constructor(scene, quality, wx, wz) {
    this.scene = scene;
    this.uTime = { value: 0 };
    this.uWind = { value: 1 };              // Wind-gust intensity multiplier.
    this.meshes = {};
    this.visible = true;
    this.quality = null;
    this._wx = wx; this._wz = wz;
    this._geo = bladeGeometry();
    this._mat = this._material();
    /* Generate the maximum placement set once with a fixed seed, then draw only the quality-dependent prefix. */
    this._spots = this._scatter(GRASS_COUNT.high);
    this.setQuality(quality);
  }

  _material() {
    const m = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      color: 0x8fc46a,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uWind = this.uWind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime;
uniform float uWind;`)
        .replace('#include <begin_vertex>', `
vec3 transformed = vec3( position );
#ifdef USE_INSTANCING
  vec3 iPos = instanceMatrix[3].xyz;
#else
  vec3 iPos = vec3( 0.0 );
#endif
float tip   = clamp( position.y, 0.0, 1.0 );
float bend  = tip * tip;                       /* Roots remain fixed. */
float phase = iPos.x * 0.83 + iPos.z * 0.61;
/* Broad gusts plus per-blade flutter. */
float gust  = 0.55 + 0.45 * sin( uTime * 0.42 - ( iPos.x + iPos.z * 0.7 ) * 0.085 );
float sway  = sin( uTime * 1.9 + phase ) + 0.32 * sin( uTime * 3.7 + phase * 1.9 );
float amp   = 0.16 * uWind * gust * bend;
transformed.x += sway * amp;
transformed.z += cos( uTime * 1.55 + phase * 0.9 ) * amp * 0.55;
transformed.y -= abs( sway ) * amp * 0.30;     /* Bending slightly reduces blade height. */
`);
    };
    return m;
  }

  /* Avoid paths, pads, castle and sea. Store four numbers per placement: x, z, height and rotation. */
  _scatter(n) {
    let s = 1337;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const out = [];
    /* Leave the rear 0.8 units empty so blades do not hide the shoreline. */
    const NEAR_Z = 7.6, FAR_Z = SHORE_Z + 0.8;
    let guard = 0;
    while (out.length < n * 4 && guard++ < n * 60) {
      /* Seed only the visible trapezoid, narrower near the camera, to avoid wasting instances offscreen. */
      const z = FAR_Z + rnd() * (NEAR_Z - FAR_Z);
      const halfW = 9.5 + (NEAR_Z - z) / (NEAR_Z - FAR_Z) * 9.0;
      const x = (rnd() - 0.5) * 2 * halfW;
      /* Convert to logical coordinates for path collision checks. */
      const lx = x * 36 + D.FIELD_W / 2, ly = z * 36 + D.FIELD_H / 2;
      if (D.distToPath(lx, ly) < D.ROAD_HALF + 16) continue;
      let onPad = false;
      for (const p of D.PADS) {
        if (Math.hypot(p.x - lx, p.y - ly) < D.PAD_RADIUS + 14) { onPad = true; break; }
      }
      if (onPad) continue;
      if (Math.abs(x) < 7.6 && z > -7.6 && z < -3.2) continue;   // Castle footprint.
      /* Shorten distant blades so they do not form a green wall at the horizon. */
      const far = (NEAR_Z - z) / (NEAR_Z - FAR_Z);
      const h = (0.34 + rnd() * 0.30) * (1 - far * 0.42);
      out.push(x, z, h, rnd() * Math.PI);                        // x, z, height, rotation.
    }
    return out;
  }

  setQuality(q) {
    if (this.quality === q) return;
    this.quality = q;
    const n = GRASS_COUNT[q] != null ? GRASS_COUNT[q] : GRASS_COUNT.lite;
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); this.mesh = null; }
    if (!n) return;

    const count = Math.min(n, this._spots.length / 4);
    const mesh = new THREE.InstancedMesh(this._geo, this._mat, count);
    mesh.frustumCulled = false;                 /* Shader bending invalidates the static bounding box. */
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4(), q4 = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const x = this._spots[i * 4], z = this._spots[i * 4 + 1];
      const h = this._spots[i * 4 + 2], rot = this._spots[i * 4 + 3];
      pos.set(x, -0.07, z);
      q4.setFromAxisAngle(up, rot);
      scl.set(0.85 + (h - 0.34), h, 1);
      m.compose(pos, q4, scl);
      mesh.setMatrixAt(i, m);
      /* Vary blade colors slightly to avoid a flat carpet appearance. */
      const t = (Math.sin(x * 3.1 + z * 5.7) * 0.5 + 0.5);
      col.setHSL(0.24 + t * 0.045, 0.42 + t * 0.16, 0.40 + t * 0.14);
      mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    this.mesh = mesh;
    this.mesh.visible = this.visible;
    this.scene.add(mesh);
  }

  setVisible(visible) {
    this.visible = !!visible;
    if (this.mesh) this.mesh.visible = this.visible;
  }

  frame(dt, t, palette, bossBlend) {
    this.uTime.value = t;
    /* Update visual wind intensity. */
    this.uWind.value = 1 + Math.min(1, bossBlend) * 1.1;
    if (this.mesh) {
      /* Darken grass at night beyond Lambert lighting; keep the daytime base green to preserve per-instance color variation. */
      const n = palette.night;
      this.mesh.material.color.setRGB(
        0.62 - 0.47 * n,
        0.92 - 0.69 * n,
        0.48 - 0.31 * n
      );
    }
  }

  dispose() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); }
    this._geo.dispose();
    this._mat.dispose();
  }
}

/* Procedural sea with wave normals, Fresnel, highlights and shoreline foam behind the castle. */

/* Compute analytical wave normals per fragment instead of displacing roughly 20,000 vertices. At this distant grazing angle, subpixel wave height is invisible while normal-based highlights remain clear and cheaper. */
const SEA_VERT = /* glsl */`
#include <fog_pars_vertex>
varying vec3 vWorld;

void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vWorld = wp;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SEA_FRAG = /* glsl */`
/* Three.js already prepends tone-mapping and color-space declarations. Including them again duplicates functions; include only fog here. */
#include <fog_pars_fragment>
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uNight;
uniform float uShoreZ;
uniform float uChop;
varying vec3 vWorld;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

/* Return vec3(height, dh/dx, dh/dz) for one wave instead of accumulating through inout, which broke water rendering on some drivers. */
vec3 wave(vec2 dir, float amp, float len, float speed, vec2 p, float t) {
  float k = 6.2831853 / len;
  vec2 d = normalize(dir);
  float f = k * dot(d, p) - speed * k * t;
  return vec3(amp * sin(f), amp * k * cos(f) * d.x, amp * k * cos(f) * d.y);
}

void main() {
  float dist = length(cameraPosition - vWorld);
  /* Fade small ripples with distance to avoid shimmer; fade large waves at extreme distance to avoid subpixel moire. */
  float detail  = 1.0 - smoothstep(26.0, 62.0, dist);
  float bigFade = 1.0 - smoothstep(52.0, 92.0, dist);

  /* Domain warping prevents ruler-straight parallel crests. */
  vec2 p0 = vWorld.xz;
  vec2 warp = vec2(vnoise(p0 * 0.055), vnoise(p0 * 0.047 + 31.0)) - 0.5;
  vec2 p = p0 + warp * 7.0;

  vec3 w = (wave(vec2( 1.0,  0.35), 0.110 * uChop, 7.5, 1.55, p, uTime)
         +  wave(vec2( 0.7, -0.75), 0.075 * uChop, 4.2, 1.20, p, uTime)) * bigFade
         + wave(vec2(-0.4,  0.9 ), 0.045 * uChop, 2.6, 0.95, p, uTime) * (0.35 + 0.65 * detail)
         + wave(vec2( 0.9,  0.15), 0.022 * uChop, 1.3, 0.70, p, uTime) * detail
         + wave(vec2( 0.3,  1.0 ), 0.010 * uChop, 0.6, 0.50, p, uTime) * detail;

  vec3 N = normalize(vec3(-w.y, 1.0, -w.z));
  /* Whitecaps appear only on nearby high crests; a low threshold makes distant water look corrugated. */
  float crestRaw = clamp((w.x - 0.105) * 7.0, 0.0, 1.0) * detail;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uSunDir);

  /* Use brighter colors in shallow shoreline water. */
  float shore = clamp((vWorld.z - (uShoreZ - 11.0)) / 11.0, 0.0, 1.0);
  vec3 base = mix(uDeep, uShallow, shore * 0.85);

  /* Fresnel adds more sky reflection at grazing angles. */
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
  vec3 col = mix(base, uSky, fres * 0.75);

  /* Sharp sun/moon reflections on wave normals. */
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 220.0);
  float glint = pow(max(dot(N, H), 0.0), 26.0) * 0.16;
  col += uSunColor * (spec * 2.4 + glint) * (1.0 - uNight * 0.35);

  /* Whitecaps at wave crests. */
  float crest = smoothstep(0.35, 0.9, crestRaw);
  col = mix(col, vec3(0.86, 0.92, 0.98), crest * 0.42);

  /* Shape the shoreline with noise and incoming/outgoing motion; reduce alpha in front to reveal sand without a straight plane edge. */
  float wob = (vnoise(vec2(vWorld.x * 0.34, 11.0)) - 0.5) * 1.7
            + (vnoise(vec2(vWorld.x * 1.15, 27.0)) - 0.5) * 0.6;
  float surge = sin(uTime * 0.62 + vWorld.x * 0.09) * 0.45
              + sin(uTime * 0.41 - vWorld.x * 0.17) * 0.25;
  float line = uShoreZ + wob + surge;
  float d = line - vWorld.z;          /* Positive means water; negative means sand. */

  /* Gather foam just inside the shoreline. GLSL smoothstep requires increasing edges; use 1.0 - smoothstep(low, high) for a falling ramp. */
  float foam = smoothstep(-0.1, 0.4, d) * (1.0 - smoothstep(0.45, 1.7, d));
  foam *= 0.45 + 0.55 * vnoise(vec2(vWorld.x * 2.4, vWorld.z * 2.4 - uTime * 0.8));
  /* Darken foam at night to avoid a fluorescent horizon stripe. */
  col = mix(col, vec3(0.80, 0.88, 0.95), clamp(foam, 0.0, 1.0) * 0.75 * (1.0 - uNight * 0.78));

  float alpha = smoothstep(-0.35, 0.7, d);

  /* Converge distant water to the same fog color as the sky band's uHorizon. The visible water spans about 29.7–39.7 units; blend only the last six units to hide the seam without washing out the foreground. */
  col = mix(col, uSky, smoothstep(34.0, 40.5, dist));

  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* Without displaced vertices, the water plane needs only enough subdivisions for smooth interpolated fog. */
const SEA_SEG = { high: [48, 32], lite: [24, 16], min: [8, 6] };

export class Sea {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = null;
    this.uniforms = {
      uTime: { value: 0 },
      uChop: { value: 1 },
      uDeep: { value: new THREE.Color(0x14618f) },
      uShallow: { value: new THREE.Color(0x53c6da) },
      uSky: { value: new THREE.Color(0xcfeaff) },
      uSunColor: { value: new THREE.Color(0xfff2d8) },
      uSunDir: { value: new THREE.Vector3(8, 14, 6).normalize() },
      uNight: { value: 0 },
      uShoreZ: { value: WATER_LINE },
      ...THREE.UniformsLib.fog,
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SEA_VERT,
      fragmentShader: SEA_FRAG,
      fog: true,
      transparent: true,        /* Fade water alpha near shore to reveal sand. */
      depthWrite: false,
    });

    /* Place sand below water at y=-0.30. Use a subdued material color because strong hemisphere and sun lighting would wash out a literal bright sand color. */
    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 9),
      new THREE.MeshLambertMaterial({ color: 0x9c8a63 })
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, -0.34, SHORE_Z - 4.1);   // z spans -15.6 to -6.6, overlapping grass.
    sand.receiveShadow = true;
    this.sand = sand;
    scene.add(sand);

    this.setQuality(quality);
  }

  setQuality(q) {
    if (this.quality === q) return;
    this.quality = q;
    const seg = SEA_SEG[q] || SEA_SEG.lite;
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    const geo = new THREE.PlaneGeometry(150, 62, seg[0], seg[1]);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.material);
    /* Extend the front over sand near z=-9.6, then shape the edge with alpha. */
    mesh.position.set(0, -0.30, -40.6);        // z: -71.6 ~ -9.6
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;                     // Render after sand but before other scene objects.
    this.mesh = mesh;
    this.scene.add(mesh);
  }

  frame(dt, t, palette, bossBlend) {
    const u = this.uniforms;
    u.uTime.value = t;
    u.uChop.value = 1 + Math.min(1, bossBlend) * 0.9;   // Update wave roughness.
    u.uDeep.value.copy(palette.deep);
    u.uShallow.value.copy(palette.shallow);
    u.uSky.value.copy(palette.fog);                    // Blend the horizon into fog color.
    u.uSunColor.value.copy(palette.sun);
    u.uSunDir.value.copy(palette.sunPos).normalize();
    u.uNight.value = palette.night;
    /* Sand follows the time-of-day palette. */
    const n = palette.night;
    this.sand.material.color.setRGB(0.61 - n * 0.44, 0.54 - n * 0.39, 0.39 - n * 0.27);
  }

  dispose() {
    this.scene.remove(this.mesh, this.sand);
    this.mesh.geometry.dispose();
    this.sand.geometry.dispose();
    this.sand.material.dispose();
    this.material.dispose();
  }
}

/* Night-only fireflies drift in the vertex shader without per-particle CPU updates. */

const FIRE_VERT = /* glsl */`
uniform float uTime;
uniform float uSize;
attribute vec3 aSeed;
varying float vFade;
void main() {
  vec3 p = position;
  p.x += sin(uTime * aSeed.x * 0.55 + aSeed.z * 6.2) * 1.5;
  p.z += cos(uTime * aSeed.y * 0.48 + aSeed.x * 5.1) * 1.3;
  p.y += sin(uTime * 0.75 + aSeed.z * 4.0) * 0.45;
  /* Vary each firefly's pulse period for natural local flicker. */
  vFade = 0.35 + 0.65 * pow(max(sin(uTime * (0.9 + aSeed.y) + aSeed.z * 9.0), 0.0), 2.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (18.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FIRE_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = pow(1.0 - d * 2.0, 2.2);
  gl_FragColor = vec4(uColor, a * vFade * uOpacity);
}
`;

/* Keep firefly density low; the original 90-particle version obscured enemies and competed with gameplay. */
const FIRE_COUNT = { high: 34, lite: 16, min: 0 };

export class Fireflies {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = null;
    this.uniforms = {
      uTime: { value: 0 },
      uSize: { value: 13 },
      uColor: { value: new THREE.Color(0xc8f07a) },
      uOpacity: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: FIRE_VERT,
      fragmentShader: FIRE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.setQuality(quality);
  }

  setQuality(q) {
    if (this.quality === q) return;
    this.quality = q;
    const n = FIRE_COUNT[q] != null ? FIRE_COUNT[q] : FIRE_COUNT.lite;
    if (this.points) { this.scene.remove(this.points); this.points.geometry.dispose(); this.points = null; }
    if (!n) return;

    let s = 909;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const pos = new Float32Array(n * 3), seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      /* Avoid paths with extra margin for the shader's roughly 1.5-unit drift. */
      let x = 0, z = 0;
      for (let tries = 0; tries < 24; tries++) {
        x = (rnd() - 0.5) * 34;
        z = SHORE_Z + 1.5 + rnd() * 15;
        const lx = x * 36 + D.FIELD_W / 2, ly = z * 36 + D.FIELD_H / 2;
        if (D.distToPath(lx, ly) > D.ROAD_HALF + 60) break;
      }
      pos[i * 3] = x;
      pos[i * 3 + 1] = 0.5 + rnd() * 2.2;
      pos[i * 3 + 2] = z;
      seed[i * 3] = 0.5 + rnd();
      seed[i * 3 + 1] = 0.5 + rnd();
      seed[i * 3 + 2] = rnd() * 6.283;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    const pts = new THREE.Points(geo, this.material);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    this.points = pts;
    this.scene.add(pts);
  }

  frame(dt, t, palette) {
    this.uniforms.uTime.value = t;
    /* Appear only after sunset. */
    this.uniforms.uOpacity.value = Math.max(0, (palette.night - 0.35) / 0.65) * 0.62;
    if (this.points) this.points.visible = this.uniforms.uOpacity.value > 0.01;
  }

  dispose() {
    if (this.points) { this.scene.remove(this.points); this.points.geometry.dispose(); }
    this.material.dispose();
  }
}
