import type {
  BridgeProfile,
  CharacterDetail,
  CharacterSummary,
  CharacterWorldLinkSummary,
  HomeFeedPayload,
  LibraryPayload,
  OwnerOpsDashboard,
  RoomSummary,
  WorldDetail,
  WorldSummary,
} from '@/lib/platform/types'

const creators = {
  vmate: { id: 'creator-vmate', slug: 'v-mate', name: 'V-MATE' },
  noir: { id: 'creator-noir', slug: 'noir-atelier', name: '노아르 아틀리에' },
} as const

const characters: CharacterDetail[] = [
  {
    id: 'character-mika',
    entityType: 'character',
    slug: 'mika',
    name: '미소노 미카',
    headline: '장난스럽고 다정한 결의 인기 캐릭터',
    summary: '친밀한 반말과 밝은 장난기가 중심인 인기 RP 캐릭터.',
    coverImageUrl: '/mika_normal.webp',
    avatarImageUrl: '/mika_happy.webp',
    tags: ['학원', '친밀감', '반말', '2차창작'],
    creator: creators.vmate,
    visibility: 'public',
    displayStatus: 'visible',
    sourceType: 'derivative',
    favoriteCount: 1284,
    chatStartCount: 3421,
    updatedAt: '2026-03-07T00:00:00.000Z',
    profileSections: [
      { title: '성격', body: '가볍고 다정한 반말. 상대 반응에 감정선이 빠르게 흔들린다.' },
      { title: '말투', body: '짧고 부드러운 문장, 장난스러운 리듬.' },
      { title: '관계감', body: '처음부터 거리를 과도하게 두기보다는 빠르게 친밀감을 만든다.' },
    ],
    gallery: ['/mika_normal.webp', '/mika_happy.webp', '/mika_angry.webp'],
    worlds: [],
  },
  {
    id: 'character-alice',
    entityType: 'character',
    slug: 'alice',
    name: '앨리스',
    headline: '격식체와 책임감을 가진 기사형 캐릭터',
    summary: '품위 있는 말투와 단단한 신뢰감을 가진 기사형 RP 캐릭터.',
    coverImageUrl: '/alice_normal.webp',
    avatarImageUrl: '/alice_confused.webp',
    tags: ['판타지', '기사', '격식체', '2차창작'],
    creator: creators.vmate,
    visibility: 'public',
    displayStatus: 'visible',
    sourceType: 'derivative',
    favoriteCount: 984,
    chatStartCount: 2110,
    updatedAt: '2026-03-05T00:00:00.000Z',
    profileSections: [
      { title: '성격', body: '책임감이 강하고 판단이 빠르다.' },
      { title: '말투', body: '정돈된 격식체, 직접적인 표현.' },
      { title: '관계감', body: '협력자/동료로 신뢰를 쌓는 흐름이 자연스럽다.' },
    ],
    gallery: ['/alice_normal.webp', '/alice_confused.webp', '/alice_angry.webp'],
    worlds: [],
  },
  {
    id: 'character-kael',
    entityType: 'character',
    slug: 'kael',
    name: '카엘',
    headline: '무심한 척 챙겨주는 현실형 캐릭터',
    summary: '짧은 말투와 현실적인 배려가 중심인 현대/게임 감성 캐릭터.',
    coverImageUrl: '/kael_normal.webp',
    avatarImageUrl: '/kael_happy.webp',
    tags: ['현대', '게임', '쿨데레', '오리지널'],
    creator: creators.noir,
    visibility: 'public',
    displayStatus: 'visible',
    sourceType: 'original',
    favoriteCount: 1542,
    chatStartCount: 4013,
    updatedAt: '2026-03-07T00:00:00.000Z',
    profileSections: [
      { title: '성격', body: '말수는 적지만 중요한 순간에는 먼저 움직인다.' },
      { title: '말투', body: '짧고 건조한 문장, 현대 한국어.' },
      { title: '관계감', body: '친구/동료 톤에서 자연스럽게 텐션을 쌓는다.' },
    ],
    gallery: ['/kael_normal.webp', '/kael_happy.webp', '/kael_angry.webp'],
    worlds: [],
  },
]

const worlds: WorldDetail[] = [
  {
    id: 'world-sao',
    entityType: 'world',
    slug: 'sao',
    name: '소드아트온라인',
    headline: '공중도시형 VRMMO 월드',
    summary: '공중도시와 레이드, 로그아웃 불가의 긴장감이 있는 VRMMO 월드.',
    coverImageUrl: '/world_sao.svg',
    tags: ['게임', '레이드', '가상세계', '2차창작'],
    creator: creators.vmate,
    visibility: 'public',
    displayStatus: 'visible',
    sourceType: 'derivative',
    favoriteCount: 1875,
    chatStartCount: 5120,
    updatedAt: '2026-03-07T00:00:00.000Z',
    worldSections: [
      { title: '월드 소개', body: '공중도시형 VRMMO. 레이드와 파티 플레이의 압력이 강하다.' },
      { title: '월드 규칙', body: '파티, 역할 분담, 공중도시, 위험과 협력이 핵심.' },
      { title: '장소/톤', body: '광장, 상점가, 레이드 입구. 속도감 있는 긴장과 팀워크.' },
    ],
    gallery: ['/world_sao.svg'],
    characters: [],
  },
  {
    id: 'world-tokyo-night',
    entityType: 'world',
    slug: 'tokyo-night',
    name: '현실의 도쿄',
    headline: '심야 골목과 편의점이 있는 현실 도시',
    summary: '심야 편의점, 비 오는 골목, 막차 직전의 공기가 살아 있는 현실 도시 월드.',
    coverImageUrl: '/world_tokyo.svg',
    tags: ['도시', '현대', '심야', '오리지널'],
    creator: creators.noir,
    visibility: 'public',
    displayStatus: 'visible',
    sourceType: 'original',
    favoriteCount: 1436,
    chatStartCount: 3291,
    updatedAt: '2026-03-06T00:00:00.000Z',
    worldSections: [
      { title: '월드 소개', body: '현실적인 이동감과 거리감이 중심인 심야 도쿄.' },
      { title: '월드 규칙', body: '과장된 판타지 전개 없이 현실 톤을 유지한다.' },
      { title: '장소/톤', body: '역 근처, 편의점, 비 오는 골목. 잔잔하지만 감정이 선명하다.' },
    ],
    gallery: ['/world_tokyo.svg'],
    characters: [],
  },
  {
    id: 'world-fantasy-isekai',
    entityType: 'world',
    slug: 'fantasy-isekai',
    name: '판타지 이세계',
    headline: '길드와 마법도시가 중심인 정통 판타지',
    summary: '길드, 마법, 모험의 설렘이 살아 있는 정통 판타지 월드.',
    coverImageUrl: '/world_isekai.svg',
    tags: ['이세계', '길드', '마법', '오리지널'],
    creator: creators.noir,
    visibility: 'public',
    displayStatus: 'visible',
    sourceType: 'original',
    favoriteCount: 1108,
    chatStartCount: 2670,
    updatedAt: '2026-03-05T00:00:00.000Z',
    worldSections: [
      { title: '월드 소개', body: '처음 발을 내딛는 이방인과 길드 문법이 핵심.' },
      { title: '월드 규칙', body: '마법, 길드, 임무, 도시 탐색이 중심이다.' },
      { title: '장소/톤', body: '길드 홀, 시장, 광장. 낯선 설렘과 성장의 톤.' },
    ],
    gallery: ['/world_isekai.svg'],
    characters: [],
  },
]

const links: CharacterWorldLinkSummary[] = [
  {
    id: 'link-mika-tokyo',
    characterSlug: 'mika',
    worldSlug: 'tokyo-night',
    world: worlds[1],
    linkReason: '심야 도시 톤에서 감정선이 가장 자연스럽게 살아납니다.',
    defaultOpeningContext: '비가 갠 밤, 편의점 앞에서 우연히 마주친다.',
    defaultRelationshipContext: '익숙하지만 아직 말 못한 감정이 남아 있는 사이.',
  },
  {
    id: 'link-mika-sao',
    characterSlug: 'mika',
    worldSlug: 'sao',
    world: worlds[0],
    linkReason: '빠른 감정 기복과 협동 긴장이 잘 맞습니다.',
    defaultOpeningContext: '레이드 입구 앞에서 파티를 기다리는 순간.',
    defaultRelationshipContext: '같은 파티에 막 합류한 상태.',
  },
  {
    id: 'link-alice-isekai',
    characterSlug: 'alice',
    worldSlug: 'fantasy-isekai',
    world: worlds[2],
    linkReason: '기사형 캐릭터와 정통 판타지 문법의 결이 가장 안정적입니다.',
    defaultOpeningContext: '길드 첫 임무 전 브리핑이 시작된다.',
    defaultRelationshipContext: '협력 임무에 처음 배치된 동료.',
  },
  {
    id: 'link-kael-sao',
    characterSlug: 'kael',
    worldSlug: 'sao',
    world: worlds[0],
    linkReason: '게임 감성과 MMO 레이드 문법이 자연스럽게 연결됩니다.',
    defaultOpeningContext: '레이드 5분 전, 장비를 마지막으로 점검한다.',
    defaultRelationshipContext: '서로 실력은 알지만 팀 호흡은 처음 맞춘다.',
  },
]

characters[0].worlds = [links[0], links[1]]
characters[1].worlds = [links[2]]
characters[2].worlds = [links[3], { id: 'link-kael-tokyo', characterSlug: 'kael', worldSlug: 'tokyo-night', world: worlds[1], linkReason: '현실적인 거리감과 무심한 배려 톤이 잘 맞습니다.' }]
worlds[0].characters = [characters[2], characters[0], characters[1]].map(({ worlds: _worlds, ...rest }) => rest as CharacterSummary)
worlds[1].characters = [characters[0], characters[2]].map(({ worlds: _worlds, ...rest }) => rest as CharacterSummary)
worlds[2].characters = [characters[1], characters[0]].map(({ worlds: _worlds, ...rest }) => rest as CharacterSummary)

const summarizeCharacter = ({ worlds: _worlds, profileSections: _profileSections, gallery: _gallery, ...item }: CharacterDetail): CharacterSummary => item
const summarizeWorld = ({ worldSections: _worldSections, gallery: _gallery, characters: _characters, ...item }: WorldDetail): WorldSummary => item

export const demoBridgeProfile = ({ character, world }: { character: CharacterSummary; world: WorldSummary | null }): BridgeProfile => {
  if (!world) {
    return {
      entryMode: 'direct_character',
      characterRoleInWorld: '캐릭터 본연의 역할',
      userRoleInWorld: '대화 상대',
      meetingTrigger: `${character.name}와 단독 대화를 시작한다.`,
      relationshipDistance: '캐릭터 기본 관계선',
      currentGoal: '캐릭터의 말투와 감정선을 자연스럽게 열기',
      startingLocation: '자유 대화 공간',
      worldTerms: [],
      firstScenePressure: '가벼운 시작',
    }
  }

  return {
    entryMode: 'in_world',
    characterRoleInWorld: world.slug === 'sao' ? '파티 핵심 멤버' : world.slug === 'fantasy-isekai' ? '동료/기사/모험가' : '심야에 함께 움직이는 가까운 인물',
    userRoleInWorld: world.slug === 'sao' ? '같은 파티원' : world.slug === 'fantasy-isekai' ? '동행자' : '캐릭터와 함께 움직이는 상대',
    meetingTrigger: world.slug === 'sao' ? '레이드 직전 파티 집결' : world.slug === 'fantasy-isekai' ? '길드 브리핑 직전' : '비 갠 밤 귀가 직전',
    relationshipDistance: '익숙하지만 아직 다 풀어내지 않은 거리감',
    currentGoal: '월드 규칙 안에서 캐릭터 톤을 무리 없이 안착시키기',
    startingLocation: world.slug === 'sao' ? '레이드 입구' : world.slug === 'fantasy-isekai' ? '길드 홀' : '편의점 앞 골목',
    worldTerms: world.slug === 'sao' ? ['레이드', '파티', '광장'] : world.slug === 'fantasy-isekai' ? ['길드', '마법', '의뢰'] : ['심야', '편의점', '막차'],
    firstScenePressure: world.slug === 'sao' ? '임박한 레이드 긴장' : world.slug === 'fantasy-isekai' ? '첫 임무의 낯섦' : '짧은 시간 안의 감정선',
  }
}

export const demoPlatform = {
  home(tab: 'characters' | 'worlds' = 'characters'): HomeFeedPayload {
    return {
      home: {
        defaultTab: 'characters',
        filterChips: ['신작', '태그'],
        hero: {
          title: tab === 'characters' ? characters[0].name : worlds[0].name,
          subtitle: tab === 'characters' ? characters[0].headline || characters[0].summary : worlds[0].headline || worlds[0].summary,
          coverImageUrl: tab === 'characters' ? characters[0].coverImageUrl : worlds[0].coverImageUrl,
          targetPath: tab === 'characters' ? `/characters/${characters[0].slug}` : `/worlds/${worlds[0].slug}`,
        },
        characterFeed: { items: characters.map(summarizeCharacter) },
        worldFeed: { items: worlds.map(summarizeWorld) },
      },
    }
  },
  characters(search = ''): CharacterSummary[] {
    const q = search.trim().toLowerCase()
    return characters.map(summarizeCharacter).filter((item) => !q || JSON.stringify(item).toLowerCase().includes(q))
  },
  worlds(search = ''): WorldSummary[] {
    const q = search.trim().toLowerCase()
    return worlds.map(summarizeWorld).filter((item) => !q || JSON.stringify(item).toLowerCase().includes(q))
  },
  character(slug: string) {
    return characters.find((item) => item.slug === slug) ?? null
  },
  world(slug: string) {
    return worlds.find((item) => item.slug === slug) ?? null
  },
  worldLinks(slug: string) {
    return links.filter((item) => item.characterSlug === slug)
  },
  recentRooms(): RoomSummary[] {
    return []
  },
  library(): LibraryPayload {
    return {
      bookmarks: [],
      recentViews: [],
      recentRooms: [],
      owned: {
        characters: [],
        worlds: [],
      },
    }
  },
  ops(): OwnerOpsDashboard {
    return {
      items: {
        visibleCharacters: characters.map(summarizeCharacter),
        hiddenCharacters: [],
        visibleWorlds: worlds.map(summarizeWorld),
        hiddenWorlds: [],
      },
      home: {
        heroTargetPath: `/characters/${characters[0].slug}`,
      },
    }
  },
}
