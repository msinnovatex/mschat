import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, validatePassword, normalizeEmail, normalizeUsername, sha, publicUser, sessionCookieHeader } from '../lib/core.js';

test('normalization is deterministic and case-insensitive', () => {
  assert.equal(normalizeEmail('  USER@Example.COM '), 'user@example.com');
  assert.equal(normalizeUsername('  SiDiK_01 '), 'sidik_01');
  assert.equal(sha('same'), sha('same'));
  assert.notEqual(sha('same'), sha('different'));
});

test('password policy rejects weak and oversized values', () => {
  assert.equal(validatePassword('short'), false);
  assert.equal(validatePassword('long-enough-password'), true);
  assert.equal(validatePassword('x'.repeat(129)), false);
  assert.equal(validatePassword('valid-password\nwith-line-break'), false);
});

test('password hashes verify without storing plaintext', async () => {
  const password = 'a-long-unique-test-password';
  const stored = await hashPassword(password);
  assert.match(stored, /^scrypt\$/);
  assert.equal(stored.includes(password), false);
  assert.equal(await verifyPassword(password, stored), true);
  assert.equal(await verifyPassword('wrong-password', stored), false);
  assert.equal(await verifyPassword(password, 'invalid'), false);
});

test('public user serialization excludes password and private fields', () => {
  const safe = publicUser({ id: 'u1', fullName: 'Example User', username: 'example', email: 'e@example.com', passwordHash: 'secret', role: 'admin', publicKey: { x: 'secret' }, createdAt: 1 });
  assert.deepEqual(Object.keys(safe).sort(), ['avatarUrl', 'createdAt', 'email', 'fullName', 'id', 'username'].sort());
  assert.equal('passwordHash' in safe, false);
  assert.equal('publicKey' in safe, false);
});

test('session cookie builder emits a persistent HttpOnly cookie', () => {
  const header = sessionCookieHeader('random-token', 86400);
  assert.match(header, /^mschat_session=random-token;/);
  assert.match(header, /Path=\//);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Max-Age=86400/);
  assert.equal(header.includes('; Secure'), process.env.NODE_ENV === 'production');
});

test('origin policy accepts only configured exact origins and same-site requests', async () => {
  const { checkOrigin } = await import('../lib/core.js');
  const oldOrigins = process.env.ALLOWED_ORIGINS;
  const oldBase = process.env.APP_BASE_URL;
  try {
    process.env.ALLOWED_ORIGINS = 'https://chat.example.com,http://localhost:5173';
    delete process.env.APP_BASE_URL;
    assert.equal(checkOrigin({ headers: { origin: 'https://chat.example.com', 'sec-fetch-site': 'same-origin' } }), true);
    assert.equal(checkOrigin({ headers: { origin: 'https://chat.example.com.evil.test', 'sec-fetch-site': 'same-origin' } }), false);
    assert.equal(checkOrigin({ headers: { origin: 'https://chat.example.com', 'sec-fetch-site': 'cross-site' } }), false);
    assert.equal(checkOrigin({ headers: { 'sec-fetch-site': 'same-origin' } }), false);
  } finally {
    if (oldOrigins === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = oldOrigins;
    if (oldBase === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = oldBase;
  }
});

test('production session cookies are Secure, HttpOnly and SameSite=Lax', () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const header = sessionCookieHeader('token with space', 3600);
    assert.match(header, /^mschat_session=token%20with%20space;/);
    assert.match(header, /; Secure/);
    assert.match(header, /; HttpOnly/);
    assert.match(header, /; SameSite=Lax/);
    assert.match(header, /; Max-Age=3600/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});
