import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PLATFORM_ROUTE_DEFINITIONS,
  matchPlatformRoute,
} from './route-policy.js';

test('matches static and parameterized routes without branch-order ambiguity', () => {
  assert.deepEqual(matchPlatformRoute({ method: 'GET', path: '/api/home' }), {
    routeId: 'home',
    params: {},
  });
  assert.deepEqual(matchPlatformRoute({ method: 'POST', path: '/api/rooms/room-1/chat' }), {
    routeId: 'room-chat',
    params: { roomId: 'room-1' },
  });
  assert.deepEqual(matchPlatformRoute({ method: 'POST', path: '/api/ops/home/banner-target' }), {
    routeId: 'ops-home-banner-target',
    params: {},
  });
  assert.equal(matchPlatformRoute({ method: 'GET', path: '/api/unknown' }), null);
});

test('declares auth, owner, and mutation policy for every route', () => {
  const allowedAuthModes = new Set(['public', 'optional', 'required', 'local-demo']);
  assert.ok(PLATFORM_ROUTE_DEFINITIONS.length > 0);

  for (const route of PLATFORM_ROUTE_DEFINITIONS) {
    assert.ok(route.id);
    assert.ok(route.method);
    assert.ok(route.pattern);
    assert.ok(allowedAuthModes.has(route.policy?.auth), `${route.id} has invalid auth mode`);
    assert.equal(typeof route.policy?.owner, 'boolean', `${route.id} must declare owner policy`);
    assert.equal(typeof route.policy?.mutation, 'boolean', `${route.id} must declare mutation policy`);
    if (route.policy.owner) assert.equal(route.policy.auth, 'required');
  }
});

test('keeps security-sensitive route policies explicit', () => {
  const byId = Object.fromEntries(PLATFORM_ROUTE_DEFINITIONS.map((route) => [route.id, route.policy]));
  assert.deepEqual(byId.home, { auth: 'public', owner: false, mutation: false });
  assert.deepEqual(byId['character-detail'], { auth: 'optional', owner: false, mutation: false });
  assert.deepEqual(byId['room-chat'], { auth: 'local-demo', owner: false, mutation: true });
  assert.deepEqual(byId['delete-account'], { auth: 'local-demo', owner: false, mutation: true });
  assert.deepEqual(byId['ops-dashboard'], { auth: 'required', owner: true, mutation: false });
  assert.deepEqual(byId['ops-delete-content'], { auth: 'required', owner: true, mutation: true });
});
