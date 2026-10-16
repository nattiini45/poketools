/**
 * Namespace `agent` (owner T01, i18n-core §11.3): the homepage Professor
 * Linden chat widget and the shared chat-thread copy. Assistant replies and
 * Showdown text stay as the model wrote them. `{pokemon}` in the composer
 * placeholder is a species display name from the pkmn layer.
 */
export default {
  name: 'Professor Linden',
  tagline: 'Your teambuilding assistant',
  badge: 'AI',
  intro: 'Ask the Professor to draft a team, suggest sets, or talk through a matchup.',
  thinking: 'Professor Linden is thinking…',
  placeholder: 'Build me a balanced team around {pokemon}…',
  disclaimer: 'AI-generated — may not be 100% accurate. Enter to send, Shift+Enter for a new line.',
  stop: 'Stop',
  send: 'Send',
  signedOutPlaceholder: 'Sign in with Discord to chat with Professor Linden…',
  signInHint: 'Sign in with Discord to chat.',
  errors: {
    rateLimited: "You've reached today's chat limit with Professor Linden — check back tomorrow!",
    signInRequired: 'Please sign in with Discord to chat.',
    unavailable: 'Professor Linden is unavailable right now. Please try again in a moment.',
    unreachable: 'Failed to reach Professor Linden. Please try again.',
  },
} as const;
