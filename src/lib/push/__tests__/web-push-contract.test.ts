/**
 * The options `send.ts` hands to `web-push` against the REAL library (`generateRequestDetails` builds the request
 * without any network): the topic, TTL, urgency and VAPID details pass the library's own validation, and a payload
 * really is encrypted for a browser-shaped key set.
 */
import { describe, expect, it } from 'vitest';
import { generateRequestDetails } from 'web-push';
import { pushTopic } from '../send';
import { turnPayload } from '../payload';
import { FCM_ENDPOINT, makeBrowserKeys, makeVapidKeys } from './fixtures';

describe('web-push contract', () => {
  it('accepts the sender options and encrypts the payload', () => {
    const vapid = makeVapidKeys();
    const browser = makeBrowserKeys();
    const payload = JSON.stringify(
      turnPayload({ kind: 'turn_started', leagueName: 'EvoLiga', seasonId: 's1', poolId: 'pool-1', timerSeconds: 120 }, 'de'),
    );

    const details = generateRequestDetails({ endpoint: FCM_ENDPOINT, keys: browser }, payload, {
      vapidDetails: { subject: 'mailto:admin@example.com', publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      TTL: 3600,
      urgency: 'high',
      topic: pushTopic('draft-pool-1'),
      timeout: 10_000,
    });

    expect(details.method).toBe('POST');
    expect(details.endpoint).toBe(FCM_ENDPOINT);
    expect(String(details.headers.TTL)).toBe('3600');
    expect(details.headers.Urgency).toBe('high');
    expect(details.headers.Topic).toBe(pushTopic('draft-pool-1'));
    expect(details.headers.Authorization).toMatch(/^vapid t=/);
    expect(details.body).toBeInstanceOf(Buffer);
    // aes128gcm: the ciphertext is not the plaintext.
    expect(details.body?.includes(Buffer.from('EvoLiga'))).toBe(false);
  });

  it('would refuse a topic longer than 32 characters (why the pool id is hashed)', () => {
    const vapid = makeVapidKeys();
    expect(() =>
      generateRequestDetails({ endpoint: FCM_ENDPOINT, keys: makeBrowserKeys() }, 'x', {
        vapidDetails: { subject: 'mailto:admin@example.com', publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        topic: 'draft-4b1a1d0e-aaaa-bbbb-cccc-000000000001',
      }),
    ).toThrow();
  });
});
