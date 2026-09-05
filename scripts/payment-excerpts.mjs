import { readFileSync, writeFileSync } from 'node:fs';
// Only these reviewed source windows enter the public bundle, never configuration.
const windows = {
  checkout: ['server/store-api.mjs', '        const payload = {', 13],
  hosted: ['server/neon-client.mjs', '  const response = await fetchImpl', 6],
  fulfill: ['server/repository.mjs', '  async fulfill(', 20],
  refund: ['server/repository.mjs', '  async revoke(', 16],
  visuals: ['src/gfx/cosmetics.js', '  setEntitlements(', 3],
};
const excerpts = {};
for (const [key, [file, needle, count]] of Object.entries(windows)) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const index = lines.findIndex(line => line.includes(needle));
  if (index < 0) throw new Error(`Missing excerpt anchor: ${file}: ${needle}`);
  excerpts[key] = { file, line: index + 1, code: lines.slice(index, index + count).join('\n') };
}
const output = `// Generated from reviewed source windows by scripts/payment-excerpts.mjs.\nexport const EXCERPTS = ${JSON.stringify(excerpts, null, 2)};\n`;
const destination = 'src/app/neon-excerpts.generated.js';
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== output) throw new Error('Payment excerpts are stale; run npm run build');
} else writeFileSync(destination, output);
