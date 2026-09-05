/* Compare no tactics, random legal swaps and threat-based legal swaps with identical seeds and preparation policies. All policies use the real board and castTactic(). Usage: node scripts/balance-report.mjs [runs=12] [difficulty=normal] [profile] [--json] */
import * as D from '../src/data.js';
import { TACTIC_POLICIES, playRun } from './balance-bot.mjs';

const args = process.argv.slice(2);
const runs = Number(args.find(arg => /^\d+$/.test(arg))) || 12;
const difficulty = args.find(arg => Object.hasOwn(D.DIFFICULTIES, arg)) || 'normal';
const profile = args.find(arg => ['초보', '보통', '고수'].includes(arg)) || '보통';
const json = args.includes('--json');
const seeds = Array.from({ length: runs }, (_, index) => index * 7919 + 13);
const POLICY_LABEL = { none: '전술 없음', random: '무작위 합법 스왑', threat: '위협도 기반 스왑' };
const KIND_LABEL = { flare: 'Flare', tide: 'Tide', bloom: 'Bloom' };
const ROUTE_LABEL = ['왼쪽', '가운데', '오른쪽'];

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function countBy(items, keyOf) {
  const counts = {};
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function reportPolicy(policy) {
  const runsWithTrace = seeds.map(seed => ({
    seed,
    result: playRun(profile, difficulty, seed, { tacticPolicy: policy, trace: true }),
  }));
  const decisions = runsWithTrace.flatMap(({ seed, result }) =>
    result.trace.map(entry => ({ seed, ...entry })));
  const casts = decisions.flatMap(decision => (decision.casts || []).map(cast => ({
    seed: decision.seed,
    wave: decision.wave,
    second: decision.second,
    ...cast,
  })));
  const waves = runsWithTrace.map(({ result }) => result.wave);
  const tacticCasts = runsWithTrace.map(({ result }) => result.tactics);

  return {
    policy,
    label: POLICY_LABEL[policy],
    summary: {
      runs,
      waveMean: Number(average(waves).toFixed(2)),
      waveMedian: percentile(waves, 0.5),
      waveMin: Math.min(...waves),
      waveMax: Math.max(...waves),
      tacticMean: Number(average(tacticCasts).toFixed(2)),
      decisions: decisions.length,
      chosenSwaps: decisions.filter(decision => decision.swap).length,
      successfulCasts: casts.filter(cast => cast.ok).length,
      rejectedCasts: casts.filter(cast => !cast.ok).length,
      kindUse: countBy(casts.filter(cast => cast.ok), cast => KIND_LABEL[cast.kind]),
      routeUse: countBy(casts.filter(cast => cast.ok), cast => ROUTE_LABEL[cast.route]),
      sizeUse: countBy(casts.filter(cast => cast.ok), cast => String(cast.size)),
    },
    sample: decisions.slice(0, 8),
  };
}

const reports = TACTIC_POLICIES.map(reportPolicy);
const payload = {
  game: 'Constellation Defense',
  generatedAt: new Date().toISOString(),
  conditions: { difficulty, profile, runs, seeds },
  policies: reports,
};

if (json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`\n=== 전술 정책 비교 · ${D.DIFFICULTIES[difficulty].name} / ${profile} / 시드 ${runs}개 ===\n`);
  for (const report of reports) {
    const s = report.summary;
    console.log(`[${report.label}] 평균 ${s.waveMean}웨이브 · 중앙 ${s.waveMedian} · 범위 ${s.waveMin}~${s.waveMax}`
      + ` · 평균 전술 ${s.tacticMean}회 · 성공/거부 ${s.successfulCasts}/${s.rejectedCasts}`);
    if (s.successfulCasts) {
      console.log(`  종류 ${JSON.stringify(s.kindUse)} · 길 ${JSON.stringify(s.routeUse)} · 매치 ${JSON.stringify(s.sizeUse)}`);
    }
  }
  const threatSample = reports.find(report => report.policy === 'threat')?.sample.find(entry => entry.swap);
  if (threatSample) {
    console.log('\n첫 위협도 판단 표본:');
    console.log(JSON.stringify(threatSample, null, 2));
  }
}
