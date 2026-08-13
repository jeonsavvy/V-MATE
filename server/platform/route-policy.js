const route = (id, method, pattern, policy) => Object.freeze({
  id,
  method,
  pattern,
  policy: Object.freeze({ owner: false, mutation: false, ...policy }),
});

// This table is the public route-policy inventory. Handlers remain ordinary
// functions; the dispatcher uses this metadata so auth and persistence rules
// do not have to be rediscovered from a long ordered if-chain.
export const PLATFORM_ROUTE_DEFINITIONS = Object.freeze([
  route('home', 'GET', '/api/home', { auth: 'public' }),
  route('character-list', 'GET', '/api/characters', { auth: 'public' }),
  route('character-detail', 'GET', '/api/characters/:slug', { auth: 'optional' }),
  route('world-list', 'GET', '/api/worlds', { auth: 'public' }),
  route('world-detail', 'GET', '/api/worlds/:slug', { auth: 'optional' }),
  route('recent-rooms', 'GET', '/api/recent-rooms', { auth: 'local-demo' }),
  route('library', 'GET', '/api/library', { auth: 'local-demo' }),
  route('chat-quota', 'GET', '/api/me/chat-quota', { auth: 'required' }),
  route('create-report', 'POST', '/api/reports', { auth: 'required', mutation: true }),
  route('delete-account', 'DELETE', '/api/account', { auth: 'local-demo', mutation: true }),
  route('recent-view', 'POST', '/api/recent-views', { auth: 'local-demo', mutation: true }),
  route('create-bookmark', 'POST', '/api/bookmarks', { auth: 'local-demo', mutation: true }),
  route('delete-bookmark', 'DELETE', '/api/bookmarks/:bookmarkId', { auth: 'local-demo', mutation: true }),
  route('create-character', 'POST', '/api/characters', { auth: 'local-demo', mutation: true }),
  route('update-character', 'PATCH', '/api/characters/:slug', { auth: 'required', mutation: true }),
  route('delete-character', 'DELETE', '/api/characters/:id', { auth: 'required', mutation: true }),
  route('create-world', 'POST', '/api/worlds', { auth: 'local-demo', mutation: true }),
  route('update-world', 'PATCH', '/api/worlds/:slug', { auth: 'required', mutation: true }),
  route('delete-world', 'DELETE', '/api/worlds/:id', { auth: 'required', mutation: true }),
  route('prepare-upload', 'POST', '/api/uploads/prepare', { auth: 'local-demo', mutation: true }),
  route('create-room', 'POST', '/api/rooms', { auth: 'local-demo', mutation: true }),
  route('get-room', 'GET', '/api/rooms/:roomId', { auth: 'local-demo' }),
  route('room-chat', 'POST', '/api/rooms/:roomId/chat', { auth: 'local-demo', mutation: true }),
  route('ops-reports', 'GET', '/api/ops/reports', { auth: 'required', owner: true }),
  route('ops-update-report', 'PATCH', '/api/ops/reports/:reportId', { auth: 'required', owner: true, mutation: true }),
  route('ops-dashboard', 'GET', '/api/ops/dashboard', { auth: 'required', owner: true }),
  route('ops-content-visibility', 'POST', '/api/ops/content/:entityType/:id/:action', { auth: 'required', owner: true, mutation: true }),
  route('ops-delete-content', 'DELETE', '/api/ops/content/:entityType/:id', { auth: 'required', owner: true, mutation: true }),
  route('ops-home-banner', 'POST', '/api/ops/home/banner', { auth: 'required', owner: true, mutation: true }),
  route('ops-home-banner-mode', 'POST', '/api/ops/home/banner-mode', { auth: 'required', owner: true, mutation: true }),
  route('ops-home-banner-target', 'POST', '/api/ops/home/banner-target', { auth: 'required', owner: true, mutation: true }),
]);

const splitPath = (value) => String(value || '/').split('/').filter(Boolean);

const matchSegments = (pattern, path) => {
  const expected = splitPath(pattern);
  const actual = splitPath(path);
  if (expected.length !== actual.length) return null;
  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    const expectedSegment = expected[index];
    if (expectedSegment.startsWith(':')) {
      params[expectedSegment.slice(1)] = actual[index];
      continue;
    }
    if (expectedSegment !== actual[index]) return null;
  }
  return params;
};

export const resolvePlatformRoute = ({ method, path }) => {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  for (const definition of PLATFORM_ROUTE_DEFINITIONS) {
    if (definition.method !== normalizedMethod) continue;
    const params = matchSegments(definition.pattern, path);
    if (params) return { definition, params };
  }
  return null;
};

export const matchPlatformRoute = (request) => {
  const match = resolvePlatformRoute(request);
  return match ? { routeId: match.definition.id, params: match.params } : null;
};
