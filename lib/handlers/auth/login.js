import { createHash, timingSafeEqual } from 'node:crypto';
import { json, method, requireOrigin, rootRef, normalizeEmail, normalizeUsername, sha, verifyPassword, issueSession, consumeRateLimit, rateLimitKey, safeError, publicUser } from '../../core.js';
import { ensureConfiguredAdmin } from './configured-admin.js';
import { issueOtpChallenge } from '../../otp.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST']) || !requireOrigin(req, res)) return;
  try {
    const identity = String(req.body?.identity || req.body?.email || '').trim();
    const password = req.body?.password;
    if (!identity || identity.length > 254 || typeof password !== 'string' || password.length > 128) return json(res, 400, { error: 'INVALID_CREDENTIALS' });
    if (!(await consumeRateLimit(rateLimitKey(req, 'login:' + identity.toLowerCase()), 10, 15 * 60 * 1000))) return json(res, 429, { error: 'RATE_LIMITED', message: 'Too many sign-in attempts. Wait and try again.' });

    const root = rootRef();
    const isEmail = identity.includes('@');
    let uid, user;
    const configuredAdminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
    if (isEmail && process.env.ADMIN_PASSWORD && normalizeEmail(identity) === configuredAdminEmail) {
      const supplied = createHash('sha256').update(password).digest();
      const expected = createHash('sha256').update(process.env.ADMIN_PASSWORD).digest();
      if (!timingSafeEqual(supplied, expected)) return json(res, 401, { error: 'INVALID_CREDENTIALS', message: 'Email/username or password is incorrect.' });
      const configured = await ensureConfiguredAdmin(root);
      uid = configured.uid;
      user = configured.user;
    } else {
      const key = isEmail ? sha(normalizeEmail(identity)) : normalizeUsername(identity);
      const index = await root.child(isEmail ? 'emails/' + key : 'usernames/' + key).get();
      uid = index.val();
      const userSnap = uid ? await root.child('users/' + uid).get() : null;
      user = userSnap?.val();
      if (!user || user.disabled || !(await verifyPassword(password, user.passwordHash))) return json(res, 401, { error: 'INVALID_CREDENTIALS', message: 'Email/username or password is incorrect.' });
    }
    if (!user || user.disabled) return json(res, 401, { error: 'INVALID_CREDENTIALS', message: 'Email/username or password is incorrect.' });

    if (user.role === 'admin') {
      await issueOtpChallenge({ root, email: user.email, purpose: 'admin-login', uid, cooldownMs: 0 });
      return json(res, 202, { ok: true, requiresAdminOtp: true, expiresInSeconds: 300, message: 'A new administrator verification code was sent to your email.' });
    }
    await issueSession(res, uid);
    return json(res, 200, { ok: true, user: publicUser(user) });
  } catch (error) {
    if (error?.code === 'RESEND_COOLDOWN') return json(res, 429, { error: 'RESEND_COOLDOWN', message: error.message });
    if (error?.code === 'CONFIG_MISSING') return safeError(res, error);
    return safeError(res, error);
  }
}
