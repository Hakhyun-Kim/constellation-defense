/* Balance regression gate with bounded process-crash retries. Node 24 on Windows intermittently exits with 0xC0000005 at different runs even with repeated seeds and JIT settings. Retry process crashes, but fail when retries are exhausted. Usage: node scripts/balance-check.mjs [runs=60] [retries=4] */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const bot = join(here, 'balance-bot.mjs');
const runs = Number(process.argv[2]) || 60;
const maxTry = Number(process.argv[3]) || 6;
const DIFFS = ['easy', 'normal', 'hard'];
const PROFS = ['초보', '보통', '고수'];
/* Split difficulty/profile combinations into nine shorter processes to reduce exposure to intermittent runtime crashes. */

let failed = false;
let crashes = 0;

for (const d of DIFFS) {
  for (const p of PROFS) {
    let ok = false;
    for (let t = 1; t <= maxTry && !ok; t++) {
      const r = spawnSync(process.execPath, [bot, String(runs), d, p, 'check'], { encoding: 'utf8' });
      if (r.status === 0 || r.status === 1) {
        const line = (r.stdout || '').split(/\r?\n/).find((l) => l.trim().startsWith('['));
        if (line) console.log(line);
        if (r.status === 1) failed = true;
        ok = true;
      } else {
        crashes++;
      }
    }
    if (!ok) {
      console.log(`  ✗ [${d}/${p}] ${maxTry}번 모두 크래시 — 검증 불가`);
      failed = true;
    }
  }
  console.log('');
}

console.log(crashes ? `\n(참고: 크래시 ${crashes}회를 재시도로 흡수했습니다)` : '');
console.log(failed ? '❌ 밸런스 게이트 실패' : '✅ 밸런스 게이트 통과');
process.exit(failed ? 1 : 0);
