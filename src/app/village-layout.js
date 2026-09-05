/* Shared, visual-only village geometry. Keeping this data pure lets the UI
 * and Three scene agree on where a building, NPC, and walkable space are. */

export const VILLAGE_START = Object.freeze({ x: 0, z: 8.8 });

export const VILLAGE_BOUNDS = Object.freeze({ minX: -10.5, maxX: 10.5, minZ: -9.6, maxZ: 9.2 });

export const VILLAGE_BUILDINGS = Object.freeze({
  forge: Object.freeze({ x: -6.4, z: 2.4, w: 1.85, d: 1.5 }),
  shrine: Object.freeze({ x: 0, z: 2.4, w: 1.95, d: 1.55 }),
  guild: Object.freeze({ x: 6.4, z: 2.4, w: 1.85, d: 1.5 }),
  well: Object.freeze({ x: 0, z: -1.7, w: 1.05, d: 1.05 }),
});

export const VILLAGE_FACILITY_SPOTS = Object.freeze({
  forge: Object.freeze({ x: -6.4, z: 4.55 }),
  shrine: Object.freeze({ x: 0, z: 4.55 }),
  guild: Object.freeze({ x: 6.4, z: 4.55 }),
});

export const VILLAGE_RECRUITER_SPOTS = Object.freeze({
  doyun: Object.freeze({ x: -5.6, z: -1.5, place: '수문 초소' }),
  sera: Object.freeze({ x: 5.6, z: -1.5, place: '전령 길드' }),
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const VILLAGE_WALK_SPEED = 6.5;
export const VILLAGE_PLAYER_RADIUS = .42;

function isBlocked(point, radius = VILLAGE_PLAYER_RADIUS) {
  return Object.values(VILLAGE_BUILDINGS).some((building) =>
    Math.abs(point.x - building.x) < building.w + radius
      && Math.abs(point.z - building.z) < building.d + radius);
}

export function villageWalkPoint(current, proposed) {
  const target = {
    x: clamp(proposed.x, VILLAGE_BOUNDS.minX, VILLAGE_BOUNDS.maxX),
    z: clamp(proposed.z, VILLAGE_BOUNDS.minZ, VILLAGE_BOUNDS.maxZ),
  };
  /* Resolve collision per axis, allowing diagonal movement to slide along unblocked walls as in dungeon100. */
  const next = { x: current.x, z: current.z };
  const xStep = { x: target.x, z: next.z };
  if (!isBlocked(xStep)) next.x = xStep.x;
  const zStep = { x: next.x, z: target.z };
  if (!isBlocked(zStep)) next.z = zStep.z;
  return next;
}

export function advanceVillage(current, input, dt, speed = VILLAGE_WALK_SPEED) {
  const length = Math.hypot(input.x || 0, input.z || 0);
  if (!length || !Number.isFinite(dt) || dt <= 0) {
    return { x: current.x, z: current.z, dirX: current.dirX || 0, dirZ: current.dirZ || -1, moving: false };
  }
  const dirX = input.x / length;
  const dirZ = input.z / length;
  /* Clamp stride length so a long frame after tab restoration cannot skip across buildings. */
  const distance = speed * Math.min(dt, .05);
  const next = villageWalkPoint(current, {
    x: current.x + dirX * distance,
    z: current.z + dirZ * distance,
  });
  return {
    ...next,
    dirX,
    dirZ,
    moving: next.x !== current.x || next.z !== current.z,
  };
}

export function isNearVillageTarget(point, target, radius = 2.1) {
  const dx = point.x - target.x;
  const dz = point.z - target.z;
  return dx * dx + dz * dz <= radius * radius;
}
