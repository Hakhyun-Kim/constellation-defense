import * as THREE from 'three';

// Optional view-only attachments. No engine imports, lights, timers or stat changes.
export class CastleCosmetics {
  constructor(castle) {
    this.groups = new Map();
    this.geometries = new Set();
    this.materials = new Set();
    const material = (color) => {
      const mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
      this.materials.add(mat);
      return mat;
    };
    const gold = material(0xffc84f), purple = material(0x913fff);
    const cyan = material(0x49e6ee), dark = material(0x354876);
    const group = (key) => {
      const node = new THREE.Group();
      node.name = key; node.visible = false;
      this.groups.set(key, node); castle.add(node);
      return node;
    };
    const mesh = (parent, geometry, mat, x, y, z) => {
      this.geometries.add(geometry);
      const node = new THREE.Mesh(geometry, mat);
      node.position.set(x, y, z); node.castShadow = true; parent.add(node);
      return node;
    };
    const banner = group('cosmetic.celestial_banner');
    mesh(banner, new THREE.CylinderGeometry(.06, .06, 3.2, 6), gold, 0, 5.0, -5.85);
    mesh(banner, new THREE.PlaneGeometry(2.6, 1.35), purple, 1.3, 5.8, -5.85);
    const star = mesh(banner, new THREE.OctahedronGeometry(.4), gold, 1.3, 5.8, -5.75);
    star.scale.z = .18;
    for (const x of [-3.4, 3.4]) {
      mesh(banner, new THREE.BoxGeometry(1.1, 1.8, .1), purple, x, 1.35, -3.93);
      mesh(banner, new THREE.OctahedronGeometry(.32), gold, x, 1.5, -3.78);
    }
    const spires = group('cosmetic.aurora_spires');
    for (const x of [-5.2, 5.2]) {
      mesh(spires, new THREE.CylinderGeometry(.95, 1.1, .3, 6), gold, x, 4.15, -5.1);
      mesh(spires, new THREE.OctahedronGeometry(1.05), cyan, x, 5.3, -5.1).scale.y = 1.7;
      for (const dx of [-.85, .85]) mesh(spires, new THREE.OctahedronGeometry(.42), cyan, x + dx, 4.65, -5.1).scale.y = 1.8;
    }
    const sentinels = group('cosmetic.golden_sentinels');
    for (const x of [-2.25, 2.25]) {
      mesh(sentinels, new THREE.BoxGeometry(1.25, .45, 1.1), dark, x, .4, -3.3);
      mesh(sentinels, new THREE.BoxGeometry(.75, 1.4, .65), gold, x, 1.25, -3.3);
      mesh(sentinels, new THREE.IcosahedronGeometry(.52, 0), gold, x, 2.2, -3.3);
      mesh(sentinels, new THREE.BoxGeometry(.65, 1.1, .12), purple, x, 1.25, -2.9);
      mesh(sentinels, new THREE.CylinderGeometry(.055, .055, 2.5, 5), gold, x + .6, 1.7, -3.3);
      mesh(sentinels, new THREE.OctahedronGeometry(.22), cyan, x + .6, 3.0, -3.3);
    }
  }
  setEntitlements(entitlements = {}) {
    for (const [key, group] of this.groups) group.visible = Object.hasOwn(entitlements, key);
  }
  dispose() {
    for (const group of this.groups.values()) group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
