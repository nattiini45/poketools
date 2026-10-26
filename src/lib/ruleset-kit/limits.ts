/**
 * Size limits of a ruleset document. The document is flat and small, so the limits are about the lists: a National Dex
 * ban list stays far below them, a roster allowlist (Champions) well below too.
 */
export const MAX_IDS_PER_LIST = 3000;
export const MAX_ID_LENGTH = 64;
export const MAX_CLAUSE_IDS = 64;
export const MAX_NAME_CHARS = 120;
export const MAX_CUSTOM_RULES_CHARS = 5000;
export const MAX_BASED_ON_CHARS = 64;
/** Canonical JSON bytes of a whole document (the same cap as a format document and the database CHECKs). */
export const MAX_DOCUMENT_BYTES = 262_144;
