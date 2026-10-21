/**
 * Namespace `auth` (owner T01, i18n-core §11.3): the `/auth/*` pages and
 * forms. API failures render through `errors/auth`; the keys here are the
 * client's own copy. `signIn.errors` and `errorPage.codes` are keyed by the
 * NextAuth / account-linking `?error=` code verbatim.
 */
export default {
  fields: {
    email: 'Email',
    password: 'Password',
    confirmPassword: 'Confirm password',
    newPassword: 'New password',
    confirmNewPassword: 'Confirm new password',
    displayName: 'Display name',
    displayNameHint: 'Shown on standings, match pages, and your profile.',
    passwordHint: 'At least 8 characters.',
  },
  passwordsMismatch: 'Passwords do not match.',
  signIn: {
    title: 'Sign in',
    discord: 'Sign in with Discord',
    orEmail: 'or with email',
    submit: 'Sign in',
    forgotPassword: 'Forgot password?',
    createAccount: 'Create an account',
    invalidCredentials: 'Invalid email or password.',
    tooManyAttempts: 'Too many sign-in attempts. Wait a few minutes and try again.',
    verifyFirst: 'Please verify your email before signing in.',
    resendVerification: 'Resend verification email',
    errors: {
      OAuthCallbackError: 'Discord sign-in failed. Please try again.',
      OAuthSignin: 'Discord sign-in failed. Please try again.',
      AccessDenied: 'Sign-in was cancelled or denied.',
      Configuration: 'Sign-in is misconfigured. Please contact an admin.',
      Default: 'Sign-in failed. Please try again.',
    },
  },
  signUp: {
    title: 'Create an account',
    discordHint: 'Have Discord? You can sign in with it directly — no signup needed.',
    submit: 'Create account',
    haveAccount: 'Already have an account?',
    signIn: 'Sign in',
    failed: 'Signup failed. Please try again.',
  },
  forgotPassword: {
    title: 'Reset your password',
    intro:
      "Enter your email and we'll send you a reset link. (Discord-only accounts don't have a password — just sign in with Discord.)",
    submit: 'Send reset link',
    backToSignIn: 'Back to sign in',
    sent: 'If an account exists for that email, a password reset link is on its way.',
    failed: 'Something went wrong. Please try again.',
  },
  resetPassword: {
    title: 'Choose a new password',
    missingToken: 'This reset link is missing its token. Open the link from your email again, or request a new one.',
    requestNew: 'Request a new reset link',
    submit: 'Set new password',
    done: 'Password updated! You can now sign in.',
    signIn: 'Sign in',
    failed: 'Password reset failed. Please try again.',
  },
  verifyEmail: {
    title: 'Check your inbox',
    intro:
      "We sent a confirmation link. Click it to activate your account, then sign in. Didn't get it? Check spam, or resend below.",
    introTo:
      "We sent a confirmation link to {email}. Click it to activate your account, then sign in. Didn't get it? Check spam, or resend below.",
    resend: 'Resend verification email',
    resent: 'If that email has a pending signup, a new confirmation email is on its way.',
    failed: 'Failed to resend. Please try again.',
  },
  confirmEmail: {
    title: 'Confirm your email',
    missingToken: 'This confirmation link is missing its token. Open the link from your email again, or request a new one.',
    resend: 'Resend verification email',
    prompt: 'Click below to finish setting up your account.',
    submit: 'Confirm my email',
    done: 'Email confirmed! Your account is ready.',
    signIn: 'Sign in',
    failed: 'Confirmation failed. Please try again.',
  },
  errorPage: {
    title: 'Sign-in problem',
    backToSignIn: 'Back to sign in',
    home: 'Home',
    codes: {
      LinkExpired: 'The Discord link request expired or was invalid. Go to Settings and try linking again.',
      DiscordAlreadyLinked:
        'That Discord account is already linked to a different player. Sign in with Discord directly, or contact an admin to merge accounts.',
      AccessDenied: 'Sign-in was cancelled or denied.',
      Verification: 'The sign-in link is no longer valid.',
      Configuration: 'Sign-in is misconfigured. Please contact an admin.',
      Default: 'Something went wrong during sign-in. Please try again.',
    },
  },
} as const;
