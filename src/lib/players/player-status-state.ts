import { defineMachine } from '@/lib/state-machine/machine';

/**
 * Moderation standing of a player (`players.status`), with its companions
 * `suspended_until` (set only while suspended), `ban_reason` (set only while
 * banned) and `sessions_valid_after` (the session epoch a suspension or a ban
 * moves to now, so every token issued before it is dead).
 *
 * Client-safe: the admin roster derives its row actions from it.
 */
export const playerStatusMachine = defineMachine({
  id: 'player.status',
  title: 'Player moderation status',
  storage: 'players.status (CHECK active | suspended | banned), suspended_until, ban_reason, sessions_valid_after',
  summary:
    'A player is active, suspended until a time, or banned. Only an active player is suspended or banned, and a sanction ends only by reinstating the player (an admin, or the cron once suspended_until has passed). The live require* guards (src/lib/auth/helpers.ts) refuse every status but active; site admins pass the standing check whatever their status (isInGoodStanding), so a sanctioned admin keeps admin access until is_admin is removed. The superadmin row is changed by the superadmin only (superadminPlayerProtectedResponse).',
  doc: 'docs/admin.md',
  states: ['active', 'suspended', 'banned'],
  initial: ['active'],
  terminal: [],
  actors: ['admin', 'system'],
  transitions: [
    {
      event: 'suspend',
      from: ['active'],
      to: 'suspended',
      actors: ['admin'],
      writers: ['src/app/api/admin/players/[id]/suspend/route.ts', 'src/lib/supabase/queries/players.ts'],
      note: 'Stores suspended_until (a future time), clears ban_reason and ends the sessions the player holds.',
    },
    {
      event: 'ban',
      from: ['active'],
      to: 'banned',
      actors: ['admin'],
      writers: ['src/app/api/admin/players/[id]/suspend/route.ts', 'src/lib/supabase/queries/players.ts'],
      note: 'Stores ban_reason, clears suspended_until and ends the sessions the player holds.',
    },
    {
      event: 'reinstate',
      from: ['suspended', 'banned'],
      to: 'active',
      actors: ['admin'],
      writers: ['src/app/api/admin/players/[id]/unsuspend/route.ts', 'src/lib/supabase/queries/players.ts'],
      note: 'Clears suspended_until and ban_reason; the session epoch stays, so tokens from before the sanction stay dead.',
    },
    {
      event: 'expire',
      from: ['suspended'],
      to: 'active',
      actors: ['system'],
      writers: ['src/app/api/cron/expire-suspensions/route.ts', 'src/lib/supabase/queries/players.ts'],
      note: 'The cron (every 15 min) lifts suspensions whose suspended_until has passed; a banned player has no suspended_until and is never lifted.',
    },
  ],
});
