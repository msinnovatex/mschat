import { json, method, requireOrigin, rootRef, normalizeEmail, consumeRateLimit, rateLimitKey, safeError, sha } from '../../core.js';
import { issueOtpChallenge } from '../../otp.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST']) || !requireOrigin(req, res)) return;
  try {
    const email = normalizeEmail(req.body?.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json(res, 400, { error: 'INVALID_EMAIL' });
    if (!(await consumeRateLimit(rateLimitKey(req, 'otp-ip'), 10, 15 * 60 * 1000)) ||
        !(await consumeRateLimit(rateLimitKey(req, 'otp:' + email), 3, 15 * 60 * 1000))) {
      return json(res, 429, { error: 'RATE_LIMITED', message: 'Too many code requests. Please wait and try again.' });
    }
    const root = rootRef();
    const emailKey = sha(email);
    if ((await root.child('emails/' + emailKey).get()).exists()) {
      return json(res, 409, { error: 'ACCOUNT_UNAVAILABLE', message: 'This email cannot be used to create another account. Try signing in.' });
    }
    try {
      await issueOtpChallenge({ root, email, purpose: 'registration' });
    } catch (error) {
      if (error?.code === 'RESEND_COOLDOWN') return json(res, 429, { error: 'RESEND_COOLDOWN', message: error.message });
      throw error;
    }
    return json(res, 200, { ok: true, expiresInSeconds: 300, resendAfterSeconds: 60, message: 'A verification code was sent if this address is eligible. The code expires in 5 minutes.' });
  } catch (error) { return safeError(res, error); }
}
