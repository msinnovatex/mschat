import { createHash, timingSafeEqual } from 'node:crypto';
import { json, method, requireOrigin, rootRef, normalizeEmail, normalizeUsername, sha, verifyPassword, issueSession, consumeRateLimit, rateLimitKey, safeError, publicUser, otpDigest } from '../../core.js';
import { ensureConfiguredAdmin } from './configured-admin.js';

function matchesConfiguredPassword(supplied, configured) {
  if (typeof supplied !== 'string' || typeof configured !== 'string' || !configured) return false;
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(configured).digest();
  return timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (!method(req, res, ['POST']) || !requireOrigin(req, res)) return;
  try {
    const identity = String(req.body?.identity || '').trim();
    const password = req.body?.password;
    const code = String(req.body?.code || '').trim();
    if (!identity || typeof password !== 'string' || password.length > 128 || !/^[0-9]{6}$/.test(code)) {
      return json(res, 400, { error: 'INVALID_CREDENTIALS', message: 'Enter your administrator email, password, and the six-digit verification code.' });
    }
    if (!(await consumeRateLimit(rateLimitKey(req, 'admin-mfa:' + identity.toLowerCase()), 5, 15 * 60 * 1000))) {
      return json(res, 429, { error: 'RATE_LIMITED', message: 'Too many verification attempts. Wait 15 minutes before trying again.' });
    }

    const root = rootRef();
    const configuredEmail = normalizeEmail(process.env.ADMIN_EMAIL);
    const isConfiguredAdmin = identity.includes('@') &&
      normalizeEmail(identity) === configuredEmail &&
      matchesConfiguredPassword(password, process.env.ADMIN_PASSWORD);

    let uid, user;
    if (isConfiguredAdmin) {
      // Resolve the configured administrator exactly as the initial login endpoint does.
      // This avoids relying on a potentially stale/mismatched password hash for the
      // environment-configured administrator during the second authentication step.
      const configured = await ensureConfiguredAdmin(root);
      uid = configured.uid;
      user = configured.user;
    } else {
      const isEmail = identity.includes('@');
      const key = isEmail ? sha(normalizeEmail(identity)) : normalizeUsername(identity);
      uid = (await root.child((isEmail ? 'emails/' : 'usernames/') + key).get()).val();
      user = uid ? (await root.child('users/' + uid).get()).val() : null;
      if (!user || user.disabled || user.role !== 'admin' || !(await verifyPassword(password, user.passwordHash))) {
        try { await root.child('securityEvents').push({ type: 'admin_login_failed', ipKey: rateLimitKey(req, 'admin-login-failed'), createdAt: Date.now() }); } catch {}
        return json(res, 401, { error: 'INVALID_CREDENTIALS', message: 'Administrator email or password is incorrect.' });
      }
    }

    if (!uid || !user || user.disabled || user.role !== 'admin') {
      return json(res, 401, { error: 'INVALID_CREDENTIALS', message: 'Administrator account is unavailable.' });
    }

    const ref = root.child('adminLoginChallenges/' + uid);
    const submittedDigest = otpDigest(code);
    const result = await ref.transaction(old => {
      if (!old || old.uid !== uid || old.purpose !== 'admin-login' || old.consumed ||
          !Number.isFinite(old.expiresAt) || old.expiresAt <= Date.now() ||
          !Number.isFinite(old.attempts) || old.attempts >= 5) return;
      if (old.codeHash !== submittedDigest) return { ...old, attempts: (old.attempts || 0) + 1 };
      return { ...old, consumed: true, consumedAt: Date.now() };
    });

    // Determine the outcome from the committed database snapshot, not mutable flags
    // changed inside the transaction callback (Firebase may invoke it multiple times).
    const challenge = result.snapshot?.val();
    if (result.committed && challenge?.consumed === true && challenge?.consumedAt) {
      const sessionHash = await issueSession(res, uid);
      const mfaVerifiedAt = Date.now();
      await Promise.all([
        root.child('sessions/' + sessionHash).update({ adminMfaVerifiedAt: mfaVerifiedAt }),
        root.child('sessionIndex/' + uid + '/' + sessionHash).update({ adminMfaVerifiedAt: mfaVerifiedAt })
      ]);
      try { await root.child('adminAuditLogs').push({ actorId: uid, action: 'admin_login_mfa_verified', createdAt: Date.now() }); } catch {}
      return json(res, 200, { ok: true, user: publicUser(user) });
    }

    if (result.committed && challenge && challenge.consumed !== true &&
        challenge.purpose === 'admin-login' && challenge.uid === uid &&
        challenge.expiresAt > Date.now() && challenge.attempts > 0 && challenge.attempts <= 5) {
      try { await root.child('securityEvents').push({ type: 'admin_mfa_failed', actorId: uid, createdAt: Date.now() }); } catch {}
      return json(res, 401, { error: 'INVALID_CODE', message: 'The verification code is incorrect. Request a new code if you have reached the attempt limit.' });
    }

    return json(res, 401, { error: 'OTP_EXPIRED_OR_MISSING', message: 'This verification code has expired or is no longer active. Sign in again to request a new code.' });
  } catch (error) {
    return safeError(res, error);
  }
}
