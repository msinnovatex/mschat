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

function legacyAdminChallengeRef(root, email) {
  return root.child('otpChallenges').child('admin-login').child(sha(normalizeEmail(email)));
}

function sameDigest(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function challengeBindingFailure(challenge, { purpose, expectedUid, expectedEmail }) {
  if (!challenge) return 'missing';
  if (challenge.purpose !== purpose) return 'purpose_mismatch';
  const emailMatches = challenge.email === expectedEmail ||
    (purpose === 'admin-login' && expectedUid && challenge.uid === expectedUid &&
      (challenge.email === undefined || challenge.email === null));
  if (!emailMatches) return 'email_mismatch';
  if (expectedUid && challenge.uid !== expectedUid) return 'uid_mismatch';
  return null;
}

function errorForStatus(status) {
  if (status === 'invalid_code') return 'INVALID_CODE';
  if (status === 'attempt_limit') return 'OTP_ATTEMPT_LIMIT';
  if (status === 'consumed') return 'OTP_ALREADY_USED';
  return 'OTP_EXPIRED_OR_MISSING';
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
  const expected = { purpose, expectedUid, expectedEmail: normalizedEmail };
  const candidates = [{ source: purpose === 'admin-login' ? 'uid' : 'email', ref: challengeRef(root, purpose, normalizedEmail, expectedUid), priority: 0 }];
  if (purpose === 'admin-login') {
    candidates.push({ source: 'email', ref: legacyAdminChallengeRef(root, normalizedEmail), priority: 1 });
  }

  const loaded = await Promise.all(candidates.map(async candidate => ({
    ...candidate,
    challenge: (await candidate.ref.get()).val() || null
  })));
  const matching = loaded.filter(candidate =>
    challengeBindingFailure(candidate.challenge, expected) === null
  );

  if (!matching.length) {
    const diagnostic = loaded.find(candidate => candidate.source === 'uid' && candidate.challenge) ||
      loaded.find(candidate => candidate.challenge) || loaded[0];
    const reason = challengeBindingFailure(diagnostic.challenge, expected) || 'missing';
    if (purpose === 'admin-login') console.warn('MS Chat admin OTP challenge rejected', { reason, source: diagnostic.source });
    return { ok: false, error: 'OTP_EXPIRED_OR_MISSING' };
  }

  matching.sort((a, b) => {
    const aCreatedAt = Number.isFinite(a.challenge.createdAt) ? a.challenge.createdAt : Number.NEGATIVE_INFINITY;
    const bCreatedAt = Number.isFinite(b.challenge.createdAt) ? b.challenge.createdAt : Number.NEGATIVE_INFINITY;
    return (bCreatedAt - aCreatedAt) || (a.priority - b.priority);
  });
  const selected = matching[0];
  let decisionStatus = null;
  const result = await selected.ref.transaction(old => {
    const decision = decideOtpAttempt(old, {
      now: Date.now(), purpose, expectedUid, expectedEmail: normalizedEmail, submittedDigest
    });
    decisionStatus = decision.status;
    return decision.next;
  });
  const challenge = result.snapshot?.val() || null;

  if (result.committed && decisionStatus === 'accepted' &&
      challenge?.consumed === true && challenge?.purpose === purpose &&
      (!expectedUid || challenge.uid === expectedUid) && sameDigest(challenge.codeHash, submittedDigest)) {
    return { ok: true, challenge };
  }

  const status = result.committed
    ? decisionStatus
    : decideOtpAttempt(challenge, {
      now: Date.now(), purpose, expectedUid, expectedEmail: normalizedEmail, submittedDigest
    }).status;
  const reason = status || 'invalid_state';
  if (purpose === 'admin-login') console.warn('MS Chat admin OTP challenge rejected', {
    reason,
    source: selected.source,
    committed: Boolean(result.committed)
  });
  return { ok: false, error: errorForStatus(reason) };
}

export const OTP_TTL_MS_PUBLIC = OTP_TTL_MS;
