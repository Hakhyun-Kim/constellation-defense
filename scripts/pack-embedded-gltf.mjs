/* Pack glTF with embedded data-URI buffers into one runtime GLB, without changing geometry, materials or animation. Keep source glTF/FBX outside the public runtime repository. Usage: node scripts/pack-embedded-gltf.mjs input.gltf output.glb */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [, , inputArg, outputArg] = process.argv;
if (!inputArg || !outputArg) {
  console.error('사용법: node scripts/pack-embedded-gltf.mjs input.gltf output.glb');
  process.exit(1);
}

const input = resolve(inputArg);
const output = resolve(outputArg);
const gltf = JSON.parse(readFileSync(input, 'utf8'));

if (!Array.isArray(gltf.buffers) || gltf.buffers.length !== 1) {
  throw new Error('정확히 하나의 내장 buffer를 가진 glTF만 지원합니다.');
}

const uri = gltf.buffers[0].uri;
const match = /^data:application\/octet-stream;base64,(.+)$/s.exec(uri || '');
if (!match) throw new Error('buffer가 application/octet-stream base64 data URI가 아닙니다.');

const binary = Buffer.from(match[1], 'base64');
if (binary.length !== gltf.buffers[0].byteLength) {
  throw new Error(`buffer 길이 불일치: 선언 ${gltf.buffers[0].byteLength}, 실제 ${binary.length}`);
}
delete gltf.buffers[0].uri;

const pad = (length) => (4 - (length % 4)) % 4;
const jsonBytes = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPadding = Buffer.alloc(pad(jsonBytes.length), 0x20);
const binPadding = Buffer.alloc(pad(binary.length), 0x00);
const jsonChunkLength = jsonBytes.length + jsonPadding.length;
const binChunkLength = binary.length + binPadding.length;
const totalLength = 12 + 8 + jsonChunkLength + 8 + binChunkLength;

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // glTF
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);

const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunkLength, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4); // JSON

const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binChunkLength, 0);
binHeader.writeUInt32LE(0x004e4942, 4); // BIN

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, Buffer.concat([
  header,
  jsonHeader, jsonBytes, jsonPadding,
  binHeader, binary, binPadding,
]));

console.log(`${input} -> ${output} (${(totalLength / 1024).toFixed(1)} KiB)`);
