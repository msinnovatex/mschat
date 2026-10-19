import test from 'node:test';
import assert from 'node:assert/strict';
import { decideOtpAttempt } from '../lib/otp-policy.js';

const base = { email: 'user@example.com', uid: 'uid-1', purpose: 'registration', codeHash: 'digest', createdAt: 100, expiresAt: 1000, attempts: 0, consumed: false };

test('rejects a missing challenge', () => {
  assert.equal(decideOtpAttempt(null, { now: 200, purpose: 'registration', submittedDigest: 'digest' }).status, 'missing');
});
test('rejects an expired challenge', () => {
  assert.equal(decideOtpAttempt(base, { now: 1000, purpose: 'registration', submittedDigest: 'digest' }).status, 'expired');
});
test('rejects a different purpose and UID', () => {
  assert.equal(decideOtpAttempt(base, { now: 200, purpose: 'admin-login', submittedDigest: 'digest' }).status, 'purpose_mismatch');
  assert.equal(decideOtpAttempt(base, { now: 200, purpose: 'registration', expectedUid: 'other', submittedDigest: 'digest' }).status, 'uid_mismatch');
});
test('increments attempts atomically for wrong code', () => {
  const result = decideOtpAttempt(base, { now: 200, purpose: 'registration', submittedDigest: 'wrong' });
  assert.equal(result.status, 'invalid_code');
  assert.equal(result.next.attempts, 1);
  assert.equal(result.next.consumed, false);
});
test('consumes a correct code exactly once', () => {
  const result = decideOtpAttempt(base, { now: 200, purpose: 'registration', submittedDigest: 'digest' });
  assert.equal(result.status, 'accepted');
  assert.equal(result.next.consumed, true);
  assert.equal(result.next.consumedAt, 200);
});
test('blocks challenges at the attempt limit and already consumed challenges', () => {
  assert.equal(decideOtpAttempt({ ...base, attempts: 5 }, { now: 200, purpose: 'registration', submittedDigest: 'digest' }).status, 'attempt_limit');
  assert.equal(decideOtpAttempt({ ...base, consumed: true }, { now: 200, purpose: 'registration', submittedDigest: 'digest' }).status, 'consumed');
});
