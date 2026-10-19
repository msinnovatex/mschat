import test from 'node:test';
import assert from 'node:assert/strict';
import { countActiveUsers } from '../lib/admin-metrics.js';

test('counts each user once when at least one presence session has not expired', () => {
  const presence = {
    userA: { sessions: { tab1: { expiresAt: 2000 }, tab2: { expiresAt: 3000 } } },
    userB: { sessions: { tab1: { expiresAt: 1000 } } },
    userC: { status: 'online', lastSeenAt: 1900 },
    userD: { sessions: { tab1: { expiresAt: 'not-a-time' } } }
  };
  assert.equal(countActiveUsers(presence, 1500), 1);
});

test('returns zero for missing or malformed presence data', () => {
  assert.equal(countActiveUsers(null, 1000), 0);
  assert.equal(countActiveUsers([], 1000), 0);
  assert.equal(countActiveUsers({ user: { sessions: null } }, 1000), 0);
});

test('expired sessions do not count as active', () => {
  assert.equal(countActiveUsers({ user: { sessions: { tab: { expiresAt: 1000 } } } }, 1000), 0);
});
