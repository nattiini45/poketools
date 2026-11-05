/**
 * The stage calendar at the points where the league writes rounds. Server only.
 */
import 'server-only';

import { logger } from '@/lib/logger';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { updateRoundDeadline } from '@/lib/supabase/queries/rounds';
import type { Stage } from '@/lib/format-kit/types';
import type { Round } from '@/types/round';
import { roundDeadlineIso } from './calendar';

const TAG = 'format-engine/calendar';

/**
 * A new round of a stage with a calendar gets the calendar's deadline when it has none. Best effort: a failure is
 * logged with its original error and the round comes back as it was, so the generation that wrote it stands.
 */
export async function fillRoundDeadline(input: {
  seasonId: string;
  stage: Pick<Stage, 'key' | 'calendar'>;
  round: Round;
}): Promise<Round> {
  const { stage, round } = input;
  if (stage.calendar === undefined || round.deadline !== null) return round;
  try {
    const season = await getSeasonById(input.seasonId);
    const deadline = roundDeadlineIso(stage.calendar, round.round_number, { seasonStart: season?.start_date ?? null });
    if (deadline === null) {
      logger.warn(TAG, 'the stage calendar has no readable start: the round keeps no deadline', {
        seasonId: input.seasonId,
        stage: stage.key,
        round: round.round_number,
      });
      return round;
    }
    return await updateRoundDeadline(round.id, deadline);
  } catch (error) {
    logger.error(TAG, 'could not set the round deadline from the stage calendar', {
      seasonId: input.seasonId,
      stage: stage.key,
      roundId: round.id,
      error,
    });
    return round;
  }
}
