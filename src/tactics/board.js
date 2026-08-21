/* =====================================================
 * 별자리 보드 — 순수 3매치 규칙
 *
 * 이 모듈은 DOM·엔진·렌더러를 전혀 모른다. 보드 크기, 스왑, 매치 그룹,
 * 열→방어로 매핑만 책임진다. 다른 게임에도 그대로 붙일 수 있는 퍼즐 계층이다.
 * ===================================================== */

export const BOARD_SIZE = 6;
export const STAR_TYPES = Object.freeze(['flare', 'tide', 'bloom']);

export const cellIndex = (row, col, size = BOARD_SIZE) => row * size + col;
export const cellRow = (index, size = BOARD_SIZE) => Math.floor(index / size);
export const cellCol = (index, size = BOARD_SIZE) => index % size;

export function randomStar(random) {
  return STAR_TYPES[Math.floor(random() * STAR_TYPES.length)];
}

/* 처음 보드에는 자동 매치가 없어야 "내가 만든 매치"가 읽힌다. */
export function createStableBoard(random, size = BOARD_SIZE) {
  let cells;
  do cells = Array.from({ length: size * size }, () => randomStar(random));
  while (findMatchGroups(cells, size).length);
  return cells;
}

/* 매치된 셀을 같은 타입의 연결 컴포넌트로 묶는다.
 * 서로 떨어진 매치는 둘 이상의 그룹으로 남기므로 효과·대상 방어로가 섞이지 않는다. */
export function findMatchGroups(cells, size = BOARD_SIZE) {
  const hit = new Set();
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const start = cellIndex(row, col, size);
    const type = cells[start];
    const horizontal = [start], vertical = [start];
    for (let x = col + 1; x < size && cells[cellIndex(row, x, size)] === type; x++) horizontal.push(cellIndex(row, x, size));
    for (let y = row + 1; y < size && cells[cellIndex(y, col, size)] === type; y++) vertical.push(cellIndex(y, col, size));
    if (horizontal.length >= 3) horizontal.forEach(index => hit.add(index));
    if (vertical.length >= 3) vertical.forEach(index => hit.add(index));
  }

  const unseen = new Set(hit);
  const groups = [];
  while (unseen.size) {
    const first = unseen.values().next().value;
    const type = cells[first];
    const group = [];
    const stack = [first];
    unseen.delete(first);
    while (stack.length) {
      const index = stack.pop();
      group.push(index);
      const row = cellRow(index, size), col = cellCol(index, size);
      for (const [nextRow, nextCol] of [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]) {
        const next = nextRow >= 0 && nextRow < size && nextCol >= 0 && nextCol < size
          ? cellIndex(nextRow, nextCol, size) : -1;
        if (next >= 0 && unseen.has(next) && cells[next] === type) {
          unseen.delete(next);
          stack.push(next);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

/* A Hero Sigil is a five-or-more-cell match whose valid horizontal and
 * vertical runs meet at a junction.  It stays a board-only geometry decision;
 * the defense engine still receives only the promoted tactic size. */
export function matchShape(group, size = BOARD_SIZE) {
  if (!Array.isArray(group) || group.length < 3) return 'none';
  const occupied = new Set(group);
  const has = (row, col) => row >= 0 && row < size && col >= 0 && col < size
    && occupied.has(cellIndex(row, col, size));
  const rows = new Set(group.map(index => cellRow(index, size)));
  const cols = new Set(group.map(index => cellCol(index, size)));
  if (rows.size === 1 || cols.size === 1) return 'line';
  const span = (row, col, rowStep, colStep) => {
    let length = 1;
    for (const direction of [-1, 1]) {
      let nextRow = row + rowStep * direction;
      let nextCol = col + colStep * direction;
      while (has(nextRow, nextCol)) {
        length++;
        nextRow += rowStep * direction;
        nextCol += colStep * direction;
      }
    }
    return length;
  };
  for (const index of group) {
    const row = cellRow(index, size), col = cellCol(index, size);
    if (span(row, col, 1, 0) >= 3 && span(row, col, 0, 1) >= 3) return 'sigil';
  }
  return 'cluster';
}

export const isHeroSigilGroup = (group, size = BOARD_SIZE) =>
  Array.isArray(group) && group.length >= 5 && matchShape(group, size) === 'sigil';

/* Size 6 is a semantic tier, not a sixth required cell.  This preserves the
 * engine command contract while making a corner/T/cross stronger than a line. */
export const tacticSizeForGroup = (group, size = BOARD_SIZE) =>
  isHeroSigilGroup(group, size) ? 6 : Math.min(5, group?.length || 0);

export function areNeighbors(a, b, size = BOARD_SIZE) {
  const ar = cellRow(a, size), ac = cellCol(a, size);
  const br = cellRow(b, size), bc = cellCol(b, size);
  return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
}

/* Convert a pointer swipe into one orthogonal board neighbour.  Keeping this
 * coordinate decision pure makes touch input testable without a browser. */
export function swipeNeighbor(index, dx, dy, size = BOARD_SIZE) {
  if (!Number.isInteger(index) || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const row = cellRow(index, size), col = cellCol(index, size);
  const nextRow = row + (Math.abs(dy) > Math.abs(dx) ? Math.sign(dy) : 0);
  const nextCol = col + (Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0);
  if (nextRow < 0 || nextRow >= size || nextCol < 0 || nextCol >= size) return null;
  return cellIndex(nextRow, nextCol, size);
}

/* 반환값은 새 배열이다. 화면 어댑터가 스왑 전 보드를 되돌리거나 미리보기 할 때
 * 원본 상태를 잃지 않게 한다. */
export function swapCells(cells, a, b) {
  const next = [...cells];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/* 사람이 할 수 있는 인접 스왑만 열거한다. 반환하는 cells와 groups는 해당 스왑의
 * 결과이므로, 봇·테스트가 화면을 거치지 않고도 합법적인 전술 입력만 만들 수 있다. */
export function findLegalSwaps(cells, size = BOARD_SIZE) {
  const moves = [];
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const from = cellIndex(row, col, size);
    for (const [nextRow, nextCol] of [[row, col + 1], [row + 1, col]]) {
      if (nextRow >= size || nextCol >= size) continue;
      const to = cellIndex(nextRow, nextCol, size);
      const swapped = swapCells(cells, from, to);
      const groups = findMatchGroups(swapped, size);
      if (groups.length) moves.push({ from, to, cells: swapped, groups });
    }
  }
  return moves;
}

export function refillCells(cells, indices, random) {
  const next = [...cells];
  for (const index of indices) next[index] = randomStar(random);
  return next;
}

/* 6열은 세 방어로를 두 열씩 맡는다. 보드 크기를 넘겨도 laneCount 기준으로 동작한다. */
export function laneForGroup(group, size = BOARD_SIZE, laneCount = 3) {
  const averageCol = group.reduce((sum, index) => sum + cellCol(index, size), 0) / group.length;
  return Math.min(laneCount - 1, Math.floor(averageCol / (size / laneCount)));
}
