/* =====================================================
 * 전술 보드 화면 어댑터
 *
 * 여기에는 DOM, 선택, 애니메이션 취소만 둔다. 3매치 규칙은 tactics/board.js,
 * 방어 효과는 주입받은 resolveTactic()이 담당하므로 어느 한쪽도 다른 쪽을
 * import하거나 상태 구조를 알 필요가 없다.
 * ===================================================== */
import {
  BOARD_SIZE,
  STAR_TYPES,
  areNeighbors,
  cellIndex,
  createStableBoard,
  findMatchGroups,
  laneForGroup,
  refillCells,
  swipeNeighbor,
  swapCells,
} from '../tactics/board.js';

const ICON = { flare: '✦', tide: '✧', bloom: '❋' };
const LABEL = { flare: '유성 폭격', tide: '서리 결계', bloom: '수호 회복' };
const ROUTE_LABEL = ['왼쪽', '가운데', '오른쪽'];

export function createTacticFlow({ getPhase, random, resolveTactic, onCast, onMatch, onPreview, onSwap, toast }) {
  const board = document.getElementById('tacticBoard');
  const status = document.getElementById('tacticStatus');
  const card = board.closest('.tactic-card');
  let cells = [];
  let selected = null;
  let resolving = false;
  let openingRefill = null;
  let generation = 0;
  let gesture = null;
  let suppressClickUntil = 0;
  const timers = new Set();
  const ix = (row, col) => cellIndex(row, col, BOARD_SIZE);

  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };

  function cancelPending() {
    generation++;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    resolving = false;
  }

  function make() {
    cells = createStableBoard(random, BOARD_SIZE);
    draw();
  }

  function draw() {
    board.innerHTML = cells.map((type, index) =>
      `<button class="tactic-star ${type}${selected === index ? ' picked' : ''}" data-i="${index}" aria-label="${LABEL[type]}">${ICON[type]}</button>`
    ).join('');
  }

  /* A tap still selects two adjacent stars, while a short swipe exchanges the
   * touched star with the neighbour in that direction. Pointer events keep the
   * same path for mouse, pen, and touch without duplicating board rules. */
  board.addEventListener('click', (event) => {
    if (performance.now() < suppressClickUntil) return;
    const button = event.target.closest('button[data-i]');
    if (button) choose(Number(button.dataset.i));
  });
  board.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('button[data-i]');
    if (!button || resolving) return;
    gesture = { pointerId: event.pointerId, index: Number(button.dataset.i), x: event.clientX, y: event.clientY };
    button.setPointerCapture?.(event.pointerId);
  });
  board.addEventListener('pointercancel', () => { gesture = null; });
  board.addEventListener('pointerup', (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const start = gesture;
    gesture = null;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 14) return;
    suppressClickUntil = performance.now() + 320;
    if (getPhase() !== 'wave') {
      toast('전술 보드는 웨이브 중에만 사용할 수 있어요.', 'warn');
      return;
    }
    const target = swipeNeighbor(start.index, dx, dy, BOARD_SIZE);
    if (target == null) return;
    if (!attemptSwap(start.index, target)) {
      status.textContent = '별자리가 이어지지 않았어요. 다른 방향으로 밀어 보세요.';
      selected = null;
      draw();
    }
  });

  function clearVisuals() {
    board.classList.remove('casting');
    board.style.removeProperty('--tactic-glow');
    delete board.dataset.matchSize;
    delete card.dataset.matchSize;
    delete card.dataset.tactic;
    card.querySelectorAll('.tactic-routes span.active').forEach(element =>
      element.classList.remove('active', ...STAR_TYPES)
    );
    card.querySelector('.tactic-beam')?.remove();
  }

  /* 표현 콜백(SFX·렌더러·토스트)은 전술 규칙 바깥에 있다. 어느 하나가 실패해도
   * 보드가 resolving 상태에 남아 입력이 멎으면 안 된다. */
  function recoverResolution(token) {
    if (token !== generation) return;
    resolving = false;
    selected = null;
    clearVisuals();
    draw();
    status.textContent = '별자리를 다시 정렬했어요. 다른 별을 바꿔 보세요.';
  }

  function showBeam(hit, lane, type) {
    const matchedCells = hit.map(index => board.querySelector(`button[data-i="${index}"]`)).filter(Boolean);
    const target = card.querySelector(`.tactic-routes span[data-route="${lane}"]`);
    if (!matchedCells.length || !target) return;

    const cardRect = card.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const from = matchedCells.reduce((sum, element) => {
      const rect = element.getBoundingClientRect();
      sum.x += rect.left + rect.width / 2;
      sum.y += rect.top + rect.height / 2;
      return sum;
    }, { x: 0, y: 0 });
    from.x /= matchedCells.length;
    from.y /= matchedCells.length;
    const to = { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const beam = document.createElement('div');
    beam.className = `tactic-beam ${type}`;
    beam.style.left = `${from.x - cardRect.left}px`;
    beam.style.top = `${from.y - cardRect.top}px`;
    beam.style.width = `${Math.hypot(dx, dy)}px`;
    beam.style.setProperty('--beam-angle', `${Math.atan2(dy, dx)}rad`);
    card.appendChild(beam);
    void beam.offsetWidth;
    beam.classList.add('run');
    target.classList.add('active', type);
  }

  function showMatch(hit, type, lane, size) {
    clearVisuals();
    board.classList.add('casting');
    board.style.setProperty('--tactic-glow', type === 'flare' ? '#ff8b62' : type === 'tide' ? '#71dcff' : '#8eea94');
    board.dataset.matchSize = String(size);
    card.dataset.matchSize = String(size);
    card.dataset.tactic = type;
    hit.forEach(index => {
      const element = board.querySelector(`button[data-i="${index}"]`);
      if (element) element.classList.add('matched', type, ...(size >= 4 ? ['jackpot'] : []));
    });
    showBeam(hit, lane, type);
  }

  function attemptSwap(first, index) {
    if (resolving || getPhase() !== 'wave' || !areNeighbors(first, index, BOARD_SIZE)) return false;
    const swapped = swapCells(cells, first, index);
    const matches = findMatchGroups(swapped, BOARD_SIZE);
    if (!matches.length) return false;
    selected = null;
    cells = swapped;
    /* 교환된 보드를 먼저 보여 준다. 이전 셀을 그대로 두면 매치 강조가 실제 바뀐 별과
     * 어긋나 보여 전술의 원인을 읽기 어려워진다. */
    draw();
    card.classList.remove('guided-opening');
    onSwap?.(first, index, matches);
    resolveQueue(matches);
    return true;
  }

  function choose(index) {
    if (resolving) return;
    if (getPhase() !== 'wave') {
      toast('전술 보드는 웨이브 중에만 사용할 수 있어요.', 'warn');
      return;
    }
    if (selected == null) {
      selected = index;
      draw();
      return;
    }

    const first = selected;
    selected = null;
    if (!areNeighbors(first, index, BOARD_SIZE)) {
      selected = index;
      draw();
      return;
    }

    if (!attemptSwap(first, index)) {
      status.textContent = '별자리가 이어지지 않았어요. 다른 별을 바꿔 보세요.';
      draw();
    }
  }

  function resolveQueue(queue, token = generation) {
    if (token !== generation) return;
    const hit = queue.shift();
    if (!hit) {
      resolving = false;
      selected = null;
      clearVisuals();
      draw();
      later(() => {
        if (token !== generation) return;
        const cascade = findMatchGroups(cells, BOARD_SIZE);
        if (cascade.length) resolveQueue(cascade, token);
      }, 130);
      return;
    }

    resolving = true;
    const type = cells[hit[0]];
    const lane = laneForGroup(hit, BOARD_SIZE, 3);
    const size = Math.min(5, hit.length);
    try {
      status.textContent = `${ROUTE_LABEL[lane]} 길 · ${LABEL[type]} ${size >= 5 ? '별똥별 준비!' : size === 4 ? '강화 준비!' : '연결!'}`;
      showMatch(hit, type, lane, size);
      onMatch?.(type, lane, size);
    } catch (error) {
      console.error('Tactic match presentation failed', error);
      recoverResolution(token);
      return;
    }
    later(() => {
      try {
        if (token !== generation) return;
        const result = resolveTactic(lane, type, size);
        if (openingRefill && openingRefill.length === hit.length) {
          cells = [...cells];
          hit.forEach((index, offset) => { cells[index] = openingRefill[offset]; });
          openingRefill = null;
        } else cells = refillCells(cells, hit, random);
        clearVisuals();
        if (result.ok) {
          status.textContent = `${ROUTE_LABEL[lane]} 길 · ${LABEL[type]} ${size >= 5 ? '별똥별!' : size === 4 ? '강화!' : '발동!'}`;
          onCast(result, type, lane, size);
        } else {
          status.textContent = '별자리는 이어졌지만 그 길에 적이 없어요.';
        }
        draw();
        later(() => resolveQueue(queue, token), 45);
      } catch (error) {
        console.error('Tactic resolution failed', error);
        recoverResolution(token);
      }
    }, 210);
  }

  function reset() {
    cancelPending();
    selected = null;
    openingRefill = null;
    clearVisuals();
    make();
  }

  function preview(type = 'flare', lane = 1, size = 3) {
    if (!STAR_TYPES.includes(type) || resolving) return false;
    const safeLane = Math.max(0, Math.min(2, Math.round(lane)));
    const safeSize = Math.max(3, Math.min(5, Math.round(size)));
    const hit = Array.from({ length: safeSize }, (_, row) => ix(row, safeLane * 2));
    const originalCells = cells;
    const token = generation;
    resolving = true;
    cells = [...cells];
    hit.forEach(index => { cells[index] = type; });
    draw();
    status.textContent = `테스트 · ${ROUTE_LABEL[safeLane]} 길 ${LABEL[type]} ${safeSize}개`;
    showMatch(hit, type, safeLane, safeSize);
    later(() => {
      if (token !== generation) return;
      cells = originalCells;
      clearVisuals();
      resolving = false;
      draw();
      onPreview?.(type, safeLane, safeSize);
    }, 250);
    return true;
  }

  make();
  return {
    reset,
    preview,
    setOpening(opening) {
      if (!opening || !Array.isArray(opening.cells) || opening.cells.length !== BOARD_SIZE * BOARD_SIZE) return false;
      if (findMatchGroups(opening.cells, BOARD_SIZE).length) return false;
      cancelPending();
      selected = null;
      cells = [...opening.cells];
      openingRefill = Array.isArray(opening.refill) ? [...opening.refill] : null;
      clearVisuals();
      draw();
      card.classList.add('guided-opening');
      const from = board.querySelector(`button[data-i="${opening.from}"]`);
      const to = board.querySelector(`button[data-i="${opening.to}"]`);
      from?.classList.add('guided-from');
      to?.classList.add('guided-to');
      status.textContent = '첫 지휘 · 빛나는 두 별을 바꿔 가운데 길에 유성을 내리세요.';
      return !!from && !!to;
    },
    getBoard: () => [...cells],
    swap(first, second) {
      if (!Number.isInteger(first) || !Number.isInteger(second)) return false;
      return attemptSwap(first, second);
    },
  };
}
