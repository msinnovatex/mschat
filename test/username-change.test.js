import test from 'node:test';
import assert from 'node:assert/strict';
import {
  USERNAME_CHANGE_COOLDOWN_MS,
  isValidUsername,
  normalizeUsernameValue,
  usernameChangeAvailableAt,
  canClaimUsername
} from '../lib/username-change.js';

test('validates the User ID format and length', () => {
  for (const value of ['abc', 'Sidik_123', 'a'.repeat(24), 'user_01']) assert.equal(isValidUsername(value), true, value);
  for (const value of ['', 'ab', 'a'.repeat(25), 'has space', 'name.with.dot', 'ümlaut', 'bad/name', null, 42]) {
    assert.equal(isValidUsername(value), false, String(value));
  }
});

test('normalizes IDs for case-insensitive uniqueness', () => {
  assert.equal(normalizeUsernameValue('  SiDiK_123 '), 'sidik_123');
  assert.equal(normalizeUsernameValue('SIDIK_123'), normalizeUsernameValue('sidik_123'));
});

test('enforces a 30-day cooldown and permits changes at the exact boundary', () => {
  const now = 2_000_000_000_000;
  assert.equal(USERNAME_CHANGE_COOLDOWN_MS, 30 * 24 * 60 * 60 * 1000);
  assert.equal(usernameChangeAvailableAt(undefined, now), 0);
  assert.equal(usernameChangeAvailableAt(now - USERNAME_CHANGE_COOLDOWN_MS + 1, now), now + 1);
  assert.equal(usernameChangeAvailableAt(now - USERNAME_CHANGE_COOLDOWN_MS, now), 0);
  assert.equal(usernameChangeAvailableAt(now - USERNAME_CHANGE_COOLDOWN_MS - 1000, now), 0);
});

test('a username can only be claimed when unowned or already owned by the same account', () => {
  assert.equal(canClaimUsername(null, 'uid_1'), true);
  assert.equal(canClaimUsername(undefined, 'uid_1'), true);
  assert.equal(canClaimUsername('uid_1', 'uid_1'), true);
  assert.equal(canClaimUsername('uid_2', 'uid_1'), false);
});
