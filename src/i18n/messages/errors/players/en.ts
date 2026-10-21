/**
 * Error catalog `errors/players` (owner A1 after the G0-ERR seed, i18n-core §4.1):
 * players, guest claims, avatars (upload, AI generation, photo transform,
 * gallery, 3D trainer), achievements, ratings, signatures, streaks and the
 * first-run bootstrap.
 *
 * Keys are the existing `code` literals, copied verbatim, plus the codes A1
 * added. `en` is the current English server message (templates as `{param}`
 * placeholders); the server keeps sending its own English `error`, and
 * clients translate by `code`. Daily generation limits use
 * `errors/common.daily_limit_reached`.
 */
export default {
  NOT_GUEST: 'Target player is not a guest account',
  SOURCE_NOT_FOUND: 'Source player not found',
  SOURCE_IS_GUEST: 'Source player must be a registered account',
  SOURCE_HAS_ACTIVITY: 'Source account has existing activity — use substitute instead',
  SOURCE_NOT_ACTIVE: 'Source account is banned or suspended',
  claim_same_player: 'Guest and source account must be different players',
  player_not_found: 'Player not found',
  // A path id that is not a UUID names no player (404 before the query)
  INVALID_PLAYER_ID: 'Player not found',
  player_identity_required: 'A registered player needs a Discord ID or a linked account. Only guests may have neither.',
  player_identity_taken: 'This Discord ID or account already belongs to another player.',
  player_update_forbidden: 'Not authorized to update this player',
  creator_status_superadmin_only: 'Only the superadmin can manage creator status',
  player_has_match_history: {
    one: 'Cannot delete a player with match history ({count} match). Suspend or ban them instead.',
    other: 'Cannot delete a player with match history ({count} matches). Suspend or ban them instead.',
  },
  player_still_referenced: 'Cannot delete this player because other records still reference them.',
  player_in_active_draft:
    'Cannot delete a player who is seated in an unfinished draft. Finish or cancel the draft, or remove the player from it, first.',
  avatar_edit_forbidden: 'Not authorized to edit this avatar',
  showdown_sprite_invalid: 'Invalid Showdown sprite id',
  showdown_sprite_url_invalid: 'Invalid Showdown sprite URL',
  gallery_item_not_found: 'Gallery item not found',
  gallery_item_not_owned: "Cannot use another player's gallery image",
  gallery_item_delete_forbidden: "Cannot delete another player's gallery item",
  gallery_item_delete_failed: 'Failed to delete gallery item',
  avatar_fields_missing: 'Missing required fields: image, config',
  avatar_config_invalid: 'Invalid avatar config',
  avatar_image_invalid: 'Invalid image',
  avatar_image_invalid_base64: 'Invalid base64 encoding',
  avatar_file_too_large: 'File too large (max {max}MB)',
  avatar_image_too_small: 'File too small to be a valid image',
  avatar_image_format_unsupported: 'Unsupported image format. Use JPEG, PNG, or WebP.',
  avatar_image_format_mismatch: 'Image format mismatch',
  avatar_image_too_large: 'Avatar image too large (max {max})',
  avatar_image_unprocessable: 'Avatar image could not be processed',
  avatar_upload_failed: 'Failed to upload avatar',
  avatar_thumbnail_upload_failed: 'Failed to upload avatar thumbnail',
  avatar_delete_failed: 'Failed to delete avatar',
  avatar_choices_invalid: 'Invalid choices',
  avatar_generation_failed: 'Image generation failed',
  avatar_consent_outdated: 'Consent text has changed. Please review and accept again.',
  avatar_moderation_unavailable: 'Image safety checks are currently unavailable. Please try again later.',
  avatar_image_rejected: "This image couldn't be processed. Please try a different photo.",
  avatar_transform_failed: 'Photo transform failed',
  avatar_3d_not_owned: "Cannot modify another player's avatar",
  avatar_3d_config_invalid: 'Invalid avatar configuration',
  avatar_3d_save_failed: 'Failed to save 3D avatar',
  bootstrap_not_configured: 'BOOTSTRAP_SECRET not configured on server.',
  bootstrap_secret_invalid: 'Invalid or missing bootstrap secret.',
  bootstrap_admin_exists: 'Bootstrap disabled — an admin already exists. Ask an admin to grant roles in the admin panel.',
  bootstrap_sign_in_required: 'You must be signed in to bootstrap.',
  bootstrap_player_missing: 'Your player profile was not found. Sign out and back in, then try again.',
  INVALID_GALLERY_ITEM_ID: 'Gallery item not found',
  INVALID_ACHIEVEMENT_ID: 'Achievement not found',
} as const;
