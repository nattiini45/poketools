/**
 * Error catalog `errors/auth` (owner A1, i18n-core §4.1): sign-up, email
 * confirmation, password reset, login methods (link email / link Discord)
 * and account settings.
 *
 * `en` is the current English server message, verbatim; the server keeps
 * sending its own English `error`, and clients translate by `code`.
 * Validation, JSON-body, rate-limit and auth-guard failures use the shared
 * `errors/common` codes and are not repeated here.
 */
export default {
  signup_failed: 'Signup failed. Check your email and password and try again.',
  signup_error: 'Signup failed',
  confirm_link_invalid: 'Confirmation link is invalid or has expired. Request a new one below.',
  email_confirmation_failed: 'Email confirmation failed',
  verification_resend_failed: 'Failed to resend verification email',
  password_reset_email_failed: 'Failed to send password reset email',
  reset_link_invalid: 'Reset link is invalid or has expired. Request a new one.',
  password_reset_failed: 'Password reset failed',
  player_registration_required: 'Player registration required',
  discord_already_linked: 'A Discord account is already linked.',
  discord_link_start_failed: 'Failed to start Discord linking',
  email_login_already_linked: 'An email login is already linked to this account.',
  email_login_create_failed: 'Could not create the email login. Check the email and password and try again.',
  email_already_registered: 'This email is already registered.',
  email_login_link_failed: 'Failed to link email login',
  world_experience_invalid: "worldExperience must be one of 'auto', 'on' or 'off'.",
  world_experience_save_failed: 'Failed to save the 3D world setting',
} as const;
