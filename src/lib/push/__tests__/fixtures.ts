import { createECDH, randomBytes } from 'node:crypto';

/** A real P-256 key pair in the base64url form VAPID uses. Generated per call; never a real deployment's key. */
export function makeVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    // getPrivateKey() drops leading zero bytes (about 1 key in 256), which is no longer a 32-byte scalar.
    privateKey: Buffer.from(ecdh.getPrivateKey().toString('hex').padStart(64, '0'), 'hex').toString('base64url'),
  };
}

/** A browser-shaped subscription key set: an uncompressed P-256 point and a 16-byte auth secret. */
export function makeBrowserKeys(): { p256dh: string; auth: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
}

export const FCM_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-endpoint-1';
