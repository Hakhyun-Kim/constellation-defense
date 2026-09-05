import * as THREE from 'three';

// A close-up of the actual castle model. Clones share geometry/materials with the
// battlefield, so disposing this preview must never dispose those shared assets.
export class CastlePreview {
  constructor(container, castle) {
    this.container = container;
    this.model = castle.clone(true);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x202844);
    this.scene.add(this.model, new THREE.HemisphereLight(0xffffff, 0x8895b0, 2.5));
    const sun = new THREE.DirectionalLight(0xffedce, 3);
    sun.position.set(-4, 12, 5); this.scene.add(sun);
    this.camera = new THREE.PerspectiveCamera(40, 1, .1, 80);
    this.camera.position.set(8, 7, 7);
    this.camera.lookAt(0, 3, -5);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.domElement.setAttribute('aria-label', 'Your castle with server-confirmed decorations');
    container.append(this.renderer.domElement);
    this.resize = new ResizeObserver(() => this.draw());
    this.resize.observe(container);
  }
  setEntitlements(entitlements) {
    this.model.traverse(node => {
      if (node.name.startsWith('cosmetic.')) node.visible = Object.hasOwn(entitlements, node.name);
    });
    this.draw();
  }
  draw() {
    const width = this.container.clientWidth, height = this.container.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.resize.disconnect(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
