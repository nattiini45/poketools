import type { Player, PublicPlayer } from '@/types/player';
import type { PlayerProfile } from '@/types/profile';
import { toPublicPlayer } from '@/lib/players/public-player';

/**
 * The player row a visitor may see: the `PublicPlayer` profile card only
 * (`{ id, name, avatar_url, ps_username, champions_username, joined_date,
 * is_creator, is_guest }`). An allowlist (`toPublicPlayer`), so the identity,
 * moderation and admin columns, and any column added to `players` later, stay
 * out of the public profile and of the public read cache.
 */
export function redactPlayer(player: Player): PublicPlayer {
  return toPublicPlayer(player);
}

/** Profile fields safe to show without login */
export interface PublicProfileView {
  player: PublicPlayer;
  headline: PlayerProfile['headline'];
  recent_form: PlayerProfile['recent_form'];
  most_used_pokemon: PlayerProfile['most_used_pokemon'];
  best_kill_pokemon: PlayerProfile['best_kill_pokemon'];
  rating: PlayerProfile['rating'];
  signatures: PlayerProfile['signatures'];
  achievements: PlayerProfile['achievements'];
  trophies: PlayerProfile['trophies'];
  current_participations: PlayerProfile['current_participations'];
  past_participations: PlayerProfile['past_participations'];
}

export function toPublicProfileView(profile: PlayerProfile): PublicProfileView {
  return {
    player: redactPlayer(profile.player),
    headline: profile.headline,
    recent_form: profile.recent_form,
    most_used_pokemon: profile.most_used_pokemon,
    best_kill_pokemon: profile.best_kill_pokemon,
    rating: profile.rating,
    signatures: profile.signatures,
    achievements: profile.achievements,
    trophies: profile.trophies,
    current_participations: profile.current_participations,
    past_participations: profile.past_participations,
  };
}
