/* Story presentation uses current BEATS/ENGLISH_BEATS only. Inactive LEGACY_BEATS provides historical seenStory-key context and is removed from the bundle. Current fiction follows hunters, gates and responsibility for creation. */

const LEGACY_BEATS = {
  prologue: {
    icon: '📜', title: '왕국 최후의 방어선',
    lines: [
      '마왕군이 쳐들어온다는 소식이 왔다.',
      '왕국의 마지막 방어선은 이 성 하나.',
      '그리고 성을 지킬 사람은 — 너 한 명.',
      '',
      '［ 병력: 0명 · 골드: 조금 · 자신감: 확인 중 ］',
    ],
  },
  w1: {
    icon: '🐢', title: '제일 느린 부대',
    lines: [
      '고블린들이 도망갔다.',
      '알고 보니 마왕군에서 제일 발이 느린 부대였다.',
      '',
      '…제일 느린 부대를 제일 먼저 보내다니, 마왕은 순서를 모르는 걸까?',
    ],
  },
  w2: {
    icon: '⚗️', title: '왕국의 이상한 산수',
    lines: [
      '이 왕국의 마법은 좀 이상하다.',
      '용사 두 명을 합치면, 더 센 용사 한 명이 된다.',
      '',
      '2 − 1 = 1. 수학적으로는 맞다. 감정적으로는 좀 그렇다.',
    ],
  },
  w3: {
    icon: '🧮', title: '정찰병의 보고',
    lines: [
      '정찰병이 돌아왔다.',
      '「마왕이 병력을 세다가 틀렸답니다. 자꾸 틀린답니다.」',
      '',
      '그래서 오늘은 예정보다 많이 온다고 한다.',
      '셈을 못 하는 게 이렇게 무서운 일이었다.',
    ],
  },
  w4: {
    icon: '👹', title: '커다란 게 온다',
    lines: [
      '커다란 게 온다.',
      '',
      '「…혹시 대화로 해결할 수는 없나요?」',
      '없다. 옛날에 어떤 병사가 열두 번 물어봤는데, 열두 번 다 없었다.',
      '',
      '자, 자리로.',
    ],
  },
  w5: {
    icon: '🏆', title: '1군단장의 마지막 말',
    lines: [
      '마왕군 1군단장을 물리쳤다.',
      '군단장은 쓰러지며 외쳤다. 「이럴 리가 없다! 우리가 훨씬 많았는데!」',
      '',
      '…많긴 했다. 세는 걸 못 했을 뿐이지.',
    ],
  },
  w10: {
    icon: '🌙', title: '열 번째 밤',
    lines: [
      '열 번째 밤.',
      '적은 줄지 않는다. 오히려 늘었다.',
      '',
      '문득 궁금해졌다. 마왕은 대체 몇 명을 가지고 있는 걸까.',
      '…아마 마왕도 모를 것이다.',
    ],
  },
  w15: {
    icon: '📖', title: '숫자였던 것들',
    lines: [
      '붙잡은 고블린에게 물었다.',
      '「너희는 왜 자꾸 오는 거야?」',
      '「몰라요. 우리도 그냥… 숫자였어요. 세어지려고 태어났대요.」',
      '',
      '처음으로, 이기고 있는데 기분이 이상했다.',
    ],
  },
  w20: {
    icon: '🕯️', title: '끝을 정하는 쪽',
    lines: [
      '마왕은 계산을 못 한다.',
      '그래서 끝을 정하지 못했다. 언제까지 보내야 하는지 모르니까.',
      '',
      '이 전쟁을 끝낼 수 있는 건, 결국 셈을 아는 쪽이다.',
      '…그게 너다.',
    ],
  },
  w25: {
    icon: '⭐', title: '성벽 위의 셈',
    lines: [
      '성벽 위에서 병사들이 조용히 무언가를 세고 있었다.',
      '남은 화살, 남은 시간, 남은 사람.',
      '누가 시킨 것도 아닌데.',
      '',
      '숫자를 세는 법을 배운 쪽이, 결국 끝을 정한다.',
    ],
  },
  w30: {
    icon: '🌅', title: '서른 번째 아침',
    lines: [
      '서른 번의 밤을 버텼다.',
      '왕국 역사서에 이런 문장이 적혔다.',
      '「성은 무너지지 않았다. 셈이 맞았기 때문이다.」',
      '',
      '역사가는 이 문장이 무슨 뜻인지 아직 모른다고 한다.',
    ],
  },
  firstLegend: {
    icon: '👑', title: '전설의 조건',
    lines: [
      '전설의 용사가 깨어났다.',
      '전설은 아무나 되는 게 아니다.',
      '정확히 두 명분의 재료와, 문제 한 개가 필요하다.',
      '',
      '…듣고 보니 조건이 꽤 구체적이다.',
    ],
  },
  firstMythic: {
    icon: '🌌', title: '역사서의 오타',
    lines: [
      '신화 등급.',
      '왕국 역사서에 딱 세 번 나오는 단어다.',
      '그중 두 번은 오타였다.',
      '',
      '이번엔 진짜다.',
    ],
  },
  castleHurt: {
    icon: '🧱', title: '성벽 담당관',
    lines: [
      '성벽에 금이 갔다.',
      '성벽 담당관이 말했다. 「괜찮습니다. 금은 원래 있었습니다.」',
      '',
      '없었다.',
    ],
  },
  champIntro: {
    icon: '🌠', title: '왕국 최후의 기사',
    lines: [
      '성문 앞에서 누군가 손을 흔든다.',
      '별지기 {name} — 왕국에 마지막으로 남은 기사다.',
      '「제가 길을 지킬게요! 몬스터 수는… 세다가 놓쳤지만요.」',
      '',
      '괜찮다. 세는 건 이쪽이 한다. {name}는 베면 된다.',
      '［ 별똥별: A · 은하수: E · 별자리: V · 초상을 누르면 옷장 ］',
    ],
  },
};

/* The campaign follows a player entering hunter fiction and discovering responsibility for both heroes and monsters. Retired prototype text is not used at runtime. Locale changes presentation only; progression and beat keys are identical. */
export const BEATS = {
  prologue: {
    icon: '▤', title: '책이 먼저 너를 읽었다',
    lines: [
      '2026년 서울. 《게이트 최후의 수호자》의 마지막 장이 비어 있었다.',
      '페이지를 넘긴 순간, 네 손끝에서 별길과 몬스터가 동시에 태어났다.',
      '',
      '아린은 하늘을 올려다봤다. 「명령하는 분, 적어도 성은 우리 편 맞죠?」',
      '대답할 버튼은 없었다. 방어 버튼만 있었다.',
    ],
  },
  w1: {
    icon: '⚔️', title: '들리는 명령',
    lines: ['첫 방어가 시작됐다.', '아린뿐 아니라 반대편 몬스터도 네 클릭 소리에 고개를 들었다.', '', '이 세계에서는 명령이 공용 채널인 모양이다. 보안 담당자는 아직 생성되지 않았다.'],
  },
  w2: {
    icon: '🔮', title: '루나의 첫 민원',
    lines: ['루나가 별자리 판을 올려다봤다.', '「저 별 세 개를 맞추면 길에 마법이 떨어지는 거죠?」', '그렇다.', '「그럼 왜 설명서는 전투 시작 뒤에 뜨죠?」', '', '그건 정말 미안하다.'],
  },
  w3: {
    icon: '📱', title: '현실의 재난 알림',
    lines: ['허공에 서울 재난 문자가 겹쳐 떴다.', '［ 제7게이트 위험 등급 상향 · 인근 헌터는 대피를 지원하십시오 ］', '', '소설 속 성벽과 현실의 지하철역이 같은 좌표를 가리키고 있었다.'],
  },
  w4: {
    icon: '♜', title: '교정관이 온다',
    lines: ['졸개들이 세 길로 흩어지고, 그 뒤에서 지휘관이 걸어왔다.', '혼자 강한 적보다 명령을 듣는 편대가 더 위험하다.', '', '세라는 활시위를 당겼다. 「이번엔 튜토리얼 아니죠?」', '아쉽게도 실전이다.'],
  },
  w5: {
    icon: '🖋️', title: '죽은 문장의 기억',
    lines: ['쓰러진 지휘관의 갑옷 안쪽에 같은 문장이 수십 번 적혀 있었다.', '［ 생성됨 · 명령받음 · 삭제됨 · 다시 생성됨 ］', '', '몬스터는 사라졌지만 문장은 남았다.', '네가 만든 것들은 네가 기억하지 않아도 너를 기억한다.'],
  },
  w10: {
    icon: '🏢', title: '헌터 길드의 견적서',
    lines: ['임시 헌터 길드가 성벽 보수 견적을 보냈다.', '재료비, 위험 수당, 차원 간 출장비가 적혀 있었다.', '', '마지막 항목은 「주인공 할인: 0%」였다. 현실적이었다.'],
  },
  w15: {
    icon: '👺', title: '몬스터 시장의 증언',
    lines: ['지하 시장의 몬스터들은 인간을 공격하지 않았다.', '그들은 누가 자신을 만들었는지 알고 싶어 했다.', '', '김대리가 도장을 들었다. 「책임 소재부터 교정하시죠. 전투 지원은 그다음입니다.」'],
  },
  w20: {
    icon: '▧', title: '초고 0호',
    lines: ['무명 서고에서 가장 먼저 생성된 몬스터의 기록을 찾았다.', '초고 0호. 죽을 때마다 기억을 가진 채 다시 쓰이는 존재.', '', '최종보스는 세계를 끝내려는 악당이 아니었다.', '끝없이 다시 쓰는 너를 멈추러 오고 있었다.'],
  },
  w25: {
    icon: '✦', title: '명령과 선택',
    lines: ['아린이 말했다. 「우리를 움직일 수 있다는 것과, 우리 대신 선택해도 된다는 건 달라요.」', '', '별길은 여전히 네 손을 기다렸다.', '이번에는 가장 강한 길보다 책임질 수 있는 길을 골라야 했다.'],
  },
  w30: {
    icon: '🌅', title: '다음 장의 첫 문장',
    lines: ['성은 남았고 두 세계의 문도 닫히지 않았다.', '영웅과 몬스터가 같은 원고의 다음 문장을 기다렸다.', '', '이번에는 명령문이 아니라 약속부터 쓰기로 했다.'],
  },
  firstLegend: { icon: '✦', title: '영웅의 자기소개', lines: ['새 힘이 별자리와 이어졌다.', '영웅은 카드의 등급이 아니라 스스로 고른 전문화로 강해진다.', '', '인사팀은 이 문장을 좋아했다. 뽑기 담당 부서는 사라졌다.'] },
  firstMythic: { icon: '🌌', title: '별길의 주인', lines: ['누군가 정해 둔 역할의 끝에 도달했다.', '이제부터는 역할을 따르는 것이 아니라 새 규칙을 만든다.'] },
  castleHurt: { icon: '🧱', title: '성벽 담당관', lines: ['성벽에 금이 갔다.', '담당관이 말했다. 「괜찮습니다. 아직 현실 쪽까지 새지는 않습니다.」', '', '아직이라는 말이 제일 불안했다.'] },
  champIntro: { icon: '🌠', title: '명령을 듣는 별지기', lines: ['성문 앞의 별지기 {name}가 하늘을 올려다봤다.', '「목소리는 들리는데 얼굴은 안 보이네요. 신이면 원래 원격 근무인가요?」', '', '［ 별똥별: A · 은하수: E · 별자리: V · 초상을 누르면 옷장 ］'] },
};

const ENGLISH_BEATS = {
  prologue: { icon: '▤', title: 'The Book Read You First', lines: ['Seoul, 2026. The final chapter of The Last Guardian of the Gate was blank.', 'When you turned the page, star roads and monsters formed beneath your fingertips.', '', 'Arin looked to the sky. “Commander, the citadel is on our side… right?”', 'There was no answer button. Only a defense button.'] },
  w1: { icon: '⚔️', title: 'A Command Everyone Can Hear', lines: ['The first defense began.', 'Arin and the monsters both looked up at the sound of your click.', '', 'Commands use a public channel in this world. The security officer has not spawned yet.'] },
  w2: { icon: '🔮', title: "Luna's First Complaint", lines: ['Luna looked up at the constellation board.', '“Match three stars and magic falls on that lane, right?”', 'Correct.', '“Then why did the instructions appear after combat started?”', '', 'That one is on us.'] },
  w3: { icon: '📱', title: 'A Disaster Alert from Reality', lines: ['A Seoul emergency alert appeared in midair.', '[ Gate Seven threat raised · Nearby hunters must assist evacuation ]', '', 'The storybook citadel and a real subway station pointed to the same coordinates.'] },
  w4: { icon: '♜', title: 'The Corrector Approaches', lines: ['Minions split across three lanes while a commander marched behind them.', 'A formation that follows orders is more dangerous than one strong enemy.', '', 'Sera drew her bow. “This is not another tutorial, is it?”', 'Unfortunately, this one is real.'] },
  w5: { icon: '🖋️', title: 'The Memory of a Dead Sentence', lines: ['The same line was written dozens of times inside the fallen commander’s armor.', '[ Created · Commanded · Deleted · Created again ]', '', 'The monster vanished, but the sentence remained.', 'What you create remembers you, even when you do not remember it.'] },
  w10: { icon: '🏢', title: "The Hunter Guild's Estimate", lines: ['The provisional guild sent an estimate for wall repairs.', 'Materials, hazard pay, and interdimensional travel were itemized.', '', 'The final line read “Protagonist discount: 0%.” Realistic.'] },
  w15: { icon: '👺', title: 'Testimony from the Monster Market', lines: ['The monsters in the underground market did not attack humans.', 'They wanted to know who had created them.', '', 'Assistant Kim raised his stamp. “We assign responsibility first. Combat support comes second.”'] },
  w20: { icon: '▧', title: 'Draft Zero', lines: ['The Nameless Archive held a record of the first created monster.', 'Draft Zero: reborn with every memory of every death.', '', 'The final boss was not trying to end the world.', 'It was coming to stop you from rewriting it forever.'] },
  w25: { icon: '✦', title: 'Command and Choice', lines: ['Arin said, “Being able to move us does not mean you may choose for us.”', '', 'The star road still waited for your hand.', 'This time, choose the road you can answer for—not merely the strongest one.'] },
  w30: { icon: '🌅', title: 'The First Sentence of the Next Chapter', lines: ['The citadel remained, and the passage between worlds stayed open.', 'Heroes and monsters waited for the next sentence of the same manuscript.', '', 'This time, you would write a promise before a command.'] },
  firstLegend: { icon: '✦', title: "A Hero's Introduction", lines: ['A new power joined the constellation.', 'Heroes grow through chosen specializations, not card rarity.', '', 'Recruiting approved the wording. The gacha department no longer exists.'] },
  firstMythic: { icon: '🌌', title: 'Owner of the Star Road', lines: ['Someone reached the end of a role written for them.', 'From here on, they would write new rules instead of following old ones.'] },
  castleHurt: { icon: '🧱', title: 'The Wall Inspector', lines: ['A crack opened in the wall.', 'The inspector said, “It has not leaked into reality yet.”', '', 'Yet was the least reassuring word.'] },
  champIntro: { icon: '🌠', title: 'The Stargazer Who Hears You', lines: ['The stargazer {name} looked up from the gate.', '“I hear your voice but cannot see your face. Do gods always work remotely?”', '', '[ Falling Star: A · Milky Way: E · Skills: V · Select the portrait for wardrobe ]'] },
};

export function beat(key, locale = 'ko') {
  return locale === 'en' ? ENGLISH_BEATS[key] || BEATS[key] : BEATS[key];
}

/* Return the story key after a cleared wave, or null. Space interludes farther apart later in the run to avoid constant skipping. */
const WAVE_BEATS = { 1: 'w1', 2: 'w2', 3: 'w3', 4: 'w4', 5: 'w5', 10: 'w10', 15: 'w15', 20: 'w20', 25: 'w25', 30: 'w30' };

export function beatForWave(wave) {
  return WAVE_BEATS[wave] || null;
}

/* Keep wave-start lines short because they recur every wave, combining incoming-threat guidance with character tone. */
const WAVE_QUIPS = [
  '게이트가 다시 흔들린다. 이번에는 세 길 모두다.',
  '헌터 길드 예보: 오늘도 몬스터, 가끔 중간보스.',
  '성문을 잠갔다. 차원문에는 잠금 버튼이 없었다.',
  '아린이 검을 들었다. 루나는 설명서를 찾는 중이다.',
  '별자리가 빛났다. 몬스터도 그쪽을 보고 있다.',
  '오늘의 목표: 지키고, 기록하고, 책임지기.',
  '북이 울렸다. 북 담당관은 여전히 신났다.',
];

const WAVE_QUIPS_EN = [
  'The gate shakes again—across all three lanes this time.',
  'Hunter Guild forecast: monsters, with a chance of commander.',
  'The citadel gate is locked. The dimensional gate has no lock button.',
  'Arin raises his sword. Luna is still looking for the manual.',
  'The constellation lights up. The monsters are watching it too.',
  'Today’s plan: defend, record, and take responsibility.',
  'The drums sound. The drummer remains delighted.',
];

export function waveQuip(wave, rng = Math.random, locale = 'ko') {
  const lines = locale === 'en' ? WAVE_QUIPS_EN : WAVE_QUIPS;
  return lines[Math.floor(rng() * lines.length) % lines.length];
}

/* Legacy champion preparation chatter pairs a champion line with a nearby hero's response, shown above that hero. */
export const CHAMP_CHAT = {
  any: [
    ['하늘의 명령, 다 들려요?', '몬스터도 듣는 것 같습니다.'],
    ['현실의 헌터는 월급을 받나요?', '차원 수당도 받는답니다.'],
    ['성벽에 금 간 거 봤어요?', '현실까지 새지는 않았습니다. 아직은.'],
    ['오늘 목표는 모두 살아남기예요.', '아주 좋은 목표입니다.'],
    ['발판이 참 튼튼하네요.', '발판 담당관이 기뻐하겠군요.'],
    ['무섭지 않아요?', '책임 보고서가 더 무섭습니다.'],
    ['별길 끝에는 뭐가 있을까요?', '다음 장 마감일이 있겠죠.'],
    ['제 검 좀 봐요, 별빛이에요!', '밤에는 끄고 주무십시오.'],
  ],
  byCls: {
    knight:  [['검술 대결 한 판 어때요?', '…근무 중입니다.']],
    guard:   [['방패 뒤에 잠깐 숨어도 돼요?', '한 명당 한 방패입니다.']],
    archer:  [['화살 몇 개 남았어요?', '세어 보라는 말씀이군요… 하나, 둘…']],
    mage:    [['그 구슬로 점도 쳐요?', '내일도 몬스터가 온다고 나옵니다.']],
    paladin: [['후광은 어떻게 켜는 거예요?', '성실하게 살면 켜집니다.']],
    seraph:  [['날개 한 번만 만져 봐도 돼요?', '간지럽습니다.']],
  },
  /* Idle lines when no deployed heroes are nearby. */
  solo: [
    '병사가 아무도 없네… 발판이 이렇게 많은데.',
    '길을 세 바퀴 돌았다. 길은 여전히 세 갈래다.',
    '현실의 신호가 약하네. 와이파이는 세계관 밖인가?',
    '순찰 이상 무! …보고서는 누가 결재하지?',
  ],
};
