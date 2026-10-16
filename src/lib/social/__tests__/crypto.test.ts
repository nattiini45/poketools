import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { encryptJson, decryptJson } from '../crypto';

// A valid 32-byte hex key (64 hex chars)
const TEST_HEX_KEY = 'a'.repeat(64);
// A valid 32-byte base64 key
const TEST_BASE64_KEY = Buffer.from('b'.repeat(32), 'utf8').toString('base64');
// A valid 32-byte utf8 key (exactly 32 ASCII chars)
const TEST_UTF8_KEY = 'c'.repeat(32);

describe('encryptJson / decryptJson', () => {
  const originalEnv = process.env.SOCIAL_INTEGRATION_ENCRYPTION_KEY;

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.SOCIAL_INTEGRATION_ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.SOCIAL_INTEGRATION_ENCRYPTION_KEY;
    }
  });

  describe('with hex key', () => {
    beforeAll(() => {
      process.env.SOCIAL_INTEGRATION_ENCRYPTION_KEY = TEST_HEX_KEY;
    });

    it('round-trips a simple object', () => {
      const payload = { provider: 'x', access_token: 'tok123' };
      const encrypted = encryptJson(payload);
      const decrypted = decryptJson(encrypted);
      expect(decrypted).toEqual(payload);
    });

    it('round-trips a nested object', () => {
      const payload = { a: { b: [1, 2, 3] }, c: true };
      const encrypted = encryptJson(payload);
      const decrypted = decryptJson(encrypted);
      expect(decrypted).toEqual(payload);
    });

    it('produces different ciphertext each time (random IV)', () => {
      const payload = { key: 'value' };
      const enc1 = encryptJson(payload);
      const enc2 = encryptJson(payload);
      expect(enc1).not.toBe(enc2);
    });

    it('encrypted output has 3 dot-separated segments', () => {
      const encrypted = encryptJson({ x: 1 });
      const segments = encrypted.split('.');
      expect(segments).toHaveLength(3);
    });

    it('each segment is valid base64', () => {
      const encrypted = encryptJson({ x: 1 });
      const segments = encrypted.split('.');
      for (const seg of segments) {
        expect(Buffer.from(seg, 'base64').toString('base64')).toBe(seg);
      }
    });
  });

  describe('with base64 key', () => {
    beforeAll(() => {
      process.env.SOCIAL_INTEGRATION_ENCRYPTION_KEY = TEST_BASE64_KEY;
    });

    it('round-trips an object', () => {
      const payload = { provider: 'bluesky', handle: 'test.bsky.social' };
      const encrypted = encryptJson(payload);
      const decrypted = decryptJson(encrypted);
      expect(decrypted).toEqual(payload);
    });
  });

  describe('with utf8 key', () => {
    beforeAll(() => {
      process.env.SOCIAL_INTEGRATION_ENCRYPTION_KEY = TEST_UTF8_KEY;
    });

    it('round-trips an object', () => {
      const payload = { token: 'secret' };
      const encrypted = encryptJson(payload);
      const decrypted = decryptJson(encrypted);
      expect(decrypted).toEqual(payload);
    });
  });

  describe('decryptJson error cases', () => {
    beforeAll(() => {
      process.env.SOCIAL_INTEGRATION_ENCRYPTION_KEY = TEST_HEX_KEY;
    });

    it('throws on invalid segment count (too few)', () => {
      expect(() => decryptJson('abc.def')).toThrow('Invalid encrypted payload format');
    });

    it('throws on invalid segment count (too many)', () => {
      expect(() => decryptJson('a.b.c.d')).toThrow('Invalid encrypted payload format');
    });

    it('throws on tampered ciphertext', () => {
      const encrypted = encryptJson({ secret: true });
      const segments = encrypted.split('.');
      // Corrupt the ciphertext segment
      segments[2] = Buffer.from('corrupted-data').toString('base64');
      expect(() => decryptJson(segments.join('.'))).toThrow();
    });

    it('throws on tampered auth tag', () => {
      const encrypted = encryptJson({ secret: true });
      const segments = encrypted.split('.');
      // Corrupt the auth tag
      segments[1] = Buffer.from('bad-tag-value!!!').toString('base64');
      expect(() => decryptJson(segments.join('.'))).toThrow();
    });

    it('throws on an auth tag with an unexpected length', () => {
      const encrypted = encryptJson({ secret: true });
      const segments = encrypted.split('.');
      segments[1] = Buffer.from('short-tag').toString('base64');
      expect(() => decryptJson(segments.join('.'))).toThrow('Invalid encrypted payload format');
    });

    it('throws on an IV with an unexpected length', () => {
      const encrypted = encryptJson({ secret: true });
      const segments = encrypted.split('.');
      segments[0] = Buffer.from('short-iv').toString('base64');
      expect(() => decryptJson(segments.join('.'))).toThrow('Invalid encrypted payload format');
    });
  });

  describe('missing or invalid key', () => {
    it('throws when env var is not set', () => {
      delete process.env.SOCIAL_INTEGRATION_ENCRYPTION_KEY;
      expect(() => encryptJson({ x: 1 })).toThrow(
        'SOCIAL_INTEGRATION_ENCRYPTION_KEY is not configured',
      );
    });

    it('throws when key is wrong length', () => {
      process.env.SOCIAL_INTEGRATION_ENCRYPTION_KEY = 'too-short';
      expect(() => encryptJson({ x: 1 })).toThrow(
        'SOCIAL_INTEGRATION_ENCRYPTION_KEY must decode to 32 bytes',
      );
    });
  });
});
