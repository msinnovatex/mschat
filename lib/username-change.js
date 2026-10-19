export const USERNAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export function isValidUsername(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_]{3,24}$/.test(value);
}

export function normalizeUsernameValue(value) {
  return String(value || '').trim().toLowerCase();
}

export function usernameChangeAvailableAt(lastChangeAt, now = Date.now()) {
  if (!Number.isFinite(lastChangeAt) || lastChangeAt <= 0) return 0;
  const availableAt = lastChangeAt + USERNAME_CHANGE_COOLDOWN_MS;
  return availableAt > now ? availableAt : 0;
}

export function canClaimUsername(currentOwner, uid) {
  return currentOwner == null || currentOwner === uid;
}
