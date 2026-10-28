/**
 * Request bodies of `/api/push/subscriptions` (docs/push.md, "API"). Server only (decodes base64url with Buffer).
 *
 * The endpoint's HOST is checked separately in the route (`isAllowedPushEndpoint`), so an unsupported push
 * service answers its own code (`push_endpoint_not_allowed`) and not the generic invalid-body one.
 *
 * What a browser's `PushSubscription.toJSON()` gives: `p256dh` is the receiver's uncompressed P-256 public key
 * (65 bytes, first byte 0x04) and `auth` a 16-byte secret, both base64url without padding. Anything else could
 * not be encrypted to, so it is refused here instead of failing at the first send.
 */
import 'server-only';

import { z } from 'zod';
import { LOCALES } from '@/i18n/config';
import { PUSH_ENDPOINT_MAX_LENGTH } from './endpoint';

/** Largest request body the routes read (a subscription is about 500 bytes). */
export const PUSH_BODY_MAX_BYTES = 8 * 1024;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function decodedLength(value: string): number {
  return Buffer.from(value, 'base64url').length;
}

const endpointText = z.string().min(1).max(PUSH_ENDPOINT_MAX_LENGTH);

const p256dhKey = z
  .string()
  .max(128)
  .regex(BASE64URL)
  .refine((value) => decodedLength(value) === 65 && Buffer.from(value, 'base64url')[0] === 0x04, {
    message: 'p256dh must be an uncompressed P-256 point',
  });

const authKey = z
  .string()
  .max(64)
  .regex(BASE64URL)
  .refine((value) => decodedLength(value) === 16, { message: 'auth must be 16 bytes' });

/** `POST`: subscribe (or refresh) this device. */
export const subscribeBodySchema = z
  .object({
    endpoint: endpointText,
    keys: z.object({ p256dh: p256dhKey, auth: authKey }).strict(),
    /** The UI language; the route falls back to the request's language cookie. */
    locale: z.enum(LOCALES).optional(),
    /** The endpoint this one replaces (a `pushsubscriptionchange` re-subscribe); removed after the new one is stored. */
    replaces: endpointText.optional(),
  })
  .strict();

export type SubscribeBody = z.infer<typeof subscribeBodySchema>;

/** `DELETE`: one of the caller's devices, by endpoint (this browser) or by row id (the settings list). */
export const unsubscribeBodySchema = z.union([
  z.object({ endpoint: endpointText }).strict(),
  z.object({ id: z.uuid() }).strict(),
]);

export type UnsubscribeBody = z.infer<typeof unsubscribeBodySchema>;
