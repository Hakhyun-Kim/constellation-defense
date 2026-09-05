/* Shared pure battlefield geometry: paths, pads and coordinate helpers. Changes here are level design and affect engine, rendering and bots. */

/* Logical battlefield is 700 by 408; y=0 is the top. */
export const FIELD_W = 700;
export const FIELD_H = 408;

/* Three paths split after the bottom portal and converge at the gate. The center shortcut is shorter and more dangerous. */
export const ROUTES = [
  /* Left path. */
  [[350, 430], [350, 338], [128, 338], [128, 210], [238, 210], [238, 120], [350, 120], [350, 58]],
  /* Center shortcut: fewer ordinary enemies, but bosses use it. */
  [[350, 430], [350, 338], [280, 280], [420, 220], [300, 160], [350, 120], [350, 58]],
  /* Right path. */
  [[350, 430], [350, 338], [572, 338], [572, 210], [462, 210], [462, 120], [350, 120], [350, 58]],
];
export const ROUTE_WEIGHTS = [0.4, 0.2, 0.4];
export const BOSS_ROUTE = 1;              // Bosses charge along the shortcut.
export const ROAD_HALF = 22;

/* Hero placement pads occupy pockets between paths. */
export const PADS = [
  { x: 280, y: 395 }, { x: 420, y: 395 },           // Both sides of the shared entrance.
  { x: 230, y: 282 }, { x: 470, y: 282 },           // Both sides of the fork.
  { x: 185, y: 270 }, { x: 515, y: 270 },           // Inside the left and right loops.
  { x: 180, y: 120 }, { x: 520, y: 120 },           // Upper left and right.
  { x: 262, y: 75 },  { x: 438, y: 75 },            // Before the gate at the convergence.
  { x: 135, y: 395 }, { x: 565, y: 395 },           // Outer corners.
];
export const PAD_RADIUS = 26;

/* Shared path helpers for engine, rendering and bots. */
function buildSegs(points) {
  const segs = [];
  let acc = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i], [x2, y2] = points[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    segs.push({ x1, y1, x2, y2, len, start: acc });
    acc += len;
  }
  return segs;
}
export const ROUTE_SEGS = ROUTES.map(buildSegs);
export const ROUTE_LENS = ROUTE_SEGS.map(segs => segs.reduce((a, s) => a + s.len, 0));

/* Map path progress to position and direction. */
export function routePoint(route, s) {
  const segs = ROUTE_SEGS[route];
  if (s <= 0) {
    const g = segs[0];
    return { x: g.x1, y: g.y1, dx: (g.x2 - g.x1) / g.len, dy: (g.y2 - g.y1) / g.len };
  }
  for (const seg of segs) {
    if (s <= seg.start + seg.len) {
      const t = (s - seg.start) / seg.len;
      return {
        x: seg.x1 + (seg.x2 - seg.x1) * t,
        y: seg.y1 + (seg.y2 - seg.y1) * t,
        dx: (seg.x2 - seg.x1) / seg.len,
        dy: (seg.y2 - seg.y1) / seg.len,
      };
    }
  }
  const last = segs[segs.length - 1];
  return { x: last.x2, y: last.y2, dx: (last.x2 - last.x1) / last.len, dy: (last.y2 - last.y1) / last.len };
}

/* Minimum distance from a point to any path. */
export function distToPath(x, y) {
  let best = Infinity;
  for (const segs of ROUTE_SEGS) {
    for (const seg of segs) {
      const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
      const t = Math.max(0, Math.min(1, ((x - seg.x1) * dx + (y - seg.y1) * dy) / (seg.len * seg.len)));
      const px = seg.x1 + dx * t, py = seg.y1 + dy * t;
      const d = Math.hypot(x - px, y - py);
      if (d < best) best = d;
    }
  }
  return best;
}

/* Weighted path length within a pad's attack range, used by bot placement. */
export function padCoverage(pad, range) {
  let cover = 0;
  const step = 8;
  for (let r = 0; r < ROUTES.length; r++) {
    for (let s = 0; s < ROUTE_LENS[r]; s += step) {
      const p = routePoint(r, s);
      if (Math.hypot(p.x - pad.x, p.y - pad.y) <= range) cover += step * ROUTE_WEIGHTS[r] * 2.5;
    }
  }
  return cover;
}
