/**
 * Photo transform consent: the version the client sends with each transform,
 * and the English consent text of that version, kept here for audit.
 * Must match the language agreed upon in docs/photo-transform-design.md.
 *
 * The UI renders the consent and the loading messages from the `avatar`
 * namespace (`avatarMessages.transform.consent` / `.transform.loading.*`), whose
 * English consent equals `PHOTO_TRANSFORM_CONSENT` (checked by `consent.test.ts`).
 * Changing the consent wording means a new version here and new copy there.
 */

export const PHOTO_TRANSFORM_CONSENT_VERSION = '2026-03-20';

export const PHOTO_TRANSFORM_CONSENT = `Your photo will be sent to an AI service to generate a Pokémon trainer-style avatar. Your original photo is processed in memory and immediately discarded — it is never stored. Generated avatars can be saved to your gallery and deleted there at any time.`;

/** Message keys (`avatarMessages.transform.loading.<key>`) rotated while a transform runs. */
export const PHOTO_TRANSFORM_LOADING_MESSAGE_KEYS = [
  'training',
  'channeling',
  'professor',
  'pixels',
  'starter',
] as const;

export type PhotoTransformLoadingKey = (typeof PHOTO_TRANSFORM_LOADING_MESSAGE_KEYS)[number];
