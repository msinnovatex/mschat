const text = bytes => String.fromCharCode(...bytes);
const startsWith = (bytes, signature) => signature.every((value, index) => bytes[index] === value);
const includesAscii = (bytes, value) => {
  const wanted = [...value].map(char => char.charCodeAt(0));
  for (let i = 0; i <= bytes.length - wanted.length; i++) {
    if (wanted.every((byte, offset) => bytes[i + offset] === byte)) return true;
  }
  return false;
};

/**
 * Lightweight client-side file signature check. This is a usability guard only;
 * the server must independently validate upload size, MIME and content.
 */
export async function hasExpectedSignature(file, mimeType) {
  if (!file || typeof file.slice !== 'function' || !Number.isFinite(file.size) || file.size < 1) return false;
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const mime = String(mimeType || '').toLowerCase();
  if (mime === 'image/jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (mime === 'image/png') return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mime === 'image/webp') return text(bytes.slice(0, 4)) === 'RIFF' && text(bytes.slice(8, 12)) === 'WEBP';
  if (mime === 'image/avif') return text(bytes.slice(4, 8)) === 'ftyp' && (includesAscii(bytes, 'avif') || includesAscii(bytes, 'avis'));
  if (mime === 'video/mp4') return text(bytes.slice(4, 8)) === 'ftyp' && ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash'].includes(text(bytes.slice(8, 12)));
  if (mime === 'video/webm') return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]) && includesAscii(bytes, 'webm');
  if (mime === 'application/pdf') return text(bytes.slice(0, 5)) === '%PDF-';
  if (mime === 'application/zip' || mime.startsWith('application/vnd.openxmlformats-officedocument.')) {
    return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08]);
  }
  if (['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint'].includes(mime)) {
    return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  }
  if (mime === 'text/plain') {
    if (bytes.includes(0)) return false;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return !bytes.some(byte => byte < 0x09 || (byte > 0x0d && byte < 0x20));
    } catch {
      return false;
    }
  }
  return false;
}
