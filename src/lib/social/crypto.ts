import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const CIPHER_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SEGMENT_COUNT = 3;

function getEncryptionKey(): Buffer {
  const raw = process.env.SOCIAL_INTEGRATION_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('SOCIAL_INTEGRATION_ENCRYPTION_KEY is not configured');
  }

  if (/^[a-fA-F0-9]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  const asBase64 = Buffer.from(raw, 'base64');
  if (asBase64.length === 32) {
    return asBase64;
  }

  const asUtf8 = Buffer.from(raw, 'utf8');
  if (asUtf8.length === 32) {
    return asUtf8;
  }

  throw new Error('SOCIAL_INTEGRATION_ENCRYPTION_KEY must decode to 32 bytes');
}

export function encryptJson(payload: object): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}.${authTag.toString('base64')}.${ciphertext.toString('base64')}`;
}

export function decryptJson<T>(encrypted: string): T {
  const key = getEncryptionKey();
  const segments = encrypted.split('.');
  if (segments.length !== SEGMENT_COUNT) {
    throw new Error('Invalid encrypted payload format');
  }

  const [ivSegment, tagSegment, textSegment] = segments;
  const iv = Buffer.from(ivSegment, 'base64');
  const authTag = Buffer.from(tagSegment, 'base64');
  const ciphertext = Buffer.from(textSegment, 'base64');

  // Enforce the expected IV and auth-tag lengths before constructing the
  // decipher. Without this, an attacker could truncate the tag (or supply a
  // malformed nonce) to bypass the integrity check (CVE-class: GCM
  // tag-length forgery). IV_LENGTH (12 bytes = 96-bit nonce) and
  // AUTH_TAG_LENGTH (16 bytes = 128-bit tag) are what `encryptJson` emits.
  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted payload format');
  }

  const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}
