import { CONTENT_EN } from './i18n-content.js';

export const SUPPORTED_LOCALES = Object.freeze(['ko', 'en']);

export function normalizeLocale(value) {
  return String(value || '').toLowerCase().startsWith('en') ? 'en' : 'ko';
}

const EN = new Map(Object.entries({
  ...CONTENT_EN,
  '지난 모험이 자동 저장돼 있어요': 'Your previous adventure was saved automatically.',
  '이전': 'Previous',
  '다음': 'Next',
  '투어 끝내기': 'Close tour',
  '웨이브': 'Wave',
  '방어': 'Defense',
  '성 체력': 'Citadel HP',
  '도감': 'Codex',
  '도감·기록': 'Codex & Records',
  '별의 축복': 'Star Blessings',
  '🎬 CONSTELLATION DEFENSE · 보드가 곧 전장입니다': '🎬 CONSTELLATION DEFENSE · The board is the battlefield',
  '3D 방어는 멈추지 않습니다. 오른쪽 별자리판을 실시간으로 바꿔 세 길에 명령합니다.': 'The 3D defense never pauses. You command three lanes by rearranging the constellation board in real time.',
  '① 위치가 길을, 색이 명령을 고릅니다': '① Position picks the lane, colour picks the order',
  '왼쪽·가운데·오른쪽 열은 방어로를, Flare·Tide·Bloom은 피해·감속·회복을 정합니다.': 'Left, centre and right columns choose the lane; Flare, Tide and Bloom choose damage, slow or healing.',
  '② 퍼즐은 영웅 기술의 충전 장치입니다': '② The puzzle is what charges hero abilities',
  '매치 색과 연결된 아린·루나·도윤·세라·유나의 액티브가 더 빨리 돌아옵니다.': 'Matching a colour shortens the cooldown of the hero tied to it — Arin, Luna, Doyun, Sera or Yuna.',
  '③ ㄱ·T·십자 5칸 = HERO SIGIL': '③ Five in an L, T or cross = HERO SIGIL',
  '영웅 액티브 8초 충전 · 강화 전술 · 보스까지 아껴 쓸 성좌 수호자 3/3을 한 번에 완성합니다.': 'Eight seconds off a hero ability, a stronger tactic, and a full 3/3 Constellation Guardian to bank for the boss.',
  '🧭 같은 영웅단이 별자리 원정을 계속합니다': '🧭 The same party carries on through the expedition',
  '전투 사이에는 길과 마을을 고르고, 동료 영입과 전문화 선택을 다음 방어까지 이어 갑니다.': 'Between battles you choose roads and towns; recruits and specializations carry into the next defense.',
  '🛡 전투 전 준비도 짧고 의미 있게': '🛡 Preparation is short, and it matters',
  '고정 영웅단의 위치·전문화·성 강화를 정한 뒤 카운트다운이 다음 방어를 자동 시작합니다.': 'Set positions, specializations and citadel upgrades; a countdown then starts the next defense on its own.',
  '⚔ 실시간 방어 시작 · 퍼즐 중에도 적은 전진합니다': '⚔ The defense is live — enemies advance while you solve',
  '가장 위험한 길을 읽고, 그 순간 필요한 색과 문양을 선택해야 합니다.': 'Read the lane in the most danger, then pick the colour and shape that lane needs right now.',
  '🌌 실제 인접 스왑이 전장 명령으로 이어졌습니다': '🌌 A real adjacent swap just became a battlefield order',
  '열의 평균 위치가 대상 길을 정하고, 맞춘 별의 색과 개수가 효과를 정합니다.': 'The average column decides the target lane; the colour and count of matched stars decide the effect.',
  '✦ HERO SIGIL · 영웅 성좌 문양 완성!': '✦ HERO SIGIL · constellation mark complete!',
  '실제 합법 스왑으로 가로·세로 3칸이 교차했습니다. 액티브 -8초 · 성좌 수호자 즉시 3/3.': 'A legal swap crossed three horizontally with three vertically. Ability −8s, Guardian straight to 3/3.',
  '⚡ 퍼즐과 연결된 영웅 액티브를 사용합니다': '⚡ Spending a hero ability the puzzle charged',
  '매치는 남은 쿨다운을 되돌립니다. 준비된 고유 기술은 전투를 멈추지 않고 아래 퀵바에서 즉시 사용합니다.': 'Matches wind the cooldown back. A ready ability fires straight from the quick bar without pausing the fight.',
  '✦ 저장해 둔 성좌 수호자를 지금 호출합니다': '✦ Calling in the Guardian that was banked',
  '큰 매치의 보상은 즉시 소모되지 않습니다. 보스나 무너지는 길을 기다렸다 집중 지원합니다.': 'A big match is not spent on the spot. It waits for a boss, or for the lane that is about to break.',
  'VICTORY · 다음 방어까지 긴장을 이어 갑니다': 'VICTORY · the pressure carries to the next defense',
  '짧은 승리 확인과 눈에 보이는 카운트다운 뒤, 같은 지역의 다음 방어가 자동으로 시작됩니다.': 'A brief victory beat, a visible countdown, and the next defense in the same region begins on its own.',
  '🐉 라이브 액터 보스 컷인': '🐉 Live-actor boss cut-in',
  '컷인 속 모델이 그대로 전장에 진입합니다. 모아 둔 문양·영웅 액티브·성좌 지원을 겹쳐 쓸 순간입니다.': 'The model from the cut-in walks straight into the battlefield. This is the moment to stack marks, abilities and Guardian support.',
  '✕ 관전 끝내기 (D)': '✕ End spectate (D)',
  '밸런스 봇과 같은 실제 플레이 규칙': 'The same play rules the balance bot uses',
  '실제 플레이 규칙으로 진행 중': 'Running under real play rules',
  '난이도': 'Difficulty',
  '❓ 조작법': '❓ Controls',
  '⏹ 관전 끝': '⏹ End spectate',
  '호위대와 함께 진군': 'Advancing with the escort',
  '다음 방어가 시작됩니다': 'The next defense is starting',
  '초 뒤 자동 시작 · Space로 즉시 시작': 's until auto-start · Space to begin now',
  '😵 쓰러짐': '😵 Down',
  '처음이시죠?': 'First time here?',
  '적 대기': 'Enemies waiting',
  '✕ 취소': '✕ Cancel',
  '영웅단': 'Party',
  '성장': 'Growth',
  '별자리 전술': 'Constellation Tactics',
  '별자리는 이어졌지만 그 길에 적이 없어요.': 'The constellation connected, but that lane has no enemies.',
  '🟩 빈 발판 = 배치 · 🟦 찬 발판 = 자리 교환 · ←→ 고르고 Enter': '🟩 Empty pad = deploy · 🟦 Taken pad = swap · ←→ to choose, Enter to confirm',
  '💰 여러 명 판매': '💰 Sell several',
  '전체 선택': 'Select all',
  '팔기': 'Sell',
  '가득': 'Full',
  '잔치 벌이기': 'Hold a Feast',
  '🔄 처음부터 다시 도전! (Enter)': '🔄 Try again from the start! (Enter)',
  '📖 도감 · 기록': '📖 Codex · Records',
  '성은 무너지지 않았다. 별자리가 길을 지켰기 때문이다.': 'The citadel did not fall, because the constellation held the roads.',
  '별지기의 성장은 그대로, 용사·골드·성은 처음부터 · 몬스터가 훨씬 세져요': 'Stargazer growth carries over; heroes, gold and citadel restart — and the monsters get much stronger',
  '▶ 계속 지키기 (Enter)': '▶ Keep defending (Enter)',
  '축복은 다음 게임부터 적용돼요!': 'Blessings apply from the next run onward.',
  '이름과 모습은 이 기기에 저장돼요.': 'The name and look are saved on this device.',
  '다음 판에도 그대로 이어져요!': 'They carry into the next run.',
  '이걸로 입을래! (저장)': 'Wear this (save)',
  '✨ 루나의 별자리': "✨ Luna's Constellation",
  '같은 별자리의 별을 먼저 밝혀야 다음 별이 열려요!': 'Light the earlier star in a constellation before the next one opens.',
  '🎵 배경음악': '🎵 Music',
  '이 별길은 아직 조용합니다.': 'This star road is still quiet.',
  '방어 성공!': 'Defense held!',
  '전문화 1P 준비': '1 specialization point ready',
  '발동 가능': 'Ready',
  '🌊 도달한 웨이브:': '🌊 Wave reached:',
  '👾 물리친 몬스터:': '👾 Monsters defeated:',
  '✦ 영웅단 최고 레벨': '✦ Highest party level',
  '· ✧ 선택한 전문화': '· ✧ Specializations chosen',
  '🌌 별자리 전술판으로 세 갈래 길을 지켰어요': '🌌 You held three lanes with the constellation board',
  '이번 수호의 기억': 'What this defense is remembered for',
  '🌠 가장 큰 성좌': '🌠 Largest constellation',
  '아직 기록되지 않음': 'Not recorded yet',
  '🛡️ 집중 방어': '🛡️ Focused defense',
  '세 길을 고르게 방어': 'Held all three lanes evenly',
  '💚 결정적 회복': '💚 Decisive healing',
  '회복 없이 끝까지 버팀': 'Held to the end without healing',
  '🗺️ 원정 경로': '🗺️ Expedition route',
  '별조각으로': 'Spend star shards on',
  '을 받으면 다음 도전이 쉬워져요!': 'to make the next run easier.',
  '서리': 'Frost',
  '유성': 'Meteor',
  '수호': 'Guardian',
  '서리 성좌': 'Frost constellation',
  '유성 성좌': 'Meteor constellation',
  '수호 성좌': 'Guardian constellation',
  '별을 누르거나 밀어 영웅 전술을 발동': 'Tap or drag stars to trigger hero tactics',
  '웨이브가 시작되면 별들이 깨어나요.': 'The stars wake when the wave begins.',
  '피해': 'Damage',
  '사거리': 'Range',
  '레벨업 포인트로 전문화를 고르세요': 'Spend level-up points on a specialization',
  '전투에서 얻은 전문화 포인트는 원정 지도 속 마을 시설에서만 사용합니다.': 'Specialization points earned in battle are spent only at town facilities on the expedition map.',
  '전투 처치와 웨이브 완료로 경험치를 얻습니다. 포인트가 생기면 한 영웅의 역할을 깊게 만드세요.': 'Kills and completed waves grant experience. When a point arrives, deepen one hero’s role with it.',
  '별빛 상점': 'Celestial Store',
  '별빛 개척자 깃발': 'Celestial Pioneer Banner',
  'AI 관전': 'AI Spectate',
  '관전 끝내기': 'End Spectate',
  '보스 접근!': 'Boss approaching!',
  '보스': 'Boss',
  '별자리 전술판': 'Constellation Tactics',
  '세 칸 이상 맞추면 그 열의 길에 마법을 내려요': 'Match 3+ to cast on the lane below that column.',
  '영웅 액티브': 'Hero Active',
  '오른쪽 영웅 카드를 선택하세요': 'Select a hero card on the right.',
  '카드 선택': 'Select Hero',
  '몬스터 청사진': 'Monster Blueprint',
  '시장 분기에서 기록한 동료를 소환합니다': 'Summon the ally recorded on the market route.',
  '소환 대기': 'Awaiting Summon',
  '세 방어로 압력': 'Three-lane pressure',
  '왼쪽': 'Left',
  '가운데': 'Center',
  '오른쪽': 'Right',
  '안전': 'Clear',
  '접근': 'Approach',
  '압박': 'Pressure',
  '위기': 'Critical',
  '지휘관': 'Commander',
  '대보스': 'Great Boss',
  '별자리 3매치 전술판': 'Constellation match-3 tactics board',
  '같은 별 5개를 ㄱ·T·십자로 맞추면 영웅 성좌 문양': 'Match 5 stars in an L, T, or cross to form a Hero Sigil.',
  '4·5매치와 영웅 문양으로 성좌 인장을 모으세요': 'Build marks with 4/5 matches and Hero Sigils.',
  '아린·세라': 'Arin · Sera',
  '루나·유나': 'Luna · Yuna',
  '수호 영웅단': 'Guardian Party',
  '카드를 눌러 위치를 바꾸세요': 'Select cards to reposition heroes.',
  '영웅 성장': 'Hero Growth',
  '레벨업 때 전문화를 고르세요': 'Choose specializations on level up.',
  '성': 'Citadel',
  '성 관리': 'Citadel Management',
  '골드로 성을 강화해요': 'Spend gold to reinforce the citadel.',
  '용사': 'Hero',
  '선택한 용사': 'Selected Hero',
  '벤치로 회수': 'Recall to Bench',
  '판매': 'Sell',
  '이어하기': 'Continue',
  '처음부터 시작하기': 'Start New Game',
  '웨이브가 끝날 때마다 자동 저장돼요 · 💾 버튼으로 파일 저장도 됩니다': 'Autosaves after every defense. You can also export a save with 💾.',
  '성이 함락되었어요…': 'The citadel has fallen…',
  '처음부터 다시 도전!': 'Try Again from the Start!',
  '기록 카드': 'Run Card',
  '몬스터': 'Monsters',
  '업적': 'Achievements',
  '전술': 'Tactics',
  '닫기': 'Close',
  '서른 번째 아침': 'The Thirtieth Dawn',
  '계속 지키기': 'Keep Defending',
  '별의 시련 — 더 강한 마왕군에 도전!': 'Star Trial — Face a stronger army!',
  '별지기의 옷장': "Stargazer's Wardrobe",
  '이름': 'Name',
  '이걸로 입을래!': 'Wear This',
  '별지기의 별자리': "Stargazer's Constellation",
  '스킬 포인트': 'Skill Points',
  '계속': 'Continue',
  '이야기 그만 보기': 'Hide Story',
  '아무 키나 눌러 계속': 'Press any key to continue',
  '설정': 'Settings',
  '브라우저와 데스크톱 데모가 같은 설정을 사용합니다.': 'Browser and desktop demos share the same settings.',
  '언어': 'Language',
  '한국어': 'Korean',
  '영어': 'English',
  '그래픽 품질': 'Graphics Quality',
  'High · 선명한 장면': 'High · Rich scene',
  'Lite · 빠른 렌더링': 'Lite · Faster rendering',
  '국소 효과': 'Local Effects',
  '절제 · 파티클 적게': 'Reduced · Fewer particles',
  '생동감 · 파티클 많게': 'Lively · More particles',
  '효과음 켜짐': 'SFX On',
  '효과음 꺼짐': 'SFX Off',
  '배경음 켜짐': 'Music On',
  '배경음 꺼짐': 'Music Off',
  '단축키': 'Shortcuts',
  '바꿀 기능을 누른 뒤 새 키를 누르세요.': 'Select an action, then press its new key.',
  '새 키…': 'New key…',
  '기본 키로 되돌리기': 'Restore Default Keys',
  '완료': 'Done',
  '브라우저 사이트 저장소': 'Browser site storage',
  '데스크톱 앱 데이터 폴더': 'Desktop app data folder',
  '별똥별': 'Falling Star',
  '은하수': 'Milky Way',
  '별지기 별자리': 'Stargazer Skills',
  '영웅 성장 탭': 'Hero Growth Tab',
  '빠른 조합': 'Quick Combine',
  '전체 음소거': 'Mute All',
  '게임 속도': 'Game Speed',
  '배치 영웅 선택': 'Cycle Deployed Hero',
  '영웅 회수': 'Recall Hero',
  '영웅 판매': 'Sell Hero',
  '성 수리': 'Repair Citadel',
  '성벽 강화': 'Reinforce Walls',
  '마법 포탑': 'Arcane Turret',
  '쉬움': 'Easy',
  '보통': 'Normal',
  '어려움': 'Hard',
  '아린': 'Arin',
  '루나': 'Luna',
  '도윤': 'Doyun',
  '세라': 'Sera',
  '유나': 'Yuna',
  '전방 처형': 'Frontline Execution',
  '별자리 마도사': 'Constellation Mage',
  '길 저지': 'Lane Control',
  '원거리 관통': 'Ranged Pierce',
  '범위 제어': 'Area Control',
  '성광 일섬': 'Radiant Slash',
  '성운 폭발': 'Nebula Burst',
  '수호 장벽': 'Guardian Wall',
  '유성 연사': 'Meteor Volley',
  '서리 성운': 'Frost Nebula',
  '고블린': 'Goblin',
  '늑대': 'Wolf',
  '오크': 'Orc',
  '트롤': 'Troll',
  '주술사': 'Shaman',
  '박쥐떼': 'Bat Swarm',
  '바위골렘': 'Stone Golem',
  '오우거 군주': 'Ogre Lord',
  '해골 장군': 'Bone General',
  '거미 여왕': 'Spider Queen',
  '보스 드래곤': 'Boss Dragon',
  '고대 파괴자': 'Ancient Destroyer',
  '여명의 성도': 'Pilgrimage of Dawn',
  '성문 밖, 흩어진 별의 동료를 찾아라': 'Beyond the gate, find the scattered starbound allies.',
  '별문': 'Star Gate',
  '푸른 초원': 'Verdant Meadow',
  '달의 유물': 'Lunar Relic',
  '갈림길 마을': 'Crossroads Village',
  '별 관측소': 'Star Observatory',
  '은빛 야영지': 'Silver Camp',
  '붉은 성문': 'Ember Gate',
  '게이트 너머의 다음 페이지': 'The Next Page Beyond the Gate',
  '현실과 책 세계를 잇는 두 번째 책갈피를 찾아라': 'Find the second bookmark joining reality and the book world.',
  '넘겨진 성문': 'Turned Gate',
  '서울 제7게이트': 'Seoul Gate Seven',
  '두 개의 설명': 'Two Explanations',
  '임시 헌터 길드': 'Provisional Hunter Guild',
  '지하 몬스터 시장': 'Underground Monster Market',
  '피난민 역촌': 'Refugee Station',
  '교정관의 사냥': "The Corrector's Hunt",
  '무명 서고': 'Nameless Archive',
  '세 개의 교정문': 'Three Correction Gates',
  '원고핵 성채': 'Manuscript Core Citadel',
  '봉합': 'Seal',
  '공동 집필': 'Co-author',
  '출발': 'Start',
  '전투': 'Battle',
  '보물': 'Treasure',
  '마을': 'Town',
  '동료': 'Ally',
  '야영': 'Camp',
  '선택': 'Choice',
  '단서': 'Clue',
  '현재 위치에서 이어진 별길만 선택할 수 있습니다.': 'You may choose only a star road connected to your current position.',
  '다음 장 펼치기': 'Open the Next Chapter',
  '이 결말 선택': 'Choose This Ending',
  '마을 광장 다시 둘러보기': 'Return to the Town Square',
  '시설': 'Facilities',
  '지도 보기': 'View Map',
  '가까운 사람 또는 시설 찾기': 'Find a nearby person or facility',
  '방문': 'Visit',
  '와 대화': 'Talk',
  '효과음': 'SFX',
  '배경음': 'Music',
  '저자극': 'Reduced',
  '생동감': 'Lively',
  '관전': 'Spectate',
  '유성 폭격!': 'Meteor Strike!',
  '유성: 공격': 'Flare: damage',
  '서리: 감속': 'Tide: slow',
  '수호: 회복·밀치기': 'Bloom: heal & push',
  '첫 지휘 · 빛나는 두 별을 바꿔 가운데 길에 유성을 내리세요.': 'First command · Swap the two glowing stars to cast Flare on the center lane.',
  '새벽의 검 · 검사': 'Blade of Dawn · Knight',
  '별빛의 현자 · 마법사': 'Sage of Starlight · Mage',
  '검사': 'Knight',
  '수호자': 'Guardian',
  '궁수': 'Archer',
  '마법사': 'Mage',
  '그래픽 품질은 다음 실행부터 적용됩니다. 전체 화면 점멸은 어떤 설정에서도 사용하지 않습니다.': 'Graphics quality applies on the next launch. Full-screen flashes are disabled in every mode.',
  '운영체제의 동작 줄이기 설정이 켜져 있어 절제 효과를 유지합니다. 전체 화면 점멸은 항상 금지됩니다.': 'Reduced motion is enabled by the operating system. Reduced effects remain active and full-screen flashes stay disabled.',
  '중간보스가 졸개들을 이끌고 세 길을 압박해요!': 'A commander and its minions are pressuring all three lanes!',
  '지역 대보스와 중간보스 호위대가 함께 진군해요!': 'The regional great boss advances with commander escorts!',
  '영웅 카드를 눌러 방어로 옆 발판에 배치하세요': 'Select a hero card, then place it on a pad beside a lane.',
  '아린과 루나는 무너진 성문을 지나 별빛 길로 나선다.': 'Arin and Luna cross the ruined gate onto a road of starlight.',
  '먼저 다가오는 무리를 막아 길을 확보한다.': 'Defend against the approaching horde and secure the road.',
  '빛나는 보급품이 성의 방어를 보탠다.': "Luminous supplies reinforce the citadel's defenses.",
  '광장을 걸으며 동료를 설득하고, 대장간·신전·길드에서 전문화를 고른다.': 'Walk the square, recruit an ally, and choose specializations at its facilities.',
  '별의 파동을 읽는 유나가 길을 함께한다.': 'Yuna, who reads the pulse of stars, joins the road.',
  '성문을 향하기 전, 잠시 전열을 가다듬는다.': 'Regroup before the march to the gate.',
  '성도를 노리는 군세의 지휘관이 길을 막는다.': 'The commander of the army targeting the pilgrimage blocks the road.',
  '붉은 성문 뒤에서 출구가 아니라 넘겨지지 않은 다음 장이 열린다.': 'Beyond Ember Gate waits not an exit, but an unturned next chapter.',
  '무너진 도심에서 현실 헌터와 별빛 영웅단이 처음 마주친다.': 'Real-world hunters meet the starbound party in a ruined city.',
  '헌터 연합과 여백회가 서로 다른 방식으로 같은 재난을 설명한다.': 'The Hunter Union and Margin Society explain the same disaster in opposing ways.',
  '현실 장비와 질서를 택한다. 역촌에는 헌터 구조대가 합류한다.': 'Choose real-world equipment and order. A hunter rescue team joins the station.',
  '몬스터의 증언을 듣는다. 청사진 권한의 흔적을 확보한다.': 'Hear the monsters’ testimony and recover a trace of blueprint authority.',
  '구조 인원과 선택한 세력에 따라 사람·시설·대사가 달라지는 두 번째 마을.': 'A second town whose people, facilities, and dialogue reflect your rescues and allegiance.',
  '중간보스와 졸개가 편대로 밀려오고, 플레이어의 명령이 적에게도 들린다.': 'A commander advances with minions—and the enemy can hear your orders.',
  '현실 기억과 초고 0호가 처음 쓰인 기록을 발견한다.': 'Discover real memories and the first record of Draft Zero.',
  '중간보스 둘과 졸개가 세 길을 동시에 막는 최종 전초전.': 'The final approach: two commanders and their minions lock down all three lanes.',
  '초고 0호와 살아남은 교정관 편성을 넘어 두 번째 책갈피를 되찾는다.': 'Defeat Draft Zero and the surviving Correctors to reclaim the second bookmark.',
}));

const PATTERNS = Object.freeze([
  [/^(\d+)웨이브$/, 'Wave $1'],
  [/^▶ (\d+)웨이브 시작!$/, '▶ Start Wave $1!'],
  [/^방어 (\d+)\/(\d+)$/, 'Defense $1/$2'],
  [/^전투 · 방어 (\d+)\/(\d+)$/, 'Battle · Defense $1/$2'],
  [/^로컬 기록 (\d+)개$/, '$1 local records'],
  [/^💾 저장 위치 · (.+)$/, '💾 Save location · $1'],
  [/^완료 \(Esc\)$/, 'Done (Esc)'],
  [/^닫기 \(Esc\)$/, 'Close (Esc)'],
  [/^계속 \(Enter\)$/, 'Continue (Enter)'],
  [/^⏩ 이어하기 \(Enter\)$/, '⏩ Continue (Enter)'],
]);

let activeLocale = 'ko';

export function setLocale(value) { activeLocale = normalizeLocale(value); return activeLocale; }
export function getLocale() { return activeLocale; }

export function translateKnownText(value, locale = activeLocale) {
  if (normalizeLocale(locale) !== 'en' || typeof value !== 'string') return value;
  const leading = value.match(/^\s*/)?.[0] || '';
  const trailing = value.match(/\s*$/)?.[0] || '';
  const core = value.slice(leading.length, value.length - trailing.length);
  let translated = EN.get(core);
  if (!translated) {
    const decorated = core.match(/^([^\p{L}\p{N}]*)(.+)$/u);
    const inner = decorated && EN.get(decorated[2]);
    if (inner) translated = `${decorated[1]}${inner}`;
  }
  if (!translated) {
    let match = core.match(/^([^\p{L}\p{N}]*)(.+) 등장!$/u);
    if (match) translated = `${match[1]}${EN.get(match[2]) || match[2]} Appears!`;
    match ||= core.match(/^(.+) 길$/);
    if (!translated && match) translated = `${EN.get(match[1]) || match[1]} Lane`;
    match = core.match(/^(.+) · 방어 (\d+)\/(\d+) · 남은 몬스터 (\d+)$/);
    if (match) translated = `${EN.get(match[1]) || match[1]} · Defense ${match[2]}/${match[3]} · ${match[4]} remaining`;
    match = core.match(/^🌊 (\d+)웨이브 시작! 몬스터를 막아요!$/);
    if (match) translated = `🌊 Wave ${match[1]} started! Defend the citadel!`;
    match = core.match(/^(\d+)\/(\d+)방어$/);
    if (match) translated = `Defense ${match[1]}/${match[2]}`;
    match = core.match(/^(.+) · (\d+)$/);
    if (match && EN.has(match[1])) translated = `${EN.get(match[1])} · ${match[2]}`;
    /* 전문화 카드는 데이터의 효과 문구 뒤에 필요 레벨을 덧붙인다 — 앞부분은
     * 표에서 찾고 꼬리만 옮긴다. 이렇게 해야 밸런스 수치가 바뀌어도 번역이
     * 따라간다: 조합된 문장 전체를 표에 넣으면 숫자 하나에 깨진다. */
    match = core.match(/^(.+) · Lv (\d+) 필요$/);
    if (match) translated = `${EN.get(match[1]) || match[1]} · Lv ${match[2]} required`;
    match = core.match(/^범위 (\d+) · (.+)$/);
    if (match) translated = `Range ${match[1]} · ${EN.get(match[2]) || match[2]}`;
    match = core.match(/^치명 (\d+)% · ×([\d.]+)$/);
    if (match) translated = `Crit ${match[1]}% · ×${match[2]}`;
    match = core.match(/^다음 포인트까지 (\d+) XP$/);
    if (match) translated = `${match[1]} XP to next point`;
    match = core.match(/^경험치 (\d+)\/(\d+) · 전문화 포인트$/);
    if (match) translated = `XP ${match[1]}/${match[2]} · specialization points`;
    /* 시설 안내는 아이콘 + 시설 이름 + 고정 문장이다. 시설 이름은 콘텐츠 표에 있다. */
    match = core.match(/^(\S+)\s(.+)에서만 전문화를 선택할 수 있습니다\.$/);
    if (match) translated = `${match[1]} Specializations are chosen only at the ${EN.get(match[2]) || match[2]}.`;
    /* 전투 토스트는 아이콘·별 종류·개수·길이 조합된다. 조합된 문장을 통째로
     * 표에 넣으면 숫자 하나마다 새 항목이 필요해지므로 조각을 각각 옮긴다. */
    match = core.match(/^(\S+) (서리|유성|수호) 성좌 (\d+)개 — (왼쪽|가운데|오른쪽) 길 전술 발동!$/);
    if (match) {
      translated = `${match[1]} ${EN.get(match[2])} constellation ×${match[3]} — cast on the ${EN.get(match[4])} lane!`;
    }
    match = core.match(/^(왼쪽|가운데|오른쪽) 길 · (.+) 영웅 성좌 문양!$/);
    if (match) translated = `${EN.get(match[1])} lane · ${EN.get(match[2]) || match[2]} Hero Sigil!`;
    match = core.match(/^👊 중간보스 호위 (.+) 격파! 💰(\d+)$/);
    if (match) translated = `👊 Commander escort ${EN.get(match[1]) || match[1]} defeated! 💰${match[2]}`;
    match = core.match(/^👊 (.+) 격파! 💰(\d+)$/);
    if (!translated && match) translated = `👊 ${EN.get(match[1]) || match[1]} defeated! 💰${match[2]}`;
    match = core.match(/^성 \+(\d+) · (\d+)명 후퇴$/);
    if (match) translated = `Citadel +${match[1]} · ${match[2]} pushed back`;
    match = core.match(/^([\d.]+)초$/);
    if (match) translated = `${match[1]}s`;
    /* 게임오버 통계는 숫자·난이도·보상이 문장에 박혀 나온다. */
    match = core.match(/^\((쉬움|보통|어려움)\)$/);
    if (match) translated = `(${EN.get(match[1])})`;
    match = core.match(/^(\d+)마리$/);
    if (match) translated = `${match[1]}`;
    match = core.match(/^✨ 별조각 \+(\d+) 획득!$/);
    if (match) translated = `✨ +${match[1]} star shards earned!`;
    /* 전술 적중 표시와 콤보는 전투 내내 갱신된다 — 숫자와 이름이 매번 바뀌므로
     * 통째로 표에 넣을 수 없다. */
    match = core.match(/^(\d+)매치 · (.+)$/);
    if (match) translated = `${match[1]}-match · ${EN.get(match[2]) || match[2]}`;
    match = core.match(/^(왼쪽|가운데|오른쪽) 길 길을 조준해요$/);
    if (match) translated = `Aiming at the ${EN.get(match[1])} lane`;
    match = core.match(/^(왼쪽|가운데|오른쪽) 길 · (.+) 연결!$/);
    if (match) translated = `${EN.get(match[1])} lane · ${EN.get(match[2]) || match[2]} linked!`;
    match = core.match(/^⏩ 이어하기 — (\d+)웨이브부터 \(Enter\)$/);
    if (match) translated = `⏩ Continue from Wave ${match[1]} (Enter)`;
    match = core.match(/^(?:웨이브|Wave) (\d+) · (.+) 난이도 · 🧍 용사 (\d+)명$/);
    if (match) translated = `Wave ${match[1]} · ${translateKnownText(match[2], 'en')} difficulty · ${match[3]} heroes`;
    match = core.match(/^🔥 콤보 (\d+)$/);
    if (match) translated = `🔥 Combo ${match[1]}`;
    /* 방어 완료 보너스와 레벨업 안내 — 판이 계속 돌면 반복해서 뜬다. */
    match = core.match(/^(.+) · 방어 (\d+)\/(\d+) 완료! 보너스 (\d+)$/);
    if (match) translated = `${EN.get(match[1]) || match[1]} · Defense ${match[2]}/${match[3]} complete! Bonus ${match[4]}`;
    match = core.match(/^(.+) Lv (\d+)! 영웅 성장 탭에서 전문화를 고르세요$/);
    if (match) translated = `${EN.get(match[1]) || match[1]} Lv ${match[2]}! Choose a specialization in the Hero Growth tab`;
    match = core.match(/^([^\p{L}\p{N}]*)(.+) · 방어 (\d+)\/(\d+)[를을] 준비하세요\.?$/u);
    if (match) translated = `${match[1]}${EN.get(match[2]) || match[2]} · Prepare defense ${match[3]}/${match[4]}.`;
    match = core.match(/^💾 저장 위치 · (.+)$/);
    if (match) translated = `💾 Save location · ${EN.get(match[1]) || match[1]}`;
    match = core.match(/^⚠️ (중간보스|대보스) (.+) 접근(!+)$/);
    if (match) translated = `⚠️ ${match[1] === '대보스' ? 'Great boss' : 'Commander'} ${translateKnownText(match[2], 'en')} approaching${match[3]}`;
  }
  if (!translated) {
    for (const [pattern, replacement] of PATTERNS) {
      if (pattern.test(core)) { translated = core.replace(pattern, replacement); break; }
    }
  }
  return translated ? `${leading}${translated}${trailing}` : value;
}

function translateElementAttributes(element, locale) {
  for (const name of ['title', 'aria-label', 'placeholder']) {
    const value = element.getAttribute?.(name);
    if (!value) continue;
    const translated = translateKnownText(value, locale);
    if (translated !== value) element.setAttribute(name, translated);
  }
}

export function localizeSubtree(root, locale = activeLocale) {
  if (normalizeLocale(locale) !== 'en' || !root) return;
  if (root.nodeType === 3) {
    const translated = translateKnownText(root.nodeValue, locale);
    if (translated !== root.nodeValue) root.nodeValue = translated;
    return;
  }
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
  if (root.nodeType === 1) translateElementAttributes(root, locale);
  const walker = root.ownerDocument?.createTreeWalker(root, 5);
  if (walker) {
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === 3) localizeSubtree(node, locale);
      else translateElementAttributes(node, locale);
      node = walker.nextNode();
    }
  }
}

export function installDocumentLocalization(locale = activeLocale, documentRef = globalThis.document) {
  const normalized = setLocale(locale);
  if (!documentRef) return null;
  documentRef.documentElement.lang = normalized;
  documentRef.title = normalized === 'en' ? 'Constellation Defense' : '🌌 Constellation Defense';
  localizeSubtree(documentRef.body, normalized);
  if (normalized !== 'en' || typeof MutationObserver !== 'function') return null;
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') localizeSubtree(mutation.target, normalized);
      for (const node of mutation.addedNodes || []) localizeSubtree(node, normalized);
    }
  });
  observer.observe(documentRef.body, { childList: true, subtree: true, characterData: true });
  return observer;
}

export const translationEntries = () => [...EN.entries()];
