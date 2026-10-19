import { json, method, session, rootRef, safeError, consumeRateLimit, rateLimitKey } from '../core.js';
export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const auth = await session(req); if (!auth) return json(res, 401, { error: 'UNAUTHENTICATED' });
    if (!(await consumeRateLimit(rateLimitKey(req, 'user-search:' + auth.uid), 30, 60 * 1000))) return json(res, 429, { error: 'RATE_LIMITED' });
    const q = String(req.query?.q || '').trim().replace(/^@/, '').toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
    if (q.length < 2 || /[.#$\[\]\/\u0000-\u001f]/.test(q)) return json(res, 200, { users: [] });
    const root = rootRef();
    const found = new Map();
    // Username prefix lookup (keeps @username discovery fast).
    if (/^[a-z0-9_]{2,24}$/.test(q)) {
      const snap = await root.child('usernames').orderByKey().startAt(q).endAt(q + '\\uf8ff').limitToFirst(50).get();
      for (const [username, uid] of Object.entries(snap.val() || {})) {
        if (uid !== auth.uid && username !== String(auth.user.username || '').toLowerCase()) found.set(uid, { id: uid, username });
      }
    }
    // Search normalized names for newly created/updated profiles, plus legacy title-case names.
    const nameQueries = [];
    nameQueries.push(root.child('users').orderByChild('fullNameLower').startAt(q).endAt(q + '\\uf8ff').limitToFirst(50).get());
    const titleCase = q.split(' ').map(part => part ? part[0].toUpperCase() + part.slice(1) : part).join(' ');
    if (titleCase !== q) nameQueries.push(root.child('users').orderByChild('fullName').startAt(titleCase).endAt(titleCase + '\\uf8ff').limitToFirst(50).get());
    const nameSnaps = await Promise.all(nameQueries);
    for (const snap of nameSnaps) {
      for (const [uid, u] of Object.entries(snap.val() || {})) {
        if (uid !== auth.uid && u && !u.disabled && String(u.fullNameLower || u.fullName || '').toLowerCase().startsWith(q)) {
          found.set(uid, { id: uid, username: u.username });
        }
      }
    }
    const users = [];
    for (const [uid, match] of found) {
      const [blockedA, blockedB, userSnap] = await Promise.all([
        root.child('blocks/' + auth.uid + '/' + uid).get(),
        root.child('blocks/' + uid + '/' + auth.uid).get(),
        root.child('users/' + uid).get()
      ]);
      const u = userSnap.val();
      if (blockedA.exists() || blockedB.exists() || !u || u.disabled) continue;
      users.push({ id: uid, username: u.username || match.username, fullName: u.fullName, avatarUrl: u.avatarKey ? '/api/profile-image?userId=' + u.id : (u.avatarUrl || null), bio: u.bio || '' });
    }
    users.sort((a, b) => a.fullName.localeCompare(b.fullName) || a.username.localeCompare(b.username));
    return json(res, 200, { users: users.slice(0, 50) });
  } catch (error) { return safeError(res, error); }
}
