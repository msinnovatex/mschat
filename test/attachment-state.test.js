import test from 'node:test';
import assert from 'node:assert/strict';
import { claimReadyAttachment } from '../lib/attachment-state.js';

const base = {
  id: 'a'.repeat(32),
  ownerId: 'user_123456789012345678',
  conversationId: 'conversation_123',
  status: 'ready',
  key: 'mschat/attachments/conversation_123/file.bin',
  expiresAt: 2000,
  originalSize: 100,
  encryptedSize: 116
};

test('claims a ready, unexpired attachment exactly for its owner and conversation', () => {
  const result = claimReadyAttachment(base, base.ownerId, base.conversationId, 'message_1', 1000);
  assert.equal(result.status, 'linked');
  assert.equal(result.messageId, 'message_1');
  assert.equal(result.linkedAt, 1000);
  assert.equal(result.expiresAt, null);
  assert.equal(base.status, 'ready');
});

test('refuses an attachment claimed by another message or user', () => {
  assert.equal(claimReadyAttachment({ ...base, status: 'linked' }, base.ownerId, base.conversationId, 'message_2', 1000), undefined);
  assert.equal(claimReadyAttachment(base, 'different_user_123456', base.conversationId, 'message_1', 1000), undefined);
  assert.equal(claimReadyAttachment(base, base.ownerId, 'different_conversation', 'message_1', 1000), undefined);
});

test('refuses expired or malformed attachment expiry metadata', () => {
  assert.equal(claimReadyAttachment({ ...base, expiresAt: 1000 }, base.ownerId, base.conversationId, 'message_1', 1000), undefined);
  assert.equal(claimReadyAttachment({ ...base, expiresAt: null }, base.ownerId, base.conversationId, 'message_1', 1000), undefined);
});
