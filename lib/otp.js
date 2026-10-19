import { randomInt, timingSafeEqual } from 'node:crypto';
import { normalizeEmail, sha, otpDigest, sendOtpEmail } from './core.js';
import { decideOtpAttempt } from './otp-policy.js';

const PURPOSES = new Set(['registration', 'admin-login']);
const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

function challengeRef(root, purpose, email, uid = null) {
  if (!PURPOSES.has(purpose)) throw new Error('Unsupported OTP purpose');
  if (purpose === 'admin-login') {
    if (typeof uid !== 'string' || !uid.trim()) throw new Error('Administrator OTP challenge requires a UID');
    return root.child('adminLoginChallenges').child(uid);
  }
  return root.child('otpChallenges').child(purpose).child(sha(normalizeEmail(email)));
}

function sameDigest(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export async function issueOtpChallenge({ root, email, purpose, uid = null, cooldownMs = RESEND_COOLDOWN_MS }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !PURPOSES.has(purpose)) throw new Error('Invalid OTP challenge request');
  const ref = challengeRef(root, purpose, normalizedEmail, uid);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = otpDigest(code);
  const now = Date.now();
  const record = {
    email: normalizedEmail, purpose, uid: uid || null, codeHash,
    createdAt: now, lastSentAt: now, expiresAt: now + OTP_TTL_MS,
    attempts: 0, consumed: false
  };
  const reservation = await ref.transaction(old => {
    if (cooldownMs > 0 && old?.lastSentAt && now - old.lastSentAt < cooldownMs) return;
    return record;
  });
  if (!reservation.committed) {
    const error = new Error('Please wait before requesting another verification code.');
    error.code = 'RESEND_COOLDOWN';
    throw error;
  }
  try {
    await sendOtpEmail(normalizedEmail, code);
  } catch (error) {
    await ref.transaction(old => old?.codeHash === codeHash ? null : old);
    throw error;
  }
  return { expiresAt: record.expiresAt };
}

export async function consumeOtpChallenge({ root, email, purpose, code, expectedUid = null }) {
  const normalizedEmail = normalizeEmail(email);
  const submittedDigest = otpDigest(String(code));
  const ref = challengeRef(root, purpose, normalizedEmail, expectedUid);
  const result = await ref.transaction(old => decideOtpAttempt(old, {
    now: Date.now(), purpose, expectedUid, expectedEmail: normalizedEmail, submittedDigest
  }).next);
  const challenge = result.snapshot?.val() || null;

  if (result.committed && challenge?.consumed === true && challenge?.purpose === purpose &&
      (!expectedUid || challenge.uid === expectedUid) && sameDigest(challenge.codeHash, submittedDigest)) {
    return { ok: true, challenge };
  }

  if (!challenge) return { ok: false, error: 'OTP_EXPIRED_OR_MISSING' };
  if (challenge.purpose !== purpose || (challenge.email !== normalizedEmail && !(purpose === 'admin-login' && expectedUid && challenge.uid === expectedUid && (challenge.email === undefined || challenge.email === null))) || (expectedUid && challenge.uid !== expectedUid)) {
    return { ok: false, error: 'OTP_EXPIRED_OR_MISSING' };
  }
  if (challenge.consumed === true) return { ok: false, error: 'OTP_ALREADY_USED' };
  if (!Number.isFinite(challenge.expiresAt) || challenge.expiresAt <= Date.now()) {
    return { ok: false, error: 'OTP_EXPIRED_OR_MISSING' };
  }
  if (!Number.isSafeInteger(challenge.attempts) || challenge.attempts >= 5) {
    return { ok: false, error: 'OTP_ATTEMPT_LIMIT' };
  }
  if (!sameDigest(challenge.codeHash, submittedDigest)) {
    return { ok: false, error: 'INVALID_CODE' };
  }
  return { ok: false, error: 'OTP_EXPIRED_OR_MISSING' };
}

export const OTP_TTL_MS_PUBLIC = OTP_TTL_MS;
