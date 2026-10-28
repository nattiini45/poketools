import { describe, expect, it } from 'vitest';
import { PUSH_BODY_MAX_BYTES, subscribeBodySchema, unsubscribeBodySchema } from '../validation';
import { FCM_ENDPOINT, makeBrowserKeys } from './fixtures';

const keys = makeBrowserKeys();
const valid = { endpoint: FCM_ENDPOINT, keys, locale: 'de' };

describe('subscribeBodySchema', () => {
  it('accepts what a browser produces', () => {
    expect(subscribeBodySchema.safeParse(valid).success).toBe(true);
    expect(subscribeBodySchema.safeParse({ endpoint: FCM_ENDPOINT, keys }).success).toBe(true);
    expect(subscribeBodySchema.safeParse({ ...valid, replaces: `${FCM_ENDPOINT}-old` }).success).toBe(true);
  });

  it.each([
    ['an unknown top-level key', { ...valid, player_id: 'p2' }],
    ['an unknown key inside keys', { ...valid, keys: { ...keys, extra: 'x' } }],
    ['expirationTime (the route takes only what it stores)', { ...valid, expirationTime: null }],
    ['a missing endpoint', { keys }],
    ['an empty endpoint', { ...valid, endpoint: '' }],
    ['an endpoint over 1024 characters', { ...valid, endpoint: `https://fcm.googleapis.com/${'a'.repeat(1100)}` }],
    ['missing keys', { endpoint: FCM_ENDPOINT }],
    ['an empty auth', { ...valid, keys: { ...keys, auth: '' } }],
    ['a p256dh that is not base64url', { ...valid, keys: { ...keys, p256dh: 'not base64!!' } }],
    ['a p256dh of the wrong length', { ...valid, keys: { ...keys, p256dh: 'AAAA' } }],
    ['a p256dh that is not an uncompressed point', { ...valid, keys: { ...keys, p256dh: Buffer.alloc(65, 2).toString('base64url') } }],
    ['an auth of the wrong length', { ...valid, keys: { ...keys, auth: Buffer.alloc(8).toString('base64url') } }],
    ['an oversized auth', { ...valid, keys: { ...keys, auth: 'A'.repeat(500) } }],
    ['an unsupported locale', { ...valid, locale: 'fr' }],
    ['a non-string endpoint', { ...valid, endpoint: 5 }],
  ])('rejects %s', (_label, body) => {
    expect(subscribeBodySchema.safeParse(body).success).toBe(false);
  });

  it('leaves the allow-list to the route (a valid-looking host still parses)', () => {
    expect(subscribeBodySchema.safeParse({ ...valid, endpoint: 'https://push.example.com/x' }).success).toBe(true);
  });

  it('keeps the body cap above a real subscription and far below abuse', () => {
    expect(JSON.stringify(valid).length).toBeLessThan(PUSH_BODY_MAX_BYTES / 4);
  });
});

describe('unsubscribeBodySchema', () => {
  it('takes an endpoint or a row id, not both and not more', () => {
    expect(unsubscribeBodySchema.safeParse({ endpoint: FCM_ENDPOINT }).success).toBe(true);
    expect(unsubscribeBodySchema.safeParse({ id: '6f9619ff-8b86-4d11-b42d-00c04fc964ff' }).success).toBe(true);
    expect(unsubscribeBodySchema.safeParse({ id: 'nope' }).success).toBe(false);
    expect(unsubscribeBodySchema.safeParse({ endpoint: FCM_ENDPOINT, id: '6f9619ff-8b86-4d11-b42d-00c04fc964ff' }).success).toBe(false);
    expect(unsubscribeBodySchema.safeParse({}).success).toBe(false);
    expect(unsubscribeBodySchema.safeParse({ endpoint: FCM_ENDPOINT, player_id: 'p2' }).success).toBe(false);
  });
});
