export function decideOtpAttempt(challenge, { now, purpose, expectedUid, expectedEmail, submittedDigest }) {
  if (!challenge) return { status: 'missing', next: undefined };
  if (challenge.purpose !== purpose) return { status: 'purpose_mismatch', next: undefined };
  if (expectedEmail && challenge.email !== expectedEmail) return { status: 'email_mismatch', next: undefined };
  if (expectedUid && challenge.uid !== expectedUid) return { status: 'uid_mismatch', next: undefined };
  if (challenge.consumed === true) return { status: 'consumed', next: undefined };
  if (!Number.isFinite(challenge.expiresAt) || challenge.expiresAt <= now) return { status: 'expired', next: undefined };
  if (!Number.isSafeInteger(challenge.attempts) || challenge.attempts < 0) return { status: 'invalid_state', next: undefined };
  if (challenge.attempts >= 5) return { status: 'attempt_limit', next: undefined };
  if (challenge.codeHash !== submittedDigest) return { status: 'invalid_code', next: { ...challenge, attempts: challenge.attempts + 1 } };
  return { status: 'accepted', next: { ...challenge, consumed: true, consumedAt: now } };
}
