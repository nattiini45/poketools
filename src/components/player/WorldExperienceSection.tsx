import { getSessionPlayer } from '@/lib/auth/helpers';
import { getPlayerWorldExperience } from '@/lib/supabase/queries/players';
import { DEFAULT_WORLD_EXPERIENCE, type WorldExperience } from '@/types/player';
import WorldExperienceForm from './WorldExperienceForm';

/**
 * Settings section for the per-player 3D world experience preference
 * (`players.world_experience`).
 *
 * Server component: the settings page is authenticated, so the current value
 * is read here directly through the query module — no GET endpoint needed.
 * The interactive radio group lives in the client `WorldExperienceForm` and
 * saves via PATCH /api/account/world-experience.
 */
export default async function WorldExperienceSection() {
  const sessionPlayer = await getSessionPlayer();

  let initialValue: WorldExperience = DEFAULT_WORLD_EXPERIENCE;
  let readFailed = false;
  if (sessionPlayer) {
    try {
      initialValue = await getPlayerWorldExperience(sessionPlayer.playerId);
    } catch (err) {
      // Degrade to the default ('off') rather than failing the whole settings page; the
      // read failure is logged here AND surfaced in the form (readFailed
      // notice), so the fallback never silently masquerades as the stored
      // value — saving over an unread 'on'/'off' would overwrite it.
      readFailed = true;
      console.error('[settings] world_experience read failed:', err);
    }
  }

  return <WorldExperienceForm initialValue={initialValue} readFailed={readFailed} />;
}
