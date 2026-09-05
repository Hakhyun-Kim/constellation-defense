/* Demo-mode overlay for the dedicated viewer: connection status, live session
 * facts, the architecture and command-flow diagrams, the code map, honest
 * progress notes, and the controls — including the one that matters to a
 * reviewer: switching the server demo off and just playing the game. */

const TEXT = {
  en: {
    title: 'Dedicated server · live view',
    subtitle: 'Everything on screen is simulated on the server. This browser holds no game rules — it renders snapshots.',
    connecting: 'Connecting…', connected: 'Connected', disconnected: 'Reconnecting…',
    role: { viewer: 'viewer', controller: 'controller' },
    downgraded: 'control key rejected — watching as viewer',
    session: (s) => `session #${s.id} · seed ${s.seed} · ${s.difficulty} · ${s.profile} bot`,
    live: (v) => `wave ${v.wave} · castle ${v.castleHp}/${v.castleMax} · ${v.phase} · tick ${v.tick} · ${v.viewers} watching`,
    tryGame: '🎮 Try the game yourself',
    tryGameHint: 'Stops watching and starts a fresh local run on this device.',
    backToWatch: '📡 Back to the server demo',
    pause: '⏸ Pause', resume: '▶ Resume', restart: '🔄 Restart session', speed: 'Speed',
    controlDenied: 'The server refused: controller key required.',
    archTitle: 'Architecture',
    flowTitle: 'Command flow',
    codeTitle: 'Code map',
    progressTitle: 'Progress & roadmap',
    flow: [
      'The host takes a decision with the shared bot policy (same information as a player).',
      'The decision runs as a pure engine command; the engine returns events.',
      'Snapshots (20 Hz in combat) and events broadcast to every client.',
      'Clients merge snapshots into their scene — rules never run here.',
      'Controller commands (pause/speed/restart) are key-authenticated; viewers are read-only.',
    ],
    code: [
      ['dedicated/server.mjs', 'WebSocket endpoint, hello/auth roles, broadcast'],
      ['dedicated/host.mjs', 'authoritative session: engine + balance + bot policy'],
      ['dedicated/ws.mjs', 'RFC 6455 server, no runtime dependencies'],
      ['src/app/dedicated-client.js', 'snapshot merge + motion smoothing, no rules'],
      ['src/engine/ · src/balance/', 'pure simulation shared with the balance gate'],
      ['scripts/dedicated-check.mjs', 'executable protocol contract (npm run dedicated:check)'],
      ['clients/unity · clients/unreal', 'engine client samples written to the same contract'],
    ],
    progress: [
      ['done', 'Server-authoritative session; this page renders only snapshots'],
      ['done', 'Viewer/controller roles enforced and covered by the conformance check'],
      ['done', 'Same bot policy as the balance gate drives the hosted demo'],
      ['next', 'Single client edge: store traffic brokered to the payment service'],
      ['next', 'Player input through the server (web first, then engine clients)'],
      ['next', 'Unity/Unreal viewers grown from the included protocol samples'],
    ],
    decisions: {
      start: (d) => `▶ New session (seed ${d.seed})`,
      travel: (d) => `🧭 Traveling to ${d.name || d.node}`,
      path: (d) => `⛳ Route chosen: ${d.name || d.key}`,
      recruit: (d) => `✦ Recruited ${d.heroKey}`,
      heroSkill: (d) => `✦ Specialization: ${d.skill}`,
      skill: (d) => `✨ Keeper skill: ${d.key}`,
      castle: (d) => `🏰 Castle upgrade: ${d.key}`,
      startWave: (d) => `⚔️ Wave ${d.wave} begins`,
      tactic: (d) => {
        const best = (d.casts || []).find((c) => c.ok);
        return best ? `🌌 Tactic: ${best.kind} ×${best.size} → lane ${best.route + 1}` : '🌌 Tactic swap';
      },
      ult: () => '🌌 Galaxy ultimate!',
      star: () => '☄️ Starfall support',
      constellationAid: (d) => `✦ Constellation Guardian → lane ${d.route + 1}`,
      blueprint: (d) => `🐾 Blueprint ally → lane ${d.route + 1}`,
      heroActive: (d) => `⚡ Hero active: ${d.heroKey}`,
      defeat: (d) => `💤 Defense fell at wave ${d.wave} — restarting shortly`,
      complete: (d) => `🏆 Expedition complete at wave ${d.wave}`,
      chapter: (d) => `📖 Next chapter: ${d.chapter}`,
      stalled: () => '⏳ Session stalled — restarting',
    },
  },
  ko: {
    title: '데디케이티드 서버 · 실시간 관전',
    subtitle: '화면의 모든 것은 서버에서 시뮬레이션됩니다. 이 브라우저는 게임 규칙 없이 스냅샷만 렌더링합니다.',
    connecting: '연결 중…', connected: '연결됨', disconnected: '재연결 중…',
    role: { viewer: '뷰어', controller: '컨트롤러' },
    downgraded: '컨트롤 키 거부 — 뷰어로 관전합니다',
    session: (s) => `세션 #${s.id} · 시드 ${s.seed} · ${s.difficulty} · ${s.profile} 봇`,
    live: (v) => `웨이브 ${v.wave} · 성 ${v.castleHp}/${v.castleMax} · ${v.phase} · 틱 ${v.tick} · 관전 ${v.viewers}명`,
    tryGame: '🎮 게임 테스트해보기',
    tryGameHint: '관전을 끄고 이 기기에서 새 로컬 게임을 시작합니다.',
    backToWatch: '📡 서버 데모로 돌아가기',
    pause: '⏸ 일시정지', resume: '▶ 재개', restart: '🔄 세션 재시작', speed: '배속',
    controlDenied: '서버가 거부했습니다: 컨트롤러 키가 필요합니다.',
    archTitle: '아키텍처',
    flowTitle: '명령 흐름',
    codeTitle: '코드 구조',
    progressTitle: '진행 상황 · 로드맵',
    flow: [
      '호스트가 공유 봇 정책으로 결정합니다 (플레이어와 같은 공개 정보).',
      '결정은 순수 엔진 명령으로 실행되고, 엔진이 이벤트를 돌려줍니다.',
      '스냅샷(전투 중 20Hz)과 이벤트가 모든 클라이언트로 방송됩니다.',
      '클라이언트는 스냅샷을 장면에 병합합니다 — 규칙은 여기서 돌지 않습니다.',
      '컨트롤러 명령(정지/배속/재시작)은 키 인증, 뷰어는 읽기 전용입니다.',
    ],
    code: [
      ['dedicated/server.mjs', 'WebSocket 엔드포인트 · hello/역할 인증 · 방송'],
      ['dedicated/host.mjs', '권위 세션: 엔진 + 밸런스 + 봇 정책'],
      ['dedicated/ws.mjs', 'RFC 6455 서버, 런타임 의존성 없음'],
      ['src/app/dedicated-client.js', '스냅샷 병합 + 이동 보간, 규칙 없음'],
      ['src/engine/ · src/balance/', '밸런스 게이트와 공유하는 순수 시뮬레이션'],
      ['scripts/dedicated-check.mjs', '실행 가능한 프로토콜 계약 (npm run dedicated:check)'],
      ['clients/unity · clients/unreal', '같은 계약으로 작성한 엔진 클라이언트 샘플'],
    ],
    progress: [
      ['done', '서버 권위 세션 — 이 화면은 스냅샷만 렌더링'],
      ['done', '뷰어/컨트롤러 역할 강제 + 프로토콜 검증 통과'],
      ['done', '밸런스 게이트와 같은 봇 정책이 데모를 구동'],
      ['next', '단일 접점: 상점 트래픽을 이 서버가 결제 서비스로 중계'],
      ['next', '서버 경유 플레이어 입력 (웹 → 엔진 클라이언트 순)'],
      ['next', '동봉된 샘플에서 Unity/Unreal 뷰어로 확장'],
    ],
    decisions: {
      start: (d) => `▶ 새 세션 시작 (시드 ${d.seed})`,
      travel: (d) => `🧭 ${d.name || d.node}(으)로 이동`,
      path: (d) => `⛳ 경로 선택: ${d.name || d.key}`,
      recruit: (d) => `✦ ${d.heroKey} 영입`,
      heroSkill: (d) => `✦ 전문화: ${d.skill}`,
      skill: (d) => `✨ 별지기 스킬: ${d.key}`,
      castle: (d) => `🏰 성 강화: ${d.key}`,
      startWave: (d) => `⚔️ ${d.wave}웨이브 시작`,
      tactic: (d) => {
        const best = (d.casts || []).find((c) => c.ok);
        const lane = ['왼쪽', '가운데', '오른쪽'];
        return best ? `🌌 전술: ${best.kind} ×${best.size} → ${lane[best.route]} 길` : '🌌 전술 스왑';
      },
      ult: () => '🌌 은하수 궁극기!',
      star: () => '☄️ 별똥별 지원',
      constellationAid: (d) => `✦ 성좌 수호자 → ${['왼쪽', '가운데', '오른쪽'][d.route]} 길`,
      blueprint: (d) => `🐾 설계도 지원 → ${['왼쪽', '가운데', '오른쪽'][d.route]} 길`,
      heroActive: (d) => `⚡ 영웅 액티브: ${d.heroKey}`,
      defeat: (d) => `💤 ${d.wave}웨이브에서 방어 실패 — 곧 재시작`,
      complete: (d) => `🏆 ${d.wave}웨이브, 원정 완료`,
      chapter: (d) => `📖 다음 장: ${d.chapter}`,
      stalled: () => '⏳ 세션 정지 — 재시작합니다',
    },
  },
};

/* Inline architecture diagram; CSS variables keep it readable on the game background. */
function architectureSvg(en) {
  const t = en
    ? { web: 'Web viewer', unity: 'Unity sample', unreal: 'Unreal sample', ws: 'WebSocket :8643 · hello {role, key}', dedi: 'Dedicated server', host: 'session host · engine + bot', pay: 'Payment API :8642 (separate)', neon: 'Neon webhooks' }
    : { web: '웹 뷰어', unity: 'Unity 샘플', unreal: 'Unreal 샘플', ws: 'WebSocket :8643 · hello {역할, 키}', dedi: '데디케이티드 서버', host: '세션 호스트 · 엔진 + 봇', pay: '결제 API :8642 (분리)', neon: 'Neon 웹훅' };
  const box = (x, y, w, h, label, cls = '') =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" class="dc-box ${cls}"/>` +
    `<text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" class="dc-label">${label}</text>`;
  const line = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="dc-line"/>`;
  return `<svg viewBox="0 0 340 232" role="img" aria-label="${t.dedi}">
    ${box(6, 6, 100, 30, t.web, 'dc-client')}
    ${box(120, 6, 100, 30, t.unity, 'dc-client dc-sample')}
    ${box(234, 6, 100, 30, t.unreal, 'dc-client dc-sample')}
    ${line(56, 36, 168, 62)}${line(170, 36, 170, 62)}${line(284, 36, 172, 62)}
    <text x="170" y="56" text-anchor="middle" class="dc-note">${t.ws}</text>
    ${box(60, 64, 220, 32, t.dedi, 'dc-server')}
    ${box(60, 100, 220, 30, t.host, 'dc-host')}
    ${line(170, 130, 170, 152)}
    <text x="170" y="147" text-anchor="middle" class="dc-note">src/engine · src/balance · src/bot</text>
    ${box(60, 154, 220, 30, en ? 'pure simulation (also used by the balance gate)' : '순수 시뮬레이션 (밸런스 게이트와 공유)', 'dc-engine')}
    ${box(14, 198, 190, 28, t.pay, 'dc-pay')}
    ${box(216, 198, 110, 28, t.neon, 'dc-pay')}
    ${line(204, 212, 216, 212)}
  </svg>`;
}

export function initDedicatedOverlay({ locale, client, onTryGame, backUrl }) {
  const en = locale === 'en';
  const t = TEXT[en ? 'en' : 'ko'];
  const root = document.querySelector('#dedicatedPanel');
  if (!root) return null;
  root.classList.remove('hidden');
  document.body.classList.add('dedicated-on');

  root.innerHTML = `
    <header class="dp-head">
      <div class="dp-titlerow"><span class="dp-dot" id="dpDot"></span><strong>${t.title}</strong></div>
      <p class="dp-sub">${t.subtitle}</p>
      <p class="dp-conn" id="dpConn">${t.connecting}</p>
      <p class="dp-session" id="dpSession"></p>
      <p class="dp-live" id="dpLive"></p>
      <p class="dp-caption" id="dpCaption"></p>
    </header>
    <div class="dp-actions">
      <button id="dpTryGame" class="dp-primary">${t.tryGame}</button>
      <span class="dp-hint">${t.tryGameHint}</span>
    </div>
    <div class="dp-controls" id="dpControls">
      <button id="dpPause">${t.pause}</button>
      <button id="dpRestart">${t.restart}</button>
      <span class="dp-speed">${t.speed}
        <button data-speed="1" class="on">1×</button>
        <button data-speed="2">2×</button>
        <button data-speed="4">4×</button>
      </span>
      <span class="dp-denied hidden" id="dpDenied">${t.controlDenied}</span>
    </div>
    <details open class="dp-section"><summary>${t.archTitle}</summary>
      <div class="dp-arch">${architectureSvg(en)}</div>
    </details>
    <details class="dp-section"><summary>${t.flowTitle}</summary>
      <ol class="dp-flow">${t.flow.map((step) => `<li>${step}</li>`).join('')}</ol>
    </details>
    <details class="dp-section"><summary>${t.codeTitle}</summary>
      <ul class="dp-code">${t.code.map(([file, note]) => `<li><code>${file}</code><span>${note}</span></li>`).join('')}</ul>
    </details>
    <details class="dp-section"><summary>${t.progressTitle}</summary>
      <ul class="dp-progress">${t.progress.map(([kind, note]) => `<li class="${kind}">${kind === 'done' ? '✅' : '⏳'} ${note}</li>`).join('')}</ul>
    </details>`;

  const get = (id) => root.querySelector(`#${id}`);
  let paused = false;
  let lastLive = null;

  get('dpTryGame').addEventListener('click', () => onTryGame?.());
  get('dpPause').addEventListener('click', async () => {
    const result = await client.command(paused ? 'resume' : 'pause');
    if (result.ok) { paused = !paused; get('dpPause').textContent = paused ? t.resume : t.pause; }
    get('dpDenied').classList.toggle('hidden', result.ok || result.error !== 'forbidden');
  });
  get('dpRestart').addEventListener('click', async () => {
    const result = await client.command('restart');
    get('dpDenied').classList.toggle('hidden', result.ok || result.error !== 'forbidden');
  });
  for (const button of root.querySelectorAll('[data-speed]')) {
    button.addEventListener('click', async () => {
      const result = await client.command('speed', { value: Number(button.dataset.speed) });
      if (result.ok) {
        for (const other of root.querySelectorAll('[data-speed]')) other.classList.toggle('on', other === button);
      }
      get('dpDenied').classList.toggle('hidden', result.ok || result.error !== 'forbidden');
    });
  }

  return {
    /* Small floating chip shown while the reviewer plays locally. */
    minimize() {
      root.classList.add('hidden');
      document.body.classList.remove('dedicated-on');
      const chip = document.createElement('button');
      chip.id = 'dpReturnChip';
      chip.textContent = t.backToWatch;
      chip.addEventListener('click', () => location.assign(backUrl));
      document.body.append(chip);
    },
    setStatus(status) {
      get('dpDot').className = `dp-dot ${status.connected ? 'ok' : 'bad'}`;
      const role = status.role ? ` · ${t.role[status.role] || status.role}` : '';
      const down = status.downgraded ? ` · ${t.downgraded}` : '';
      get('dpConn').textContent = (status.connected ? t.connected : t.disconnected) + role + down;
      if (status.session) get('dpSession').textContent = t.session(status.session);
      if (lastLive) get('dpLive').textContent = t.live({ ...lastLive, viewers: status.viewers, tick: status.tick });
    },
    setLive(view) {
      lastLive = view;
      get('dpLive').textContent = t.live(view);
    },
    caption(decision) {
      const build = t.decisions[decision.action];
      if (!build) return null;
      const text = build(decision);
      get('dpCaption').textContent = text;
      return text;
    },
  };
}
