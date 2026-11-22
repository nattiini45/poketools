import { getSessionPlayer } from '@/lib/auth/helpers';
import { getPlayerSpriteStyle } from '@/lib/supabase/queries/player-sprite-style';
import { getDataLocale } from '@/i18n/server';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { SPRITE_PREVIEW_SPECIES, type SpriteStylePreference } from '@/lib/pkmn/sprite-styles';
import SpriteStyleSettingsForm from './SpriteStyleSettingsForm';

/**
 * Settings card for the sprite style (`players.sprite_style`, docs/pkmn.md
 * "Sprite styles"). Server component: the page is authenticated, so the stored
 * value is read here (display read; the write goes through the live guard of
 * `POST /api/sprite-style`). A failed read is logged and disclosed in the card
 * instead of pretending a value; the form then shows the browser's choice and
 * does not re-sync the cookie.
 */
export default async function SpriteStyleSettingsSection() {
  const sessionPlayer = await getSessionPlayer();
  let stored: SpriteStylePreference | null = null;
  let readFailed = false;
  if (sessionPlayer) {
    try {
      stored = await getPlayerSpriteStyle(sessionPlayer.playerId);
    } catch (err) {
      readFailed = true;
      console.error('[settings] sprite_style read failed:', err);
    }
  }
  // Resolved here, server-side: the preview cards' alt text needs the species
  // dictionary, which only the settings page may ship — the nav's shared chunk
  // must stay map-free (issue #140).
  const previewSpecies = localizeSpecies(SPRITE_PREVIEW_SPECIES, await getDataLocale());
  return <SpriteStyleSettingsForm stored={stored} readFailed={readFailed} previewSpecies={previewSpecies} />;
}
