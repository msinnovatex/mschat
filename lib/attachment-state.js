export function claimReadyAttachment(attachment, ownerId, conversationId, messageId, now) {
  if (!attachment || attachment.ownerId !== ownerId || attachment.conversationId !== conversationId ||
      attachment.status !== 'ready' || !Number.isFinite(attachment.expiresAt) || attachment.expiresAt <= now) {
    return undefined;
  }
  return { ...attachment, status: 'linked', messageId, linkedAt: now, expiresAt: null };
}
