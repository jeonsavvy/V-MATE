export const ROOM_MEMORY_CONFIG = Object.freeze({
  summaryRefreshTurns: 10,
  recentRawTurns: 6,
  recentRawMessages: 12,
  maxSummaryChars: 1400,
});

const normalizeLine = (value, max = 160) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const normalizeBlock = (value, max = 12000) => String(value || '').trim().slice(0, max);

const pushUnique = (existing, incoming, max = 6) => {
  const next = [...(Array.isArray(existing) ? existing : [])];
  for (const value of incoming) {
    const normalized = normalizeLine(value, 96);
    if (!normalized || next.includes(normalized)) continue;
    next.push(normalized);
  }
  return next.slice(-max);
};

const extractLocationFromNarration = (narration, fallback) => {
  const normalized = normalizeLine(narration, 120);
  if (!normalized.includes('에서')) {
    return fallback;
  }
  const [candidate] = normalized.split('에서');
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length > 40) {
    return fallback;
  }
  return trimmed;
};

const extractFuturePromiseHints = (...texts) => {
  const keywords = ['다음', '나중', '약속', '다시', '함께', '곧'];
  const hints = [];

  for (const text of texts) {
    const segments = String(text || '')
      .split(/[\n.!?]/)
      .map((segment) => normalizeLine(segment, 96))
      .filter(Boolean);

    for (const segment of segments) {
      if (keywords.some((keyword) => segment.includes(keyword))) {
        hints.push(segment);
      }
    }
  }

  return hints;
};

const extractRelationshipCue = (assistantMessage, fallback) => {
  const keywords = ['거리', '관계', '경계', '호감', '신뢰', '어색', '편안', '가까워', '멀어', '동행'];
  const candidates = [
    normalizeLine(assistantMessage?.inner_heart, 120),
    normalizeLine(assistantMessage?.response, 120),
  ].filter(Boolean);

  const matched = candidates.find((candidate) => keywords.some((keyword) => candidate.includes(keyword)));
  return matched || fallback;
};

export const normalizeStoredPromptSnapshot = (value) => {
  if (typeof value === 'string') {
    return {
      basePromptSnapshot: value,
      runningSummary: '',
      compactedUserTurns: 0,
    };
  }

  if (value && typeof value === 'object') {
    return {
      basePromptSnapshot: normalizeBlock(value.basePromptSnapshot || value.promptSnapshot || '', 12000),
      runningSummary: normalizeBlock(value.runningSummary || '', ROOM_MEMORY_CONFIG.maxSummaryChars),
      compactedUserTurns: Number.isFinite(Number(value.compactedUserTurns))
        ? Math.max(0, Number(value.compactedUserTurns))
        : 0,
    };
  }

  return {
    basePromptSnapshot: '',
    runningSummary: '',
    compactedUserTurns: 0,
  };
};

export const buildStoredPromptSnapshot = ({ basePromptSnapshot, runningSummary = '', compactedUserTurns = 0 }) => ({
  basePromptSnapshot: normalizeBlock(basePromptSnapshot, 12000),
  runningSummary: normalizeBlock(runningSummary, ROOM_MEMORY_CONFIG.maxSummaryChars),
  compactedUserTurns: Math.max(0, Number(compactedUserTurns || 0)),
});

export const buildConversationTurns = (messageHistory = []) => {
  const history = Array.isArray(messageHistory) ? messageHistory : [];
  const normalized = history
    .map((message) => {
      const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'user' ? 'user' : null;
      if (!role) return null;

      if (role === 'user') {
        return { role, text: normalizeLine(message?.content, 240) };
      }

      const assistantObject = typeof message?.content === 'object' && message?.content
        ? message.content
        : null;

      return {
        role,
        text: normalizeLine(assistantObject?.response || message?.content, 240),
        narration: normalizeLine(assistantObject?.narration, 180),
      };
    })
    .filter((message) => message?.text);

  const historyWithoutGreeting = normalized[0]?.role === 'assistant'
    ? normalized.slice(1)
    : normalized;

  const turns = [];
  let pendingUser = null;

  for (const message of historyWithoutGreeting) {
    if (message.role === 'user') {
      if (pendingUser) {
        turns.push({ userText: pendingUser.text, assistantText: '', narration: '' });
      }
      pendingUser = message;
      continue;
    }

    if (!pendingUser) {
      continue;
    }

    turns.push({
      userText: pendingUser.text,
      assistantText: message.text,
      narration: message.narration || '',
    });
    pendingUser = null;
  }

  if (pendingUser) {
    turns.push({ userText: pendingUser.text, assistantText: '', narration: '' });
  }

  return turns;
};

export const buildRecentRawHistory = (messageHistory = []) => {
  const history = Array.isArray(messageHistory) ? messageHistory : [];
  const normalized = history
    .filter((message) => message?.role === 'user' || message?.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  const withoutGreeting = normalized[0]?.role === 'assistant'
    ? normalized.slice(1)
    : normalized;

  return withoutGreeting.slice(-ROOM_MEMORY_CONFIG.recentRawMessages);
};

export const shouldRefreshRunningSummary = ({ totalUserTurns, compactedUserTurns }) =>
  totalUserTurns >= ROOM_MEMORY_CONFIG.summaryRefreshTurns
  && totalUserTurns - compactedUserTurns >= ROOM_MEMORY_CONFIG.summaryRefreshTurns;

export const buildRunningSummary = ({ turns, state }) => {
  const compactedTurns = Array.isArray(turns) ? turns : [];
  if (!compactedTurns.length) {
    return '';
  }

  const lines = [
    `누적 장면: ${normalizeLine(state?.currentSituation || '장면 진행 중', 120)}`,
    `현재 위치: ${normalizeLine(state?.location || '미정', 80)}`,
    `관계 흐름: ${normalizeLine(state?.relationshipState || '기본 관계 유지', 120)}`,
  ];

  if (Array.isArray(state?.futurePromises) && state.futurePromises.length > 0) {
    lines.push(`열린 루프: ${state.futurePromises.slice(0, 4).map((item) => normalizeLine(item, 72)).join(' / ')}`);
  }

  if (Array.isArray(state?.worldNotes) && state.worldNotes.length > 0) {
    lines.push(`세계 메모: ${state.worldNotes.slice(-4).map((item) => normalizeLine(item, 60)).join(' / ')}`);
  }

  lines.push('압축 대화 메모:');
  compactedTurns.slice(-8).forEach((turn, index) => {
    lines.push(`${index + 1}) 사용자: ${normalizeLine(turn.userText, 72)} | 응답: ${normalizeLine(turn.assistantText || turn.narration || '', 96)}`);
  });

  return lines.join('\n').slice(0, ROOM_MEMORY_CONFIG.maxSummaryChars);
};

export const buildRuntimePromptSnapshot = ({ storedPromptSnapshot, state }) => {
  const snapshot = normalizeStoredPromptSnapshot(storedPromptSnapshot);
  const lines = [snapshot.basePromptSnapshot];

  if (snapshot.runningSummary) {
    lines.push('', '### RUNNING SUMMARY', snapshot.runningSummary);
  }

  lines.push(
    '',
    '### LIVE ROOM STATE',
    `- Situation: ${normalizeLine(state?.currentSituation || '장면 진행 중', 160)}`,
    `- Location: ${normalizeLine(state?.location || '미정', 80)}`,
    `- Relationship: ${normalizeLine(state?.relationshipState || '기본 관계 유지', 160)}`,
  );

  if (Array.isArray(state?.futurePromises) && state.futurePromises.length > 0) {
    lines.push(`- Open loops: ${state.futurePromises.slice(0, 4).map((item) => normalizeLine(item, 72)).join(' / ')}`);
  }

  if (Array.isArray(state?.worldNotes) && state.worldNotes.length > 0) {
    lines.push(`- World notes: ${state.worldNotes.slice(-4).map((item) => normalizeLine(item, 60)).join(' / ')}`);
  }

  return lines.join('\n');
};

export const generateBridgeProfile = ({ character, world }) => {
  const characterIntro = typeof character.promptProfile.characterIntro === 'string'
    ? character.promptProfile.characterIntro.trim()
    : ''

  if (!world) {
    return {
      entryMode: 'direct_character',
      characterRoleInWorld: '캐릭터 본연의 역할',
      userRoleInWorld: '대화 상대',
      meetingTrigger: characterIntro || `${character.name}와 단독 대화를 시작한다.`,
      relationshipDistance: character.promptProfile.relationshipBaseline,
      currentGoal: '캐릭터의 결을 자연스럽게 연다.',
      startingLocation: '자유 대화 공간',
      worldTerms: [],
      firstScenePressure: '가벼운 시작',
    }
  }

  const roleMap = {
    game: '파티 핵심 멤버',
    fantasy: '동료/길드 인원',
    city: '심야를 함께 걷는 인물',
  }
  const worldKey = world.promptProfile.genreKey || world.promptProfile.genre || 'city'
  const worldIntro = typeof world.promptProfile.worldIntro === 'string'
    ? world.promptProfile.worldIntro.trim()
    : ''
  const characterRoleInWorld = roleMap[worldKey] || '이 월드에 익숙한 인물'
  const userRoleInWorld = worldKey === 'game'
    ? '같은 파티원'
    : worldKey === 'fantasy'
      ? '함께 움직이는 동료'
      : '캐릭터와 같은 장면을 공유하는 상대'
  const meetingTrigger = worldIntro
    || (worldKey === 'game'
      ? '레이드 시작 직전, 마지막 점검을 하고 있다.'
      : worldKey === 'fantasy'
        ? '길드 임무 배정 직전, 브리핑이 시작된다.'
        : '비가 막 그친 밤, 짧은 대화를 시작할 타이밍이 온다.')
  const relationshipDistance = character.promptProfile.relationshipBaseline
  const currentGoal = worldKey === 'game'
    ? '협력과 긴장 속에서 역할 분담을 빠르게 잡는다.'
    : worldKey === 'fantasy'
      ? '낯선 세계 안에서 캐릭터의 결을 흔들지 않고 동행을 시작한다.'
      : '짧은 장면 안에서 감정선과 거리감을 분명히 만든다.'
  const starterLocations = Array.isArray(world.promptProfile.starterLocations) ? world.promptProfile.starterLocations : []
  const worldTerms = Array.isArray(world.promptProfile.worldTerms) ? world.promptProfile.worldTerms : []
  const startingLocation = starterLocations[0] || world.name
  const firstScenePressure = worldKey === 'game'
    ? '즉시 행동해야 하는 전투 전 긴장'
    : worldKey === 'fantasy'
      ? '처음 합류한 동료 사이의 어색함'
      : '짧은 시간 안에 드러나는 미묘한 감정'

  return {
    entryMode: 'in_world',
    characterRoleInWorld,
    userRoleInWorld,
    meetingTrigger,
    relationshipDistance,
    currentGoal,
    startingLocation,
    worldTerms,
    firstScenePressure,
  }
}

export const createInitialRoomState = ({ bridgeProfile, world }) => ({
  currentSituation: bridgeProfile.meetingTrigger,
  location: bridgeProfile.startingLocation,
  relationshipState: bridgeProfile.relationshipDistance,
  inventory: [],
  appearance: [],
  pose: [],
  futurePromises: [],
  worldNotes: world && Array.isArray(world.promptProfile.worldTerms) ? world.promptProfile.worldTerms : [],
})

export const buildRoomPromptSnapshot = ({ character, world, bridgeProfile, state }) => {
  const characterPersona = Array.isArray(character.promptProfile.persona) ? character.promptProfile.persona : []
  const characterSpeech = Array.isArray(character.promptProfile.speechStyle) ? character.promptProfile.speechStyle : []
  const characterImageSlots = Array.isArray(character.promptProfile.imageSlots) ? character.promptProfile.imageSlots : []
  const characterMasterPrompt = typeof character.promptProfile.masterPrompt === 'string' ? character.promptProfile.masterPrompt.trim() : ''
  const characterIntro = typeof character.promptProfile.characterIntro === 'string' ? character.promptProfile.characterIntro.trim() : ''
  const lines = [
    '### PLATFORM CONTRACT',
    '- 항상 한국어.',
    '- 감정선은 선명하게, 문장은 지나치게 길지 않게.',
    '- JSON 객체만 출력: emotion, inner_heart, response, narration(optional), character_image_slot(optional), world_image_slot(optional).',
    '- character_image_slot은 현재 장면에 가장 잘 맞는 캐릭터 이미지 슬롯명이 있을 때만 넣는다.',
    '- world_image_slot은 현재 장면에 가장 잘 맞는 월드 이미지 슬롯명이 있을 때만 넣는다.',
    '',
    '### CHARACTER',
    `- Name: ${character.name}`,
    `- Headline: ${character.headline || character.summary}`,
    ...characterPersona.map((item) => `- Persona: ${item}`),
    ...characterSpeech.map((item) => `- Speech: ${item}`),
    `- Relationship baseline: ${character.promptProfile.relationshipBaseline}`,
  ]

  if (characterIntro) {
    lines.push(`- Character intro: ${characterIntro}`)
  }

  if (characterMasterPrompt) {
    lines.push(...characterMasterPrompt.split('\n').map((item) => item.trim()).filter(Boolean).map((item) => `- Master prompt: ${item}`))
  }

  if (characterImageSlots.length > 0) {
    lines.push(
      ...characterImageSlots.map((slot) => `- Character image slot ${slot.slot}: ${slot.trigger || slot.usage || '기본 규칙 없음'}`)
    )
  }

  if (world) {
    const worldRules = Array.isArray(world.promptProfile.rules) ? world.promptProfile.rules : []
    const starterLocations = Array.isArray(world.promptProfile.starterLocations) ? world.promptProfile.starterLocations : []
    const tone = world.promptProfile.tone || (Array.isArray(world.promptProfile.toneKeywords) ? world.promptProfile.toneKeywords.join(', ') : '')
    const worldImageSlots = Array.isArray(world.promptProfile.imageSlots) ? world.promptProfile.imageSlots : []
    const worldMasterPrompt = typeof world.promptProfile.masterPrompt === 'string' ? world.promptProfile.masterPrompt.trim() : ''
    const worldIntro = typeof world.promptProfile.worldIntro === 'string' ? world.promptProfile.worldIntro.trim() : ''
    lines.push(
      '',
      '### WORLD',
      `- Name: ${world.name}`,
      `- Headline: ${world.headline || world.summary}`,
      ...worldRules.map((item) => `- Rule: ${item}`),
      `- Tone: ${tone}`,
      `- Starter locations: ${starterLocations.join(', ')}`,
    )

    if (worldIntro) {
      lines.push(`- World intro: ${worldIntro}`)
    }

    if (worldMasterPrompt) {
      lines.push(...worldMasterPrompt.split('\n').map((item) => item.trim()).filter(Boolean).map((item) => `- World master prompt: ${item}`))
    }

    if (worldImageSlots.length > 0) {
      lines.push(
        ...worldImageSlots.map((slot) => `- World image slot ${slot.slot}: ${slot.trigger || slot.usage || '기본 규칙 없음'}`)
      )
    }
  }

  lines.push(
    '',
    '### BRIDGE',
    `- Entry mode: ${bridgeProfile.entryMode}`,
    `- Character role: ${bridgeProfile.characterRoleInWorld}`,
    `- User role: ${bridgeProfile.userRoleInWorld}`,
    `- Meeting trigger: ${bridgeProfile.meetingTrigger}`,
    `- Current goal: ${bridgeProfile.currentGoal}`,
    `- First scene pressure: ${bridgeProfile.firstScenePressure}`,
    '',
    '### ROOM STATE',
    `- Situation: ${state.currentSituation}`,
    `- Location: ${state.location}`,
    `- Relationship: ${state.relationshipState}`,
    `- World notes: ${state.worldNotes.join(' / ')}`,
  )

  return lines.join('\n')
}

export const updateRoomStateFromMessages = ({ state, assistantMessage, userMessage }) => ({
  ...state,
  currentSituation: typeof assistantMessage?.narration === 'string' && assistantMessage.narration.trim()
    ? assistantMessage.narration.trim()
    : String(userMessage || '').trim().slice(0, 120) || state.currentSituation,
  location: extractLocationFromNarration(assistantMessage?.narration, state.location),
  relationshipState: extractRelationshipCue(assistantMessage, state.relationshipState),
  futurePromises: pushUnique(
    state.futurePromises,
    extractFuturePromiseHints(userMessage, assistantMessage?.response, assistantMessage?.narration),
    4,
  ),
  worldNotes: pushUnique(
    state.worldNotes,
    [
      extractLocationFromNarration(assistantMessage?.narration, ''),
      normalizeLine(assistantMessage?.narration, 80),
    ],
    6,
  ),
})
