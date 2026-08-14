/* =====================================================
 * art-v2 GLB 디코딩과 인스턴스 생성.
 *
 * 모델 파일을 읽는 책임은 RuntimeAssetLoader에 남기고, Three.js 객체를 만드는
 * 부분만 이 파일이 맡는다. 엔진 상태나 전투 규칙은 전혀 참조하지 않는다.
 * ===================================================== */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();

/* GLTFLoader normally turns embedded GLB images into blob: URLs and loads them
 * through fetch(). Some Chromium/WebView builds reject that blob fetch even
 * though they support decoding the exact same Blob. Decode embedded PNG/JPEG
 * data directly before the loader creates a URL so model materials keep their
 * textures instead of falling back to white. External image URIs still follow
 * Three.js's normal loader path. */
loader.register((parser) => {
  const loadImageSource = parser.loadImageSource.bind(parser);
  parser.loadImageSource = (sourceIndex, textureLoader) => {
    const source = parser.json.images?.[sourceIndex];
    if (source?.bufferView === undefined || typeof globalThis.createImageBitmap !== 'function') {
      return loadImageSource(sourceIndex, textureLoader);
    }
    if (parser.sourceCache[sourceIndex] !== undefined) {
      return parser.sourceCache[sourceIndex].then((texture) => texture.clone());
    }
    const promise = parser.getDependency('bufferView', source.bufferView)
      .then((bufferView) => createImageBitmap(new Blob([bufferView], { type: source.mimeType }), {
        premultiplyAlpha: 'none', colorSpaceConversion: 'none',
      }))
      .then((imageBitmap) => {
        const texture = new THREE.Texture(imageBitmap);
        texture.needsUpdate = true;
        return texture;
      });
    parser.sourceCache[sourceIndex] = promise;
    return promise;
  };
  return { name: 'CONSTELLATION_direct_embedded_images' };
});

export function decodeGltfAsset({ entry, bytes }) {
  return new Promise((resolve, reject) => {
    loader.parse(bytes, '', (gltf) => resolve(Object.freeze({
      entry,
      scene: gltf.scene,
      animations: Object.freeze([...(gltf.animations || [])]),
    })), reject);
  });
}

function firstClip(clips, preferred) {
  const names = Array.isArray(preferred) ? preferred : [preferred];
  for (const name of names) {
    const clip = clips.get(name);
    if (clip) return clip;
  }
  return clips.values().next().value || null;
}

export function instantiateGltfAsset(asset, {
  targetHeight = 1.5,
  idle = ['Idle'],
  yawOffset = 0,
  hover = 0,
  centerXZ = false,
} = {}) {
  const root = cloneSkeleton(asset.scene);
  root.rotation.y = yawOffset;
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });

  /* 팩마다 단위가 달라도 화면상의 높이는 게임 쪽 슬롯이 결정한다. */
  const sourceBounds = new THREE.Box3().setFromObject(root);
  const sourceHeight = Math.max(0.001, sourceBounds.max.y - sourceBounds.min.y);
  root.scale.setScalar(targetHeight / sourceHeight);
  const fittedBounds = new THREE.Box3().setFromObject(root);
  root.position.y = -fittedBounds.min.y + hover;
  if (centerXZ) {
    root.position.x -= (fittedBounds.min.x + fittedBounds.max.x) / 2;
    root.position.z -= (fittedBounds.min.z + fittedBounds.max.z) / 2;
  }

  const mixer = new THREE.AnimationMixer(root);
  const clips = new Map(asset.animations.map((clip) => [clip.name, clip]));
  let currentName = '';
  let currentAction = null;

  const play = (preferred, { once = false, speed = 1 } = {}) => {
    const clip = firstClip(clips, preferred);
    if (!clip) return false;
    if (currentName === clip.name && currentAction?.isRunning()) return true;
    const next = mixer.clipAction(clip);
    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(speed);
    next.setEffectiveWeight(1);
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    if (currentAction && currentAction !== next) currentAction.fadeOut(0.12);
    next.fadeIn(0.12).play();
    currentName = clip.name;
    currentAction = next;
    return true;
  };

  play(idle);
  return {
    root,
    mixer,
    play,
    idle,
    hover,
    yawOffset,
    baseY: root.position.y,
    get animation() { return currentName; },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      root.removeFromParent();
    },
  };
}
