import { json, method, requireOrigin, session, rootRef, safeError, consumeRateLimit, rateLimitKey, normalizeUsername, verifyPassword, randomToken, publicUser } from '../core.js';
import { USERNAME_CHANGE_COOLDOWN_MS, isValidUsername, usernameChangeAvailableAt, canClaimUsername } from '../username-change.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST']) || !requireOrigin(req, res)) return;
  let lockRef, lockToken = '', claimedNewKey = false, newKey = '', uid = '', profileCommitted = false;
  try {
    const auth = await session(req);
    if (!auth) return json(res, 401, { error: 'UNAUTHENTICATED' });
    uid = auth.uid;
    if (!(await consumeRateLimit(rateLimitKey(req, 'username-change:' + uid), 3, 24 * 60 * 60 * 1000))) {
      return json(res, 429, { error: 'RATE_LIMITED', message: 'Too many User ID change attempts. Try again later.' });
    }

    const requestedUsername = String(req.body?.username || '').trim();
    const currentPassword = req.body?.currentPassword;
    if (!isValidUsername(requestedUsername)) {
      return json(res, 400, { error: 'INVALID_USERNAME', message: 'User ID must be 3–24 characters using only letters, numbers, or underscores.' });
    }
    if (typeof currentPassword !== 'string' || currentPassword.length < 1 || currentPassword.length > 128) {
      return json(res, 400, { error: 'PASSWORD_REQUIRED', message: 'Enter your current password to change your User ID.' });
    }

    const root = rootRef();
    const now = Date.now();
    lockRef = root.child('usernameChangeLocks/' + uid);
    lockToken = randomToken(18);
    const lock = await lockRef.transaction(old => old && Number(old.expiresAt) > now
      ? undefined
      : { token: lockToken, expiresAt: now + 30 * 1000 });
    if (!lock.committed) return json(res, 409, { error: 'USERNAME_CHANGE_IN_PROGRESS', message: 'A User ID change is already in progress. Please retry shortly.' });

    const userRef = root.child('users/' + uid);
    const user = (await userRef.get()).val();
    if (!user || user.disabled || user.deletionRequestedAt) return json(res, 401, { error: 'UNAUTHENTICATED' });
    if (!(await verifyPassword(currentPassword, user.passwordHash))) return json(res, 401, { error: 'INVALID_PASSWORD', message: 'Your current password is incorrect.' });

    const normalized = normalizeUsername(requestedUsername);
    const currentNormalized = normalizeUsername(user.normalizedUsername || user.username);
    if (normalized === currentNormalized) {
      return json(res, 200, { ok: true, changed: false, user: publicUser(user), message: 'That is already your current User ID.' });
    }

    const availableAt = usernameChangeAvailableAt(user.lastUsernameChangeAt, now);
    if (availableAt) {
      return json(res, 429, {
        error: 'USERNAME_CHANGE_COOLDOWN',
        availableAt,
        message: 'You can change your User ID again after ' + new Date(availableAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + '.'
      });
    }

    newKey = normalized;
    const reservation = await root.child('usernames/' + newKey).transaction(old => canClaimUsername(old, uid) ? uid : undefined);
    if (!reservation.committed) return json(res, 409, { error: 'USERNAME_TAKEN', message: 'That User ID is already taken. Choose another one.' });
    claimedNewKey = true;

    const nowCommitted = Date.now();
    const updated = {
      ...user,
      username: requestedUsername,
      normalizedUsername: normalized,
      lastUsernameChangeAt: nowCommitted,
      updatedAt: nowCommitted
    };
    // Commit the profile change and old-key release together. The new key was
    // already reserved transactionally, so no other account can claim it.
    const updates = {
      ['users/' + uid + '/username']: updated.username,
      ['users/' + uid + '/normalizedUsername']: updated.normalizedUsername,
      ['users/' + uid + '/lastUsernameChangeAt']: updated.lastUsernameChangeAt,
      ['users/' + uid + '/updatedAt']: updated.updatedAt
    };
    const oldKey = currentNormalized;
    if (oldKey && oldKey !== normalized && (await root.child('usernames/' + oldKey).get()).val() === uid) {
      updates['usernames/' + oldKey] = null;
    }
    await root.update(updates);
    profileCommitted = true;
    return json(res, 200, { ok: true, changed: true, user: publicUser(updated), availableAgainAt: nowCommitted + USERNAME_CHANGE_COOLDOWN_MS });
  } catch (error) {
    if (claimedNewKey && newKey && uid && !profileCommitted) {
      try { await rootRef().child('usernames/' + newKey).transaction(old => old === uid ? null : old); } catch {}
    }
    return safeError(res, error);
  } finally {
    if (lockRef && lockToken) {
      try { await lockRef.transaction(old => old?.token === lockToken ? null : old); } catch {}
    }
  }
}
