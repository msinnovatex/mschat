import { timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { json, method, rootRef, safeError } from '../../core.js';
import { r2Client } from '../../r2.js';
async function refreshR2Inventory(root, now) {
  const ref = root.child('usageAggregates/r2Inventory');
  const existing = (await ref.get()).val() || {};
  if (existing.status === 'complete' && Number(existing.scannedAt) > now - 24 * 60 * 60 * 1000) return existing;

  const token = randomUUID();
  const claim = await ref.transaction(old => {
    if (old?.leaseUntil > now) return;
    if (old?.status === 'complete' && Number(old.scannedAt) > now - 24 * 60 * 60 * 1000) return old;
    const restart = !old || old.status !== 'scanning' || now - Number(old.startedAt || 0) > 7 * 24 * 60 * 60 * 1000;
    return {
      status: 'scanning',
      startedAt: restart ? now : old.startedAt,
      bytes: restart ? 0 : Number(old.bytes) || 0,
      objects: restart ? 0 : Number(old.objects) || 0,
      cursor: restart ? null : (old.cursor || null),
      leaseToken: token,
      leaseUntil: now + 90 * 1000
    };
  });
  let state = claim.snapshot.val() || {};
  if (state.leaseToken !== token) return state;

  const { client, bucket } = r2Client();
  for (let page = 0; page < 3; page++) {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: 'mschat/',
      MaxKeys: 1000,
      ...(state.cursor ? { ContinuationToken: state.cursor } : {})
    }));
    const contents = result.Contents || [];
    state.bytes += contents.reduce((sum, object) => sum + (Number(object.Size) || 0), 0);
    state.objects += contents.length;
    if (result.IsTruncated && result.NextContinuationToken) {
      state.cursor = result.NextContinuationToken;
      state.status = 'scanning';
      await ref.update({ status: state.status, startedAt: state.startedAt, bytes: state.bytes, objects: state.objects, cursor: state.cursor, leaseToken: token, leaseUntil: now + 90 * 1000 });
    } else {
      state = { status: 'complete', startedAt: state.startedAt, scannedAt: now, bytes: state.bytes, objects: state.objects, cursor: null, leaseToken: null, leaseUntil: 0 };
      await ref.set(state);
      return state;
    }
  }
  await ref.update({ status: 'scanning', startedAt: state.startedAt, bytes: state.bytes, objects: state.objects, cursor: state.cursor, leaseToken: null, leaseUntil: 0 });
  return { ...state, leaseToken: null, leaseUntil: 0 };
}
function matches(a, b) {
  if (!a || !b) return false;
  return timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
}
export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST'])) return;
  if (!process.env.CRON_SECRET || !matches(req.headers.authorization, 'Bearer ' + process.env.CRON_SECRET)) return json(res, 401, { error: 'UNAUTHORIZED' });
  try {
    const root = rootRef(), now = Date.now();
    const paths = ['sessions', 'otps', 'adminLoginChallenges', 'rateLimits', 'attachments', 'profileImageUploads'];
    const snaps = await Promise.all(paths.map(path => root.child(path).get()));
    const removals = [];
    snaps.forEach((snap, index) => {
      const path = paths[index];
      snap.forEach(child => {
        const value = child.val() || {};
        const expired = path === 'sessions' ? value.expiresAt <= now
          : path === 'otps' || path === 'adminLoginChallenges' ? value.expiresAt <= now
          : path === 'rateLimits' ? value.resetAt <= now
          : path === 'attachments' ? (value.status === 'pending' || value.status === 'ready' || value.status === 'deleted') && value.expiresAt <= now
          : path === 'profileImageUploads' ? value.status === 'pending' && value.expiresAt <= now : false;
        if (expired) removals.push({ path, key: child.key, value, ref: child.ref });
      });
    });
    let r2 = null;
    if (removals.some(x => ['attachments','profileImageUploads'].includes(x.path))) {
      try { r2 = r2Client(); } catch {}
    }
    let removed = 0, failures = 0;
    await Promise.all(removals.map(async item => {
      if (item.path === 'sessions' && item.value.uid) {
        try { await root.child('sessionIndex/' + item.value.uid + '/' + item.key).remove(); } catch { failures++; }
      }
      if (['attachments','profileImageUploads'].includes(item.path) && item.value.key) {
        const allowedPrefix = item.path === 'attachments' ? 'mschat/attachments/' + String(item.value.conversationId || '') + '/' : 'mschat/profile-images/' + String(item.value.ownerId || '') + '/';
        if (!item.value.key.startsWith(allowedPrefix) || !r2) { failures++; return; }
        try { await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: item.value.key })); }
        catch { failures++; return; }
      }
      try { await item.ref.remove(); removed++; } catch { failures++; }
    }));
    let storageInventory = null;
    try { storageInventory = await refreshR2Inventory(root, now); } catch {}
    return json(res, 200, { ok: true, removed, failures, storageInventoryStatus: storageInventory?.status || 'unavailable' });
  } catch (error) { return safeError(res, error); }
}
