import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const apply = process.argv.includes('--apply');
const startedAt = Date.now();
const required = ['FIREBASE_DATABASE_URL', 'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) {
  console.error('Missing Firebase Admin environment variables:', missing.join(', '));
  process.exit(1);
}
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}
const root = getDatabase().ref('mschat');

function countBefore(snapshot, cutoff) {
  let count = 0;
  snapshot.forEach(child => {
    const rawCreatedAt = child.child('createdAt').val();
    const createdAt = Number(rawCreatedAt);
    if (rawCreatedAt !== null && rawCreatedAt !== undefined && Number.isFinite(createdAt) && createdAt < cutoff) count++;
  });
  return count;
}
async function countMessagesBefore(cutoff) {
  const conversations = await root.child('conversations').get();
  let count = 0;
  for (const conversationId of Object.keys(conversations.val() || {})) {
    const messages = await root.child('messages/' + conversationId).get();
    count += countBefore(messages, cutoff);
  }
  return count;
}
const specs = [
  { name: 'registrations', path: 'users', count: countBefore },
  { name: 'reports', path: 'reports', count: countBefore }
];
const existingCounters = (await root.child('usageAggregates/counters').get()).val() || {};
const cutoffs = Object.fromEntries(specs.map(spec => [
  spec.name,
  Number.isFinite(existingCounters[spec.name]?.trackingStartedAt)
    ? existingCounters[spec.name].trackingStartedAt
    : startedAt
]));
cutoffs.messages = Number.isFinite(existingCounters.messages?.trackingStartedAt)
  ? existingCounters.messages.trackingStartedAt
  : startedAt;

const deltas = {};
for (const spec of specs) {
  const old = existingCounters[spec.name];
  if (old?.historicalBackfillCompletedAt) { deltas[spec.name] = 0; continue; }
  deltas[spec.name] = countBefore(await root.child(spec.path).get(), cutoffs[spec.name]);
}
if (!existingCounters.messages?.historicalBackfillCompletedAt) {
  deltas.messages = await countMessagesBefore(cutoffs.messages);
} else deltas.messages = 0;

console.log(JSON.stringify({
  mode: apply ? 'APPLY' : 'DRY RUN',
  note: 'Counts extant records created before each counter tracking start. Deleted records and historical attachment uploads/API errors cannot be reconstructed from current data.',
  plannedAdds: deltas,
  currentCounters: Object.fromEntries(['registrations','messages','reports'].map(name => [name, existingCounters[name] || null]))
}, null, 2));

if (!apply) {
  console.log('No database changes made. Review the plan, take a database backup, then rerun with --apply to commit the one-time backfill.');
  process.exit(0);
}

for (const [name, delta] of Object.entries(deltas)) {
  const ref = root.child('usageAggregates/counters/' + name);
  await ref.transaction(old => {
    if (old?.historicalBackfillCompletedAt) return old;
    const cutoff = Number.isFinite(old?.trackingStartedAt) ? old.trackingStartedAt : cutoffs[name];
    return {
      ...(old || {}),
      value: Math.max(0, Number(old?.value) || 0) + delta,
      trackingStartedAt: cutoff,
      historicalBackfillCompletedAt: Date.now(),
      historicalBackfillAdded: delta
    };
  });
}
console.log('Historical backfill finished. Review the output and verify dashboard totals.');
