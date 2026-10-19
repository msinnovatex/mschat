export function countActiveUsers(presence, now = Date.now()) {
  if (!presence || typeof presence !== 'object') return 0;
  let count = 0;
  for (const user of Object.values(presence)) {
    const sessions = user?.sessions;
    if (!sessions || typeof sessions !== 'object') continue;
    if (Object.values(sessions).some(session => Number(session?.expiresAt) > now)) count++;
  }
  return count;
}
