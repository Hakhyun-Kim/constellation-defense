/* Pure runtime manifest contract shared by Node validation and browser loading, without fetch, DOM or Three.js dependencies. Validate provenance and selection deterministically. */

export const ASSET_MANIFEST_VERSION = 1;
export const ASSET_TYPES = Object.freeze(['model', 'audio', 'texture', 'font', 'image']);
export const ASSET_PROFILES = Object.freeze(['high', 'lite', 'min']);

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function assertField(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizePath(value, id) {
  assertField(typeof value === 'string' && value.startsWith('assets/'), `${id}: path는 assets/ 아래여야 합니다.`);
  const normalized = value.replaceAll('\\', '/');
  assertField(!normalized.includes('../') && !normalized.endsWith('/manifest.json'), `${id}: 안전하지 않은 path입니다.`);
  return normalized;
}

function normalizeEntry(entry, index, ids, paths) {
  const id = entry?.id;
  assertField(ID_PATTERN.test(id || ''), `assets[${index}]: kebab-case id가 필요합니다.`);
  assertField(!ids.has(id), `${id}: id가 중복되었습니다.`);
  ids.add(id);

  const type = entry?.type;
  assertField(ASSET_TYPES.includes(type), `${id}: type은 ${ASSET_TYPES.join(', ')} 중 하나여야 합니다.`);
  const path = normalizePath(entry.path, id);
  assertField(!paths.has(path), `${id}: path가 중복되었습니다.`);
  paths.add(path);

  assertField(typeof entry.creator === 'string' && entry.creator.trim(), `${id}: creator가 필요합니다.`);
  assertField(isHttpUrl(entry.sourceUrl), `${id}: 원본 sourceUrl이 필요합니다.`);
  assertField(typeof entry.license === 'string' && entry.license.trim(), `${id}: license가 필요합니다.`);
  assertField(isHttpUrl(entry.licenseUrl), `${id}: licenseUrl이 필요합니다.`);
  assertField(DATE_PATTERN.test(entry.acquiredAt || ''), `${id}: acquiredAt은 YYYY-MM-DD여야 합니다.`);
  assertField(HASH_PATTERN.test(entry.sha256 || ''), `${id}: sha256은 소문자 64자리여야 합니다.`);
  assertField(typeof entry.preload === 'boolean', `${id}: preload boolean이 필요합니다.`);

  const profiles = entry.profiles == null ? [...ASSET_PROFILES] : entry.profiles;
  assertField(Array.isArray(profiles) && profiles.length > 0, `${id}: profiles는 하나 이상의 품질 목록이어야 합니다.`);
  assertField(profiles.every((profile) => ASSET_PROFILES.includes(profile)), `${id}: 알 수 없는 profiles 값이 있습니다.`);

  return Object.freeze({
    ...entry,
    id,
    type,
    path,
    creator: entry.creator.trim(),
    license: entry.license.trim(),
    profiles: Object.freeze([...new Set(profiles)]),
  });
}

export function normalizeAssetManifest(value) {
  assertField(value && typeof value === 'object' && !Array.isArray(value), 'manifest는 객체여야 합니다.');
  assertField(value.version === ASSET_MANIFEST_VERSION, `manifest version은 ${ASSET_MANIFEST_VERSION}이어야 합니다.`);
  assertField(Array.isArray(value.assets), 'manifest에 assets 배열이 필요합니다.');

  const ids = new Set();
  const paths = new Set();
  const assets = value.assets.map((entry, index) => normalizeEntry(entry, index, ids, paths));
  const byId = new Map(assets.map((entry) => [entry.id, entry]));
  return Object.freeze({ version: ASSET_MANIFEST_VERSION, assets: Object.freeze(assets), byId });
}

export function assetSupportsProfile(entry, profile) {
  return !!entry && ASSET_PROFILES.includes(profile) && entry.profiles.includes(profile);
}

export function preloadAssets(manifest, profile) {
  return manifest.assets.filter((entry) => entry.preload && entry.runtimeLoad !== false && assetSupportsProfile(entry, profile));
}
