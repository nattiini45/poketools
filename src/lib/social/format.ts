import { buildEmbed } from '@/lib/discord/embeds';
import type { Locale } from '@/i18n/config';
import { DEFAULT_FORMAT_OPTIONS, type WebhookFormatOptions } from '@/types/discord';
import type { SocialEventPayload, SocialPostOptions, SocialProvider } from '@/types/social';

const CHARACTER_LIMITS: Record<SocialProvider, number> = {
  x: 280,
  threads: 500,
  bluesky: 300,
};

const EMBED_OPTIONS: WebhookFormatOptions = {
  ...DEFAULT_FORMAT_OPTIONS,
  spoiler_results: false,
  show_pokemon_details: false,
  ping_next_drafter: false,
  attach_match_card: false,
};

function sanitizeDiscordFormatting(text: string): string {
  return text
    .replaceAll('||', '')
    .replace(/<@(\d+)>/g, '@$1')
    .replace(/\*\*/g, '')
    .trim();
}

function toHashtags(payload: SocialEventPayload): string[] {
  const tags = ['#Poketools'];

  if (payload.event_type.startsWith('draft_')) tags.push('#PokemonDraft');
  if (payload.event_type.startsWith('round_')) tags.push('#PokemonTournament');
  if (payload.event_type.startsWith('match_')) tags.push('#PokemonBattle');

  if (
    payload.event_type === 'achievement_unlocked'
    || payload.event_type === 'streak_milestone'
    || payload.event_type === 'rating_milestone'
  ) {
    tags.push('#PokemonLeague');
  }

  return tags;
}

function truncateToLimit(text: string, provider: SocialProvider): string {
  const limit = CHARACTER_LIMITS[provider];
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/**
 * The post text for one provider, in `lang`: the league's content language
 * that `emitAsync` resolved (i18n-core §6.3; social integrations have no
 * per-target language). The copy is the Discord embed's, flattened.
 */
export function formatSocialPost(
  payload: SocialEventPayload,
  provider: SocialProvider,
  postOptions: SocialPostOptions,
  lang: Locale,
): string {
  const { embed, content } = buildEmbed(
    payload,
    {
      ...EMBED_OPTIONS,
      show_replay_link: postOptions.include_replay_link,
    },
    lang,
  );

  const sections: string[] = [];
  if (content) {
    sections.push(sanitizeDiscordFormatting(content));
  }

  sections.push(sanitizeDiscordFormatting(embed.title));
  sections.push(sanitizeDiscordFormatting(embed.description));

  if (embed.fields?.length) {
    for (const field of embed.fields) {
      const fieldName = sanitizeDiscordFormatting(field.name);
      const fieldValue = sanitizeDiscordFormatting(field.value);
      sections.push(`${fieldName}: ${fieldValue}`);
    }
  }

  let body = sections
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join('\n\n');

  if (postOptions.include_hashtags) {
    body = `${body}\n\n${toHashtags(payload).join(' ')}`;
  }

  return truncateToLimit(body, provider);
}
