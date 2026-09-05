/* Share pure performance calculations between the browser probe and Node checks. */
export function summarizeFrameDurations(durations) {
  const clean = durations.filter((value) => Number.isFinite(value) && value > 0);
  if (!clean.length) return Object.freeze({ frames: 0, avgFps: 0, avgFrameMs: 0, p95FrameMs: 0 });
  const total = clean.reduce((sum, value) => sum + value, 0);
  const sorted = [...clean].sort((a, b) => a - b);
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return Object.freeze({
    frames: clean.length,
    avgFps: clean.length * 1000 / total,
    avgFrameMs: total / clean.length,
    p95FrameMs: sorted[p95Index],
  });
}
