/**
 * Namespace `outbound/social` (owner T17, i18n-core §6.3): copy that only
 * social posts use. Event posts reuse the Discord embed text
 * (`outbound/discord`, flattened by `formatSocialPost`); this holds the admin
 * test post. Hashtags stay English brand tags and are not translated.
 */
export default {
  testPost: {
    title: 'PokeTools social integration test',
    provider: 'Provider: {provider}',
    label: 'Label: {label}',
    time: 'Time: {time}',
  },
} as const;
