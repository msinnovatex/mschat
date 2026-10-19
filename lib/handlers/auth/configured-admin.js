import { hashPassword, normalizeEmail, normalizeUsername, sha, validatePassword } from '../../core.js';

function usernameBase(email) {
  const configured = String(process.env.ADMIN_USERNAME || '').trim();
  const source = (configured || email.split('@')[0]).toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
  const base = source.length >= 3 ? source : 'msadmin';
  return base.slice(0, 24);
}

export async function ensureConfiguredAdmin(root) {
  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_PASSWORD;
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || !validatePassword(password)) {
    const error = new Error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of 12–128 characters.'); error.code = 'CONFIG_MISSING'; throw error;
  }
  const emailKey = sha(email);
  let uid = (await root.child('emails/' + emailKey).get()).val();
  if (uid) {
    const userRef = root.child('users/' + uid);
    const snap = await userRef.get();
    const user = snap.val();
    if (!user || normalizeEmail(user.email) !== email) {
      const error = new Error('Configured administrator email index is inconsistent.'); error.code = 'CONFIG_MISSING'; throw error;
    }
    if (user.disabled) return { uid, user: { ...user, disabled: true } };
    const passwordHash = await hashPassword(password);
    await userRef.update({ role: 'admin', emailVerified: true, passwordHash, updatedAt: Date.now() });
    return { uid, user: { ...user, role: 'admin', emailVerified: true, passwordHash, updatedAt: Date.now() } };
  }

  const userRef = root.child('users').push();
  uid = userRef.key;
  const emailReservation = await root.child('emails/' + emailKey).transaction(old => old == null ? uid : undefined);
  if (!emailReservation.committed) {
    const existingUid = (await root.child('emails/' + emailKey).get()).val();
    if (existingUid) {
      const existing = (await root.child('users/' + existingUid).get()).val();
      if (existing && normalizeEmail(existing.email) === email) {
        if (existing.disabled) return { uid: existingUid, user: { ...existing, disabled: true } };
        const passwordHash = await hashPassword(password);
        await root.child('users/' + existingUid).update({ role: 'admin', emailVerified: true, passwordHash, updatedAt: Date.now() });
        return { uid: existingUid, user: { ...existing, role: 'admin', emailVerified: true, passwordHash, updatedAt: Date.now() } };
      }
    }
    const error = new Error('Could not reserve configured administrator email.'); error.code = 'CONFIG_MISSING'; throw error;
  }

  let username = usernameBase(email), usernameReserved = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const suffix = attempt === 0 ? '' : String(attempt + 1);
    const candidate = username.slice(0, 24 - suffix.length) + suffix;
    const result = await root.child('usernames/' + normalizeUsername(candidate)).transaction(old => old == null ? uid : undefined);
    if (result.committed) { username = candidate; usernameReserved = true; break; }
  }
  if (!usernameReserved) {
    await root.child('emails/' + emailKey).transaction(old => old === uid ? null : old);
    const error = new Error('Could not reserve a username for the configured administrator. Set a unique ADMIN_USERNAME.'); error.code = 'CONFIG_MISSING'; throw error;
  }

  const now = Date.now();
  const user = {
    id: uid,
    fullName: String(process.env.ADMIN_FULL_NAME || 'MS Chat Administrator').trim().slice(0, 80),
    email,
    username,
    normalizedUsername: normalizeUsername(username),
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
    emailVerified: true,
    role: 'admin',
    disabled: false
  };
  try {
    await userRef.set(user);
    await root.child('adminAuditLogs').push({ actorId: uid, action: 'configured_admin_provisioned', createdAt: now });
    return { uid, user };
  } catch (error) {
    await Promise.all([
      root.child('emails/' + emailKey).transaction(old => old === uid ? null : old),
      root.child('usernames/' + normalizeUsername(username)).transaction(old => old === uid ? null : old),
      userRef.remove()
    ]);
    throw error;
  }
}
