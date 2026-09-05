/* The fixed downward camera cannot see a conventional sky dome. Use one camera-attached quad for the top sky band and match its bottom to fog/sea color to hide the seam. nature.js owns actual 3D scenery. */
import * as THREE from 'three';

const SKY_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */`
uniform vec3  uHorizon;      /* Bottom of the band matches fog to hide the seam. */
uniform vec3  uZenith;       /* Top of the band. */
uniform vec3  uSunColor;
uniform float uTime;
uniform float uNight;        /* Zero is day; one is night. */
uniform float uCloud;
uniform float uAspect;       /* Band aspect ratio keeps moon and planet circular. */
uniform float uMoonPhase;    /* Zero is new moon; one is full moon. */
uniform float uSunX;         /* Sun horizontal position from 0 to 1. */
uniform float uSunY;         /* Sun height decreases toward sunset. */
uniform float uMoonX;        /* Moon horizontal position from 0 to 1. */
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}

/* At most one star per grid cell, with varied brightness and twinkle periods. */
float starField(vec2 p, float density, float size) {
  vec2 g = floor(p), f = fract(p);
  float h = hash(g);
  if (h < density) return 0.0;
  vec2 c = vec2(hash(g + 1.37), hash(g + 7.71));
  float d = length(f - c);
  float mag = 0.35 + hash(g + 9.13) * 0.65;
  float tw = 0.55 + 0.45 * sin(uTime * (1.2 + hash(g + 3.11) * 3.4) + hash(g + 5.57) * 6.283);
  return smoothstep(size * mag, 0.0, d) * mag * tw;
}

void main() {
  /* Use aspect-correct coordinates; raw UVs would stretch circular bodies across the shallow sky band. */
  vec2 sp = vec2(vUv.x * uAspect, vUv.y);

  /* Background gradient. */
  float grad = pow(clamp(vUv.y, 0.0, 1.0), 0.85);
  vec3 col = mix(uHorizon, uZenith, grad);

  /* Stars appear at night. */
  float starAmt = smoothstep(0.30, 0.85, uNight);
  float band = 1.0 - smoothstep(0.0, 0.42, abs(vUv.y - 0.62 - (vUv.x - 0.5) * 0.30));
  if (starAmt > 0.001) {
    /* A diagonal Milky Way band adds structure beyond isolated star dots. */
    float milky = band * (0.35 + 0.65 * fbm(sp * 2.6 + 4.0)) * 0.17;
    col += vec3(0.62, 0.68, 0.95) * milky * starAmt;

    /* Increase density upward as though thin atmosphere obscures the horizon. */
    float up = smoothstep(0.02, 0.65, vUv.y);
    float s = starField(sp * 46.0, 0.972, 0.085)
            + starField(sp * 78.0, 0.984, 0.060) * 0.75
            + starField(sp * 27.0, 0.990, 0.115) * 1.20;   /* Sparse large stars. */
    s += band * starField(sp * 96.0, 0.975, 0.055) * 0.5;  /* Denser stars inside the Milky Way. */
    col += vec3(0.92, 0.95, 1.0) * s * up * starAmt;
  }

  /* A large fantasy planet remains faintly visible above the castle during daytime. */
  {
    vec2 c = vec2(uAspect * 0.50, 0.70);
    float r = 0.26;
    float d = length(sp - c);
    float disc = 1.0 - smoothstep(r * 0.985, r, d);
    if (disc > 0.001) {
      vec2 uvp = (sp - c) / r;
      float z = sqrt(max(0.0, 1.0 - dot(uvp, uvp)));      /* Lift coordinates onto the sphere surface. */
      vec3 n = normalize(vec3(uvp, max(z, 0.001)));
      /* Wrap continent noise onto spherical coordinates and rotate slowly. */
      vec2 sph = vec2(atan(n.x, n.z) * 0.55 + uTime * 0.006, n.y * 0.9);
      float land = fbm(sph * 3.4 + 11.0);
      vec3 surf = mix(vec3(0.09, 0.26, 0.55), vec3(0.24, 0.42, 0.22),
                      smoothstep(0.50, 0.60, land));
      surf = mix(surf, vec3(0.86, 0.90, 0.96), smoothstep(0.70, 0.80, land) * 0.55);
      /* Light/dark boundary follows the sun direction. */
      vec3 ldir = normalize(vec3(uSunX * 2.0 - 1.0, 0.30, 0.80));
      float lam = clamp(dot(n, ldir), 0.0, 1.0);
      surf *= 0.14 + 0.86 * smoothstep(0.0, 0.55, lam);
      /* Atmospheric rim. */
      surf += vec3(0.35, 0.60, 1.0) * smoothstep(0.55, 1.0, 1.0 - z) * lam * 0.5;
      /* Keep daytime opacity very low to avoid a soap-bubble appearance. */
      float vis = mix(0.14, 1.0, smoothstep(0.15, 0.75, uNight));
      col = mix(col, surf, disc * vis);
    }
  }

  /* Sun. */
  {
    float isNight = smoothstep(0.35, 0.78, uNight);
    vec2 c = vec2(uAspect * clamp(uSunX, 0.04, 0.96), uSunY);
    float d = length(sp - c);
    float disc = 1.0 - smoothstep(0.098, 0.116, d);
    float halo = pow(1.0 - smoothstep(0.0, 0.70, d), 2.4);
    col += uSunColor * halo * 0.40 * (1.0 - isNight);
    col = mix(col, uSunColor * 1.35, disc * (1.0 - isNight));
  }

  /* Moon with the supplied real-time phase. */
  {
    float isNight = smoothstep(0.30, 0.72, uNight);
    vec2 c = vec2(uAspect * clamp(uMoonX, 0.04, 0.96), 0.60);
    float d = length(sp - c);
    float r = 0.115;
    float disc = 1.0 - smoothstep(r * 0.95, r, d);
    /* Offset an occluding circle to form a crescent; move it clear for a full moon. */
    float shade = 1.0 - smoothstep(r * 0.95, r * 1.02, length(sp - (c + vec2(uMoonPhase * 2.3 * r, 0.0))));
    float lit = clamp(disc - shade, 0.0, 1.0);
    float cr = fbm((sp - c) * 24.0);
    vec3 moonCol = mix(vec3(0.90, 0.92, 0.88), vec3(0.64, 0.68, 0.73), smoothstep(0.44, 0.62, cr));
    col += vec3(0.75, 0.82, 1.0) * pow(1.0 - smoothstep(0.0, 0.44, d), 3.0) * 0.20 * isNight;
    /* Keep the dark side faintly visible so the moon reads as a sphere. */
    col = mix(col, moonCol * 0.15, clamp(disc - lit, 0.0, 1.0) * isNight * 0.75);
    col = mix(col, moonCol, lit * isNight);
  }

  /* Horizontally drifting clouds. */
  {
    vec2 q = sp * vec2(1.15, 2.4) + vec2(uTime * 0.011, 0.0);
    float n = fbm(q);
    n = fbm(q + vec2(n * 0.6, n * 0.3));                 /* Fold noise again for billowing shapes. */
    /* Use sparse cloud patches with a clear upper band; a low threshold obscured both sky color and sun. */
    float mask = smoothstep(0.04, 0.34, vUv.y) * (1.0 - smoothstep(0.40, 0.86, vUv.y) * 0.85);
    float c = smoothstep(0.66 - uCloud * 0.14, 0.88, n) * mask;
    vec3 cloudCol = mix(vec3(1.0, 0.99, 0.96), uSunColor, 0.35);
    cloudCol = mix(cloudCol, vec3(0.26, 0.32, 0.52), uNight * 0.85);
    col = mix(col, cloudCol, clamp(c, 0.0, 1.0) * (0.45 + 0.35 * (1.0 - uNight)));
  }

  /* Blend the bottom fully into fog at the sea seam so the band does not look pasted on. */
  col = mix(uHorizon, col, smoothstep(0.0, 0.24, vUv.y));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class SkyBand {
  /* Fraction of screen height reserved for sky. */
  constructor(camera, fraction = 0.17) {
    this.camera = camera;
    this.fraction = fraction;
    this.uniforms = {
      uHorizon: { value: new THREE.Color(0xcfe9ff) },
      uZenith: { value: new THREE.Color(0x5aa8e8) },
      uSunColor: { value: new THREE.Color(0xfff2d8) },
      uTime: { value: 0 },
      uNight: { value: 0 },
      uCloud: { value: 0.55 },
      uAspect: { value: 9 },
      uMoonPhase: { value: 0.5 },
      uSunX: { value: 0.78 },
      uSunY: { value: 0.62 },
      uMoonX: { value: 0.22 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      depthTest: false,        /* Render above the game scene. */
      depthWrite: false,
      /* Use the transparent queue even at alpha 1, so renderOrder=900 places the band after transparent water instead of allowing water to cover it. */
      transparent: true,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = 900;
    this.mesh.frustumCulled = false;
    camera.add(this.mesh);     /* Attach to the camera so it follows the viewport. */
    this.layout();
  }

  /* Cover the upper fraction of the frustum precisely; update after viewport or FOV changes. */
  layout() {
    const cam = this.camera;
    const dist = 1;                                      // One unit in front of the camera.
    const h = 2 * Math.tan((cam.fov * Math.PI / 180) / 2) * dist;
    const w = h * cam.aspect;
    const bh = h * this.fraction;
    this.mesh.scale.set(w * 1.02, bh * 1.02, 1);
    this.mesh.position.set(0, h / 2 - bh / 2, -dist);
    this.uniforms.uAspect.value = (w / bh) || 9;
  }

  /* moonPhase runs from 0 for new moon to 1 for full moon; the renderer supplies the real-time phase. */
  frame(dt, t, palette, moonPhase) {
    const u = this.uniforms;
    u.uTime.value = t;
    u.uHorizon.value.copy(palette.fog);                  // Meet the sea at the same horizon color.
    u.uZenith.value.copy(palette.zenith);
    u.uSunColor.value.copy(palette.sun);
    u.uNight.value = palette.night;
    u.uCloud.value = palette.cloud;
    u.uMoonPhase.value = moonPhase;
    /* Move the sun toward the right as it sets, opposite the rising moon; keep the planet above the castle. */
    const day = 1 - palette.night;
    u.uSunX.value = 0.70 + palette.night * 0.20;
    u.uSunY.value = 0.24 + day * 0.44;
    u.uMoonX.value = 0.20;
  }

  dispose() {
    this.camera.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
