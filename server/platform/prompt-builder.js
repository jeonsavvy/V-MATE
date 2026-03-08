export const generateBridgeProfile = ({ character, world, link }) => {
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
  const meetingTrigger = link?.defaultOpeningContext
    || worldIntro
    || (worldKey === 'game'
      ? '레이드 시작 직전, 마지막 점검을 하고 있다.'
      : worldKey === 'fantasy'
        ? '길드 임무 배정 직전, 브리핑이 시작된다.'
        : '비가 막 그친 밤, 짧은 대화를 시작할 타이밍이 온다.')
  const relationshipDistance = link?.defaultRelationshipContext || character.promptProfile.relationshipBaseline
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
})
