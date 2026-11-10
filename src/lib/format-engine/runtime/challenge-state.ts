import { defineMachine } from '@/lib/state-machine/machine';

const CHALLENGES_SQL = 'supabase/migrations/20261106090000_format_challenges.sql';
const NOTIFICATIONS_SQL = 'supabase/migrations/20261108090000_format_notifications.sql';

/**
 * `format_challenges.status`: one challenge of a `pairing.challenge` ladder stage (docs/format-kit.md). Every write
 * happens inside the SQL functions named as writers; `src/lib/format-engine/runtime/__tests__/state-machines-sql.test.ts`
 * holds their guards equal to this definition. The view's `lapsed` (open, past `expires_at`, not yet marked) is
 * derived and reads as `expired`. Client-safe.
 */
export const formatChallengeMachine = defineMachine({
  id: 'format_challenge',
  title: 'Format challenge',
  storage: 'format_challenges.status',
  summary:
    "A ladder challenge from challenger to defender. Only an open challenge moves, except that deleting a round cancels the accepted challenges whose match it deletes. 'cancelled' covers a withdrawal, a player who left the phase and a deleted match; the cooldown counts every status but cancelled. The notify trigger writes a notification for every status change.",
  doc: 'docs/format-kit.md',
  states: ['open', 'accepted', 'declined', 'expired', 'cancelled'],
  initial: ['open'],
  terminal: ['declined', 'expired', 'cancelled'],
  actors: ['challenger', 'defender', 'admin', 'system'],
  transitions: [
    {
      event: 'accept',
      from: ['open'],
      to: 'accepted',
      actors: ['defender'],
      writers: ['src/lib/supabase/queries/format-challenges.ts', `${CHALLENGES_SQL}#format_challenge_respond`],
      note: 'The defender accepts while the engine is kit and the phase is not completed: a scheduled match is created in the open round.',
    },
    {
      event: 'decline',
      from: ['open'],
      to: 'declined',
      actors: ['defender'],
      writers: ['src/lib/supabase/queries/format-challenges.ts', `${CHALLENGES_SQL}#format_challenge_respond`],
    },
    {
      event: 'withdraw',
      from: ['open'],
      to: 'cancelled',
      actors: ['challenger', 'admin'],
      writers: ['src/lib/supabase/queries/format-challenges.ts', `${NOTIFICATIONS_SQL}#format_challenge_cancel`],
      note: 'The challenger withdraws, or an admin for them.',
    },
    {
      event: 'void',
      from: ['open'],
      to: 'cancelled',
      actors: ['defender', 'system'],
      writers: [`${CHALLENGES_SQL}#format_challenge_respond`, `${CHALLENGES_SQL}#format_challenge_create`],
      note: 'A player left the phase: found by an accept (stored, then challenge_player_not_enrolled) or swept by the next create in the phase.',
    },
    {
      event: 'expire',
      from: ['open'],
      to: 'expired',
      actors: ['challenger', 'defender', 'admin', 'system'],
      writers: [
        'src/lib/format-engine/challenge-server.ts',
        `${CHALLENGES_SQL}#format_challenges_expire`,
        `${CHALLENGES_SQL}#format_challenge_create`,
        `${CHALLENGES_SQL}#format_challenge_respond`,
        `${NOTIFICATIONS_SQL}#format_challenge_cancel`,
      ],
      note: 'The accept window ran out: the cron sweep, a create in the phase, or a late answer or withdrawal (stored, then challenge_expired).',
    },
    {
      event: 'cancel_match',
      from: ['accepted'],
      to: 'cancelled',
      actors: ['system'],
      writers: [`${CHALLENGES_SQL}#round_delete`],
      note: "Deleting a round with only scheduled matches cancels the challenges whose match it deletes. The UPDATE keys on match_id with no status guard; only an accept sets match_id, so it reaches accepted rows only.",
    },
  ],
});

export type FormatChallengeState = (typeof formatChallengeMachine.spec.states)[number];
