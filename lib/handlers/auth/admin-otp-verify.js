import { createHash, timingSafeEqual } from 'node:crypto';
import { json, method, requireOrigin, rootRef, normalizeEmail, normalizeUsername, sha, verifyPassword, issueSession, consumeRateLimit, rateLimitKey, safeError, publicUser } from '../../core.js';
import { ensureConfiguredAdmin } from './configured-admin.js';
import { consumeOtpChallenge } from '../../otp.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST']) || !requireOrigin(req, res)) return;
  try {
    const identity = String(req.body?.identity || '').trim();
    const password = req.body?.password;
    const code = String(req.body?.code || '').trim();
    if (!identity || typeof password !== 'string' || password.length > 128 || !/^[0-9]{6}$/.test(code)) {
      return json(res, 400, { error: 'INVALID_CREDENTIALS', message: 'Enter your administrator email, password, and six-digit code.' });
    }
    if (!(await consumeRateLimit(rateLimitKey(req, 'admin-mfa:' + identity.toLowerCase()), 5, 15 * 60 * 1000))) {
      return json(res, 429, { error: 'RATE_LIMITED', message: 'Too many verification attempts. Wait 15 minutes and try again.' });
    }

    const root = rootRef();
    const configuredEmail = normalizeEmail(process.env.ADMIN_EMAIL);
    const suppliedHash = createHash('sha256').update(password).digest();
    const configuredPassword = process.env.ADMIN_PASSWORD;
    const configuredHash = typeof configuredPassword === 'string' ? createHash('sha256').update(configuredPassword).digest() : null;
    const isConfiguredAdmin = identity.includes('@') && normalizeEmail(identity) === configuredEmail &&
      configuredHash !== null && timingSafeEqual(suppliedHash, configuredHash);

    let uid, user;
    if (isConfiguredAdmin) {
      const configured = await ensureConfiguredAdmin(root);
      uid = configured.uid;
      user = configured.user;
    } else {
      const isEmail = identity.includes('@');
      const key = isEmail ? sha(normalizeEmail(identity)) : normalizeUsername(identity);
      uid = (await root.child((isEmail ? 'emails/' : 'usernames/') + key).get()).val();
      user = uid ? (await root.child('users/' + uid).get()).val() : null;
      if (!user || user.disabled || user.role !== 'admin' || !(await verifyPassword(password, user.passwordHash))) {
        return json(res, 401, { error: 'INVALID_CREDENTIALS', message: 'Administrator email or password is incorrect.' });
      }
    }
    if (!uid || !user || user.disabled || user.role !== 'admin' || normalizeEmail(user.email) !== normalizeEmail(identity)) {
      return json(res, 401, { error: 'INVALID_CREDENTIALS', message: 'Administrator account is unavailable.' });
    }

    const consumed = await consumeOtpChallenge({ root, email: user.email, purpose: 'admin-login', expectedUid: uid, code });
    if (!consumed.ok) {
      const messages = {
        INVALID_CODE: 'The verification code is incorrect.',
        OTP_ATTEMPT_LIMIT: 'Too many incorrect codes. Sign in again to request a fresh code.',
        OTP_ALREADY_USED: 'This code has already been used. Sign in again to request a fresh code.',
        OTP_EXPIRED_OR_MISSING: 'This code is missing or expired. Sign in again to request a fresh code.'
      };
      const status = consumed.error === 'INVALID_CODE' ? 401 : consumed.error === 'OTP_ATTEMPT_LIMIT' ? 429 : 401;
      console.warn('MS Chat admin OTP rejected', { reason: consumed.error });
      return json(res, status, { error: consumed.error, message: messages[consumed.error] || 'Verification failed.' });
    }

    const sessionHash = await issueSession(res, uid);
    const mfaVerifiedAt = Date.now();
    await Promise.all([
      root.child('sessions/' + sessionHash).update({ adminMfaVerifiedAt: mfaVerifiedAt }),
      root.child('sessionIndex/' + uid + '/' + sessionHash).update({ adminMfaVerifiedAt: mfaVerifiedAt })
    ]);
    try { await root.child('adminAuditLogs').push({ actorId: uid, action: 'admin_login_mfa_verified', createdAt: mfaVerifiedAt }); } catch {}
    return json(res, 200, { ok: true, user: publicUser(user) });
  } catch (error) {
    return safeError(res, error);
  }
}
