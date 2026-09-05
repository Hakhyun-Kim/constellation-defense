/* Optional external-asset boundary, unknown to the engine. Procedural mode makes no manifest request; art-v2 loads assets and returns null on failure so callers retain procedural fallbacks. */
import { assetSupportsProfile, normalizeAssetManifest, preloadAssets } from '../assets/catalog.js';

const silentLogger = Object.freeze({ warn() {} });

export class RuntimeAssetLoader {
  constructor({
    enabled = false,
    quality = 'high',
    manifestUrl = 'assets/manifest.json',
    fetchFn = globalThis.fetch?.bind(globalThis),
    decoders = {},
    logger = globalThis.console || silentLogger,
  } = {}) {
    this.enabled = !!enabled;
    this.quality = quality;
    this.manifestUrl = manifestUrl;
    this.fetchFn = fetchFn;
    this.decoders = { ...decoders };
    this.logger = logger || silentLogger;
    this.state = this.enabled ? 'idle' : 'disabled';
    this.manifest = null;
    this.error = null;
    this.failures = new Map();
    this.cache = new Map();
    this._initPromise = null;
    this._generation = 0;
    this._controller = new AbortController();
  }

  async init() {
    if (!this.enabled || this.state === 'disposed') return null;
    if (this.manifest) return this.manifest;
    if (this._initPromise) return this._initPromise;
    if (typeof this.fetchFn !== 'function') {
      this._failManifest(new Error('fetch를 사용할 수 없습니다.'));
      return null;
    }

    const generation = this._generation;
    this.state = 'manifest-loading';
    this._initPromise = (async () => {
      try {
        const response = await this.fetchFn(this.manifestUrl, {
          cache: 'no-cache',
          signal: this._controller.signal,
        });
        if (!response?.ok) throw new Error(`manifest HTTP ${response?.status ?? 'error'}`);
        const manifest = normalizeAssetManifest(await response.json());
        if (generation !== this._generation || this.state === 'disposed') return null;
        this.manifest = manifest;
        this.state = 'ready';
        return manifest;
      } catch (error) {
        if (generation === this._generation && this.state !== 'disposed') this._failManifest(error);
        return null;
      }
    })();
    return this._initPromise;
  }

  _failManifest(error) {
    this.error = error;
    this.state = 'failed';
    this.logger.warn?.('[art-v2] manifest를 읽지 못해 절차형 화면을 유지합니다.', error);
  }

  entry(id) {
    const entry = this.manifest?.byId.get(id) || null;
    return assetSupportsProfile(entry, this.quality) ? entry : null;
  }

  async load(id) {
    const manifest = await this.init();
    if (!manifest || this.state === 'disposed') return null;
    const entry = this.entry(id);
    if (!entry) return null;
    if (this.cache.has(id)) return this.cache.get(id);

    const generation = this._generation;
    const promise = (async () => {
      try {
        const response = await this.fetchFn(entry.path, {
          cache: entry.preload ? 'force-cache' : 'default',
          signal: this._controller.signal,
        });
        if (!response?.ok) throw new Error(`${entry.path} HTTP ${response?.status ?? 'error'}`);
        const bytes = await response.arrayBuffer();
        if (generation !== this._generation || this.state === 'disposed') return null;
        const decode = this.decoders[entry.type];
        return decode ? await decode({ entry, bytes }) : Object.freeze({ entry, bytes });
      } catch (error) {
        if (generation === this._generation && this.state !== 'disposed') {
          this.failures.set(id, error);
          this.cache.delete(id);
          this.logger.warn?.(`[art-v2] ${id} 로딩 실패 · 절차형 폴백 사용`, error);
        }
        return null;
      }
    })();
    this.cache.set(id, promise);
    return promise;
  }

  async preload() {
    const manifest = await this.init();
    if (!manifest) return [];
    return Promise.all(preloadAssets(manifest, this.quality).map((entry) => this.load(entry.id)));
  }

  async retry() {
    if (!this.enabled || this.state === 'disposed') return null;
    this._generation += 1;
    this._controller.abort();
    this._controller = new AbortController();
    this._initPromise = null;
    this.manifest = null;
    this.error = null;
    this.failures.clear();
    this.cache.clear();
    this.state = 'idle';
    return this.init();
  }

  snapshot() {
    return Object.freeze({
      enabled: this.enabled,
      quality: this.quality,
      state: this.state,
      manifestAssets: this.manifest?.assets.length || 0,
      cached: this.cache.size,
      failed: [...this.failures.keys()],
    });
  }

  dispose() {
    if (this.state === 'disposed') return;
    this._generation += 1;
    this.state = 'disposed';
    this._controller.abort();
    this.cache.clear();
    this.manifest = null;
  }
}
