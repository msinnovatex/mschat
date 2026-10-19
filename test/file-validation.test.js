import test from 'node:test';
import assert from 'node:assert/strict';
import { hasExpectedSignature } from '../src/file-validation.js';

const file = bytes => new Blob([Uint8Array.from(bytes)]);
const ascii = value => [...value].map(char => char.charCodeAt(0));

test('accepts common valid attachment signatures', async () => {
  assert.equal(await hasExpectedSignature(file([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'), true);
  assert.equal(await hasExpectedSignature(file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'), true);
  assert.equal(await hasExpectedSignature(file([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')]), 'image/webp'), true);
  assert.equal(await hasExpectedSignature(file(ascii('%PDF-1.7')), 'application/pdf'), true);
  assert.equal(await hasExpectedSignature(file([...ascii('PK'), 0x03, 0x04, 1, 2]), 'application/zip'), true);
  assert.equal(await hasExpectedSignature(file(ascii('hello\nworld')), 'text/plain'), true);
});

test('rejects MIME/signature mismatches, empty files, and unknown types', async () => {
  assert.equal(await hasExpectedSignature(file(ascii('%PDF-1.7')), 'image/png'), false);
  assert.equal(await hasExpectedSignature(file([]), 'application/pdf'), false);
  assert.equal(await hasExpectedSignature(file(ascii('hello')), 'application/x-executable'), false);
  assert.equal(await hasExpectedSignature(file([0, 1, 2, 3]), 'text/plain'), false);
});

test('recognizes supported video signatures', async () => {
  assert.equal(await hasExpectedSignature(file([...new Array(4).fill(0), ...ascii('ftyp'), ...ascii('isom')]), 'video/mp4'), true);
  assert.equal(await hasExpectedSignature(file([0x1a, 0x45, 0xdf, 0xa3, ...ascii('webm')]), 'video/webm'), true);
});
