/**
 * Error catalog `errors/common` (owner G0-ERR, i18n-core §1.4, §4.1).
 *
 * Codes shared by every domain: network and unknown failures, validation,
 * rate limits, the auth guards (`AuthError.code`), JSON bodies, generic
 * not-found, the language-switch route and the sprite-style route. `apiErrorText` always consults
 * this catalog first, so domain catalogs never duplicate these keys.
 */
export default {
  network_error: 'Network error. Check your connection and try again.',
  unknown_error: 'Something went wrong. Please try again.',
  upstream_timeout: 'The server took too long to answer. Please try again in a moment.',
  validation_failed: 'Validation failed: {issues}',
  rate_limited: 'Rate limit exceeded. Try again in {seconds}s.',
  rate_limit_unavailable: 'This action is temporarily unavailable. Try again in a minute.',
  daily_limit_reached: 'Daily limit reached ({limit} per day). Try again later.',
  unauthenticated: 'Not authenticated',
  forbidden: 'You do not have permission to do this.',
  account_banned: 'Your account has been banned',
  account_suspended: 'Your account is currently suspended',
  invalid_json: 'Invalid JSON body',
  not_found_generic: 'Not found',
  locale_invalid: "locale must be 'en' or 'de'; pkmnTerms must be 'follow' or 'en'.",
  locale_cross_origin: 'Cross-origin language change refused.',
  locale_save_failed: 'Failed to save the language setting',
  sprite_style_invalid: "style must be one of 'site', 'broadcast', 'home', 'animated' or 'pixel'.",
  sprite_style_cross_origin: 'Cross-origin sprite style change refused.',
  sprite_style_save_failed: 'Failed to save the sprite style',
  sprite_style_load_failed: 'Failed to load the sprite style',
} as const;
