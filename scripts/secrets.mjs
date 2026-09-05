/* Encrypt/decrypt an .env file for private hand-off (e.g. a Drive bundle),
 * so sandbox credentials never sit in plaintext next to the code.
 *
 *   node scripts/secrets.mjs encrypt .env .env.sandbox.enc
 *   node scripts/secrets.mjs decrypt .env.sandbox.enc .env
 *
 * Passphrase: SECRETS_PASSPHRASE env var, or an interactive prompt.
 * Format: JSON { v, salt, iv, tag, data } — scrypt(N=2^15) key derivation,
 * AES-256-GCM. No dependencies. The encrypted file is safe to hand over on
 * a private channel; send the passphrase separately. Never commit either
 * the plaintext .env or the passphrase; the .enc file itself also stays out
 * of the public repository (.gitignore).
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const [mode, input, output] = process.argv.slice(2);
if (!['encrypt', 'decrypt'].includes(mode) || !input) {
  console.error('Usage: node scripts/secrets.mjs encrypt|decrypt <in> [out]');
  process.exit(2);
}

async function passphrase() {
  if (process.env.SECRETS_PASSPHRASE) return process.env.SECRETS_PASSPHRASE;
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await readline.question('Passphrase: ');
  readline.close();
  if (!answer) { console.error('Empty passphrase.'); process.exit(2); }
  return answer;
}

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const key = (secret, salt) => scryptSync(secret, salt, 32, SCRYPT);

if (mode === 'encrypt') {
  const plain = readFileSync(input);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(await passphrase(), salt), iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  const out = output || `${input}.enc`;
  writeFileSync(out, JSON.stringify({
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }, null, 2) + '\n');
  console.error(`Encrypted ${input} → ${out} (${plain.length} bytes). Send the passphrase separately.`);
} else {
  const box = JSON.parse(readFileSync(input, 'utf8'));
  if (box.v !== 1) { console.error(`Unknown format version: ${box.v}`); process.exit(2); }
  const decipher = createDecipheriv('aes-256-gcm',
    key(await passphrase(), Buffer.from(box.salt, 'base64')), Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  let plain;
  try {
    plain = Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]);
  } catch {
    console.error('Decryption failed: wrong passphrase or corrupted file.');
    process.exit(1);
  }
  const out = output || '.env';
  writeFileSync(out, plain);
  console.error(`Decrypted ${input} → ${out}. Delete it after use; it is gitignored but still plaintext on disk.`);
}
