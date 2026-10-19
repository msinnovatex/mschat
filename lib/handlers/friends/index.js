import { json, method, requireOrigin, session, rootRef, safeError, consumeRateLimit, rateLimitKey, incrementCounter } from '../../core.js';
import { sendGenericPush } from '../../push.js';
export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST']) || (req.method === 'POST' && !requireOrigin(req, res))) return;
  try {
    const auth = await session(req); if (!auth) return json(res, 401, { error: 'UNAUTHENTICATED' });
    const root = rootRef();
    if (req.method === 'GET' && !(await consumeRateLimit(rateLimitKey(req, 'friends-read:' + auth.uid), 30, 60 * 1000))) return json(res, 429, { error: 'RATE_LIMITED' });
    if (req.method === 'POST') {
      const action = String(req.body?.action || '');
      if (action === 'remove-friend') {
        const targetId = String(req.body?.userId || '');
        if (!/^[A-Za-z0-9_-]{20}$/.test(targetId) || targetId === auth.uid) return json(res, 400, { error: 'INVALID_USER' });
        await Promise.all([root.child('friends/' + auth.uid + '/' + targetId).remove(), root.child('friends/' + targetId + '/' + auth.uid).remove()]);
        return json(res, 200, { ok: true });
      }
      const key = String(req.body?.requestId || '');
      if (!/^[A-Za-z0-9_-]{41}$/.test(key)) return json(res, 400, { error: 'INVALID_REQUEST_ID' });
      const snap = await root.child('friendRequests/' + key).get(), request = snap.val();
      if (!request || request.status !== 'pending') return json(res, 404, { error: 'REQUEST_NOT_FOUND' });
      if (action !== 'cancel' && request.to !== auth.uid) return json(res, 404, { error: 'REQUEST_NOT_FOUND' });
      if (action === 'cancel') {
        if (request.from !== auth.uid) return json(res, 403, { error: 'FORBIDDEN' });
        const cancelledAt = Date.now(), cancelled = await snap.ref.transaction(old => old?.status === 'pending' && old.from === auth.uid ? { ...old, status: 'cancelled', updatedAt: cancelledAt } : undefined);
        if (!cancelled.committed) return json(res, 409, { error: 'REQUEST_ALREADY_PROCESSED' });
        await root.update({ ['friendRequestsByUser/' + request.to + '/' + key]: null, ['friendRequestsSentByUser/' + auth.uid + '/' + key]: null });
        return json(res, 200, { ok: true });
      }
      if (action === 'reject') { const rejectedAt = Date.now(), rejected = await snap.ref.transaction(old => old?.status === 'pending' && old.to === auth.uid ? { ...old, status: 'rejected', updatedAt: rejectedAt } : undefined); if (!rejected.committed) return json(res, 409, { error: 'REQUEST_ALREADY_PROCESSED' }); await root.update({ ['friendRequestsByUser/' + auth.uid + '/' + key]: null, ['friendRequestsSentByUser/' + request.from + '/' + key]: null }); return json(res, 200, { ok: true }); }
      if (action !== 'accept') return json(res, 400, { error: 'INVALID_ACTION' });
      const [blockedA, blockedB] = await Promise.all([root.child('blocks/' + request.from + '/' + request.to).get(), root.child('blocks/' + request.to + '/' + request.from).get()]);
      if (blockedA.exists() || blockedB.exists()) return json(res, 403, { error: 'INTERACTION_BLOCKED' });
      const pair = [request.from, request.to].sort(), conversationId = pair.join('_');
      const acceptedAt = Date.now();
      // Perform the status change, index cleanup and friendship/conversation creation
      // in one RTDB multi-location update. The previous two-step flow could mark the
      // request accepted first, then fail while writing the friendship, leaving the
      // UI stuck with a generic error and a partially processed request.
      const updates = {
        ['friendRequests/' + key + '/status']: 'accepted',
        ['friendRequests/' + key + '/updatedAt']: acceptedAt,
        ['friendRequestsByUser/' + auth.uid + '/' + key]: null,
        ['friendRequestsSentByUser/' + request.from + '/' + key]: null,
        ['friends/' + auth.uid + '/' + request.from]: { since: acceptedAt, conversationId },
        ['friends/' + request.from + '/' + auth.uid]: { since: acceptedAt, conversationId },
        ['conversations/' + conversationId + '/members/' + pair[0]]: true,
        ['conversations/' + conversationId + '/members/' + pair[1]]: true,
        ['userConversationState/' + pair[0] + '/' + conversationId + '/lastMessageAt']: acceptedAt,
        ['userConversationState/' + pair[1] + '/' + conversationId + '/lastMessageAt']: acceptedAt
      };
      await root.update(updates);
      try { await incrementCounter('conversations'); } catch {}
      try { await sendGenericPush(request.from, { title: 'MS Chat', body: 'Your friend request was accepted.', url: '/', tag: 'mschat-friend-accepted' }, 'friend-accepted:' + key); } catch {}
      return json(res, 200, { ok: true, conversationId });
    }
    const [requestsSnap, outgoingSnap] = await Promise.all([root.child('friendRequestsByUser/' + auth.uid).get(), root.child('friendRequestsSentByUser/' + auth.uid).get()]);
    const incoming = [], outgoing = [];
    for (const [id, indexed] of Object.entries(requestsSnap.val() || {})) {
      const req = (await root.child('friendRequests/' + id).get()).val();
      if (!req || req.to !== auth.uid || req.status !== 'pending') continue;
      const [uSnap, blockedA, blockedB] = await Promise.all([root.child('users/' + req.from).get(), root.child('blocks/' + auth.uid + '/' + req.from).get(), root.child('blocks/' + req.from + '/' + auth.uid).get()]);
      const u = uSnap.val();
      if (u && !u.disabled && !blockedA.exists() && !blockedB.exists()) incoming.push({ requestId: id, user: { id: req.from, fullName: u.fullName, username: u.username } });
    }
    for (const [id] of Object.entries(outgoingSnap.val() || {})) {
      const req = (await root.child('friendRequests/' + id).get()).val();
      if (!req || req.from !== auth.uid || req.status !== 'pending') continue;
      const target = (await root.child('users/' + req.to).get()).val();
      if (target && !target.disabled) outgoing.push({ requestId: id, user: { id: req.to, fullName: target.fullName, username: target.username } });
    }
    return json(res, 200, { incoming, outgoing });
  } catch (error) { return safeError(res, error); }
}
