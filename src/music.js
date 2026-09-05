/* Procedural BGM with harmony, sustained pads, arpeggios, bass, drums and feedback-delay reverb. Tracks cover preparation, battle, commander and boss encounters without bundled music files. */
import { getAc, getMaster, isMusicMuted } from './sfx.js';

const semi = (n) => Math.pow(2, n / 12);
const NOTE = (s, base = 220) => base * semi(s);

/* Chord definitions: root semitone and chord tones. */
const MIN7 = [0, 3, 7, 10];
const MAJ  = [0, 4, 7];
const MAJ7 = [0, 4, 7, 11];
const MIN  = [0, 3, 7];
const SUS4 = [0, 5, 7];
const DIM  = [0, 3, 6];

/* Track schema: chords are root/type pairs per bar; arp is a 16-step chord-tone index pattern with null rests; bass uses root/offset steps; drums use k/s/h for kick, snare and hi-hat. */
const TRACKS = {
  /* Preparation: warm waltz-like Am7–Fmaj7–Cmaj–Gsus4. */
  prep: {
    bpm: 96, swing: 0.14,
    chords: [[0, MIN7], [-4, MAJ7], [3, MAJ], [-2, SUS4]],
    pad: { vol: 0.030, base: 220, cutoff: 1400 },
    arp: { steps: [0, null, 1, null, 2, null, 3, null, 2, null, 1, null, 2, null, 1, null],
           vol: 0.026, base: 440, type: 'triangle', len: 0.3 },
    bass: { steps: [0, null, null, null, 7, null, null, null, 0, null, null, null, 5, null, null, null],
            vol: 0.048, base: 110, type: 'sine', len: 0.34 },
    drums: 'h...h...h...h..h',
  },

  /* Battle: driving rock/chiptune Am–F–G–Am. */
  battle: {
    bpm: 132, swing: 0,
    chords: [[0, MIN], [-4, MAJ], [-2, MAJ], [0, MIN]],
    pad: { vol: 0.020, base: 220, cutoff: 1100 },
    arp: { steps: [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 3, 2, 1, 0, 2],
           vol: 0.020, base: 440, type: 'square', len: 0.12 },
    bass: { steps: [0, 0, null, 0, 0, null, 0, 0, 0, null, 0, 0, 7, null, 5, null],
            vol: 0.050, base: 110, type: 'sawtooth', len: 0.11 },
    drums: 'k..hs..hk.khs..h',
  },

  /* Commander: tense chromatic Am–A#dim–Am–Gm. */
  midboss: {
    bpm: 118, swing: 0,
    chords: [[0, MIN], [1, DIM], [0, MIN], [-2, MIN]],
    pad: { vol: 0.030, base: 110, cutoff: 800 },
    arp: { steps: [0, null, 2, null, 1, null, 2, null, 0, null, 2, null, 3, null, 2, null],
           vol: 0.018, base: 330, type: 'sawtooth', len: 0.16 },
    bass: { steps: [0, null, 0, null, 1, null, 0, null, 0, null, 0, null, -2, null, -1, null],
            vol: 0.056, base: 82, type: 'square', len: 0.16 },
    drums: 'k..ks..hk.k.s.h.',
  },

  /* Boss: driving Dm–Bb–C–Dm ostinato, transposed down a semitone. */
  boss: {
    bpm: 148, swing: 0,
    chords: [[0, MIN], [-3, MAJ], [-1, MAJ], [0, MIN]],
    pad: { vol: 0.026, base: 110, cutoff: 1300 },
    arp: { steps: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 3, 2, 1, 0],
           vol: 0.022, base: 440, type: 'sawtooth', len: 0.1 },
    bass: { steps: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 3, 2, 1, 0],
            vol: 0.060, base: 55, type: 'sawtooth', len: 0.1 },
    drums: 'k.khs.khk.khs.kh',
  },
};

/* Audio graph. */
let musicGain = null;   // Master music volume.
let dryGain = null;
let wetGain = null;
let delayA = null;
let duckGainNode = null;

function ensureGraph() {
  const c = getAc();
  if (!c) return null;
  if (musicGain) return musicGain;

  musicGain = c.createGain();
  musicGain.gain.value = 0.85;
  musicGain.connect(getMaster());

  duckGainNode = c.createGain();
  duckGainNode.gain.value = 1;
  duckGainNode.connect(musicGain);

  dryGain = c.createGain();
  dryGain.gain.value = 1;
  dryGain.connect(duckGainNode);

  /* Feedback delay and lowpass add simple reverb to dry synthesized tones. */
  wetGain = c.createGain();
  wetGain.gain.value = 0.34;
  delayA = c.createDelay(1.0);
  delayA.delayTime.value = 0.19;
  const fb = c.createGain();
  fb.gain.value = 0.38;
  const damp = c.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 2600;
  delayA.connect(damp);
  damp.connect(fb);
  fb.connect(delayA);
  delayA.connect(wetGain);
  wetGain.connect(duckGainNode);
  return musicGain;
}

export function duckBgm(amount = 0.4, dur = 0.4) {
  const c = getAc();
  if (!c || !ensureGraph() || !duckGainNode) return;
  const t = c.currentTime;
  duckGainNode.gain.cancelScheduledValues(t);
  duckGainNode.gain.setValueAtTime(duckGainNode.gain.value, t);
  duckGainNode.gain.linearRampToValueAtTime(1 - amount, t + 0.04);
  duckGainNode.gain.exponentialRampToValueAtTime(1, t + dur);
}

/* Each instrument uses an oscillator and gain envelope feeding dry and reverb paths. */
function voice(freq, t, dur, type, vol, opts = {}) {
  const c = getAc();
  if (!c || !ensureGraph()) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (opts.detune) o.detune.setValueAtTime(opts.detune, t);
  const atk = opts.atk ?? 0.012;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = g;
  if (opts.cutoff) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = opts.cutoff;
    g.connect(f);
    node = f;
  }
  /* Pan two detuned layers apart to widen the synthesized pad. */
  if (opts.pan != null && c.createStereoPanner) {
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, opts.pan));
    node.connect(p);
    node = p;
  }
  o.connect(g);
  node.connect(dryGain);
  if (opts.wet !== false) node.connect(delayA);
  o.start(t);
  o.stop(t + dur + 0.06);
}

function drum(kind, t) {
  const c = getAc();
  if (!c || !ensureGraph()) return;
  if (kind === 'k') {                      /* Kick: a descending sine pitch. */
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.13);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(g); g.connect(dryGain);
    o.start(t); o.stop(t + 0.2);
    return;
  }
  /* Snare and hi-hat: filtered noise. */
  const len = kind === 's' ? 0.16 : 0.05;
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * len)), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  if (kind === 's') { f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8; }
  else { f.type = 'highpass'; f.frequency.value = 8000; }
  const g = c.createGain();
  g.gain.setValueAtTime(kind === 's' ? 0.075 : 0.028, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f); f.connect(g);
  g.connect(dryGain);
  if (kind === 's') g.connect(delayA);
  src.start(t);
}

/* Sequencer. */
let current = null;
let step = 0;
let nextTime = 0;
let timer = null;
let waveBoost = 0;

function schedule() {
  const c = getAc();
  if (!c || !current || isMusicMuted()) return;
  const T = TRACKS[current];
  const bpm = T.bpm + waveBoost;
  const stepDur = 60 / bpm / 4;                 // Sixteenth note.
  const barSteps = 16;

  while (nextTime < c.currentTime + 0.5) {
    if (nextTime < c.currentTime) nextTime = c.currentTime + 0.05;
    const i = step % barSteps;
    const bar = Math.floor(step / barSteps) % T.chords.length;
    const [root, shape] = T.chords[bar];
    /* Swing delays alternating sixteenth notes slightly. */
    const t = nextTime + (i % 2 === 1 ? stepDur * (T.swing || 0) : 0);

    /* Sustain the full pad chord on the first step of each bar. */
    if (i === 0 && T.pad) {
      const dur = stepDur * barSteps * 0.98;
      for (const s of shape) {
        voice(NOTE(root + s, T.pad.base), t, dur, 'sawtooth', T.pad.vol, { atk: 0.12, cutoff: T.pad.cutoff, detune: -6, pan: -0.38 });
        voice(NOTE(root + s, T.pad.base), t, dur, 'sawtooth', T.pad.vol * 0.8, { atk: 0.14, cutoff: T.pad.cutoff, detune: +7, pan: +0.38 });
      }
    }
    /* Arpeggiate chord tones. */
    if (T.arp) {
      const idx = T.arp.steps[i];
      if (idx != null) {
        const s = shape[idx % shape.length] + (idx >= shape.length ? 12 : 0);
        /* Subtle alternating pan reduces arpeggio monotony. */
        voice(NOTE(root + s, T.arp.base), t, T.arp.len, T.arp.type, T.arp.vol, { pan: (i % 4 - 1.5) * 0.16 });
      }
    }
    /* Bass. */
    if (T.bass) {
      const off = T.bass.steps[i];
      if (off != null) {
        voice(NOTE(root + off, T.bass.base), t, T.bass.len, T.bass.type, T.bass.vol, { wet: false, cutoff: 700 });
      }
    }
    /* Drums. */
    if (T.drums) {
      const ch = T.drums[i];
      if (ch && ch !== '.') drum(ch, t);
    }

    nextTime += stepDur;
    step++;
  }
}

export const music = {
  setTrack(name) {
    if (current === name) return;
    if (!TRACKS[name]) return;
    current = name;
    step = 0;
    const c = getAc();
    nextTime = c ? c.currentTime + 0.08 : 0;
    if (!timer) timer = setInterval(schedule, 130);
  },
  stop() {
    current = null;
    if (timer) { clearInterval(timer); timer = null; }
  },
  /* Battle tempo rises with wave number, capped at +26 BPM. */
  setWave(w) { waveBoost = Math.min(26, w * 1.6); },
  duck(amount = 0.4, dur = 0.4) { duckBgm(amount, dur); },
  sync() {
    const c = getAc();
    if (c && current) nextTime = c.currentTime + 0.08;
  },
};
