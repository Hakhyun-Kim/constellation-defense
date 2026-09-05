/* Pack glTF with external buffers/textures into a compact GLB. For distant landmarks, reduce base color to a 512px JPEG and preserve other PBR values as material constants; 2K maps cost more than they add visually. Sharp is an authoring tool, not a runtime dependency. Usage: node scripts/pack-web-gltf.mjs input.gltf output.glb --sharp-module C:/path/to/node_modules/sharp --texture-size 512 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const inputArg = args[0];
const outputArg = args[1];
const option = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

if (!inputArg || !outputArg) {
  console.error('사용법: node scripts/pack-web-gltf.mjs input.gltf output.glb --sharp-module <sharp> [--texture-size 512]');
  process.exit(1);
}

const input = resolve(inputArg);
const output = resolve(outputArg);
const sourceDir = dirname(input);
const textureSize = Number(option('--texture-size', '512'));
if (!Number.isInteger(textureSize) || textureSize < 64 || textureSize > 2048) {
  throw new Error('--texture-size는 64~2048 정수여야 합니다.');
}

let sharp;
const sharpModule = option('--sharp-module');
if (sharpModule) {
  sharp = (await import(pathToFileURL(resolve(sharpModule, 'dist/index.mjs')).href)).default;
} else {
  try { sharp = (await import('sharp')).default; }
  catch { throw new Error('sharp를 찾을 수 없습니다. --sharp-module로 패키지 경로를 지정하세요.'); }
}

const gltf = JSON.parse(readFileSync(input, 'utf8'));
if (!Array.isArray(gltf.buffers) || gltf.buffers.length !== 1 || !gltf.buffers[0].uri) {
  throw new Error('정확히 하나의 외부 buffer를 가진 glTF만 지원합니다.');
}
const sourceBuffer = readFileSync(resolve(sourceDir, gltf.buffers[0].uri));
if (sourceBuffer.length !== gltf.buffers[0].byteLength) throw new Error('외부 buffer 길이 불일치');

/* Keep only base color for distant buildings and remap indices to omit unused textures and images. */
const usedTextureIndices = [];
for (const material of gltf.materials || []) {
  delete material.normalTexture;
  delete material.occlusionTexture;
  delete material.emissiveTexture;
  const pbr = material.pbrMetallicRoughness ||= {};
  delete pbr.metallicRoughnessTexture;
  pbr.metallicFactor = 0;
  pbr.roughnessFactor = 0.82;
  const index = pbr.baseColorTexture?.index;
  if (Number.isInteger(index) && !usedTextureIndices.includes(index)) usedTextureIndices.push(index);
}

const textureMap = new Map(usedTextureIndices.map((oldIndex, newIndex) => [oldIndex, newIndex]));
const imageMap = new Map();
const nextTextures = [];
const imageJobs = [];
for (const oldTextureIndex of usedTextureIndices) {
  const texture = gltf.textures?.[oldTextureIndex];
  if (!texture || !Number.isInteger(texture.source)) throw new Error(`texture ${oldTextureIndex}: source 누락`);
  let nextImageIndex = imageMap.get(texture.source);
  if (nextImageIndex == null) {
    const image = gltf.images?.[texture.source];
    if (!image?.uri || image.uri.startsWith('data:')) throw new Error(`image ${texture.source}: 외부 URI 필요`);
    nextImageIndex = imageJobs.length;
    imageMap.set(texture.source, nextImageIndex);
    imageJobs.push({ name: image.name || image.uri, path: resolve(sourceDir, image.uri) });
  }
  nextTextures.push({
    ...(Number.isInteger(texture.sampler) ? { sampler: texture.sampler } : {}),
    source: nextImageIndex,
  });
}
for (const material of gltf.materials || []) {
  const base = material.pbrMetallicRoughness?.baseColorTexture;
  if (base) base.index = textureMap.get(base.index);
}

const optimizedImages = [];
for (const job of imageJobs) {
  const bytes = await sharp(job.path)
    .resize({ width: textureSize, height: textureSize, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  optimizedImages.push({ name: job.name, bytes });
}

const pad4 = (length) => (4 - (length % 4)) % 4;
const binaryParts = [sourceBuffer, Buffer.alloc(pad4(sourceBuffer.length))];
let byteOffset = sourceBuffer.length + pad4(sourceBuffer.length);
const nextImages = [];
gltf.bufferViews ||= [];
for (const image of optimizedImages) {
  const view = gltf.bufferViews.length;
  gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: image.bytes.length });
  nextImages.push({ name: image.name, mimeType: 'image/jpeg', bufferView: view });
  binaryParts.push(image.bytes, Buffer.alloc(pad4(image.bytes.length)));
  byteOffset += image.bytes.length + pad4(image.bytes.length);
}

gltf.textures = nextTextures;
gltf.images = nextImages;
gltf.buffers = [{ byteLength: byteOffset }];
const binary = Buffer.concat(binaryParts);

const jsonBytes = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPadding = Buffer.alloc(pad4(jsonBytes.length), 0x20);
const jsonChunkLength = jsonBytes.length + jsonPadding.length;
const totalLength = 12 + 8 + jsonChunkLength + 8 + binary.length;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunkLength, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binary.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, Buffer.concat([header, jsonHeader, jsonBytes, jsonPadding, binHeader, binary]));
console.log(`${input} -> ${output} · ${optimizedImages.length} texture · ${(totalLength / 1024).toFixed(1)} KiB`);
