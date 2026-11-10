import { defineMachine } from '@/lib/state-machine/machine';

const SERVICE = 'src/lib/league-trash/service.ts';
const QUERIES = 'src/lib/supabase/queries/league-trash.ts';
const TRASH_MIGRATION = 'supabase/migrations/20261026091000_league_trash.sql';
const REBUILD_ROUTE = 'src/app/api/admin/league-trash/[id]/rebuild/route.ts';
const LIFECYCLE = 'src/lib/league-trash/lifecycle-state.ts';

/**
 * The league recycle bin (docs/season.md, "League recycle bin"). The state is not a column: it is derived from
 * whether the league exists, its `league_trash` row (`rebuild_pending`, `purge_after`) and the
 * `league_trash_restore_rebuilds` tombstone. Every move is a SQL function that takes the league's advisory lock or
 * the trash row lock; `src/lib/league-trash/__tests__/lifecycle-state.test.ts` pins their guards to this definition.
 * The admin trash page derives which actions an entry offers from `leagueTrashLifecycleState`.
 */
export const leagueTrashMachine = defineMachine({
  id: 'league_trash',
  title: 'League recycle bin',
  storage: 'derived: seasons row + league_trash (rebuild_pending, purge_after) + league_trash_restore_rebuilds',
  summary:
    'A deleted league waits in the bin for LEAGUE_TRASH_RETENTION_DAYS. It can be restored only while its delete rebuild is confirmed and its purge date has not passed; the expiry cron purges it only once the rebuild is confirmed. `expired_rebuild_pending` is the limbo between the two: past its purge date with the delete rebuild still pending, neither restorable (LEAGUE_TRASH_EXPIRED) nor purgeable until a superadmin runs the rebuild.',
  doc: 'docs/season.md',
  states: ['live', 'rebuild_pending', 'in_bin', 'expired_rebuild_pending', 'purgeable', 'purged', 'restored_rebuild_pending'],
  initial: ['live'],
  terminal: ['purged'],
  actors: ['admin', 'superadmin', 'system', 'clock'],
  transitions: [
    {
      event: 'delete',
      from: ['live', 'restored_rebuild_pending'],
      to: 'rebuild_pending',
      actors: ['admin'],
      writers: [`${TRASH_MIGRATION}#league_trash_delete`, QUERIES, SERVICE, 'src/app/api/seasons/[id]/route.ts'],
      note: 'DELETE /api/seasons/[id] (site admins). Deleting a restored league again drops its restore tombstone.',
    },
    {
      event: 'rebuild_done',
      from: ['rebuild_pending'],
      to: 'in_bin',
      actors: ['system', 'superadmin'],
      writers: [`${TRASH_MIGRATION}#league_trash_rebuild_done`, QUERIES, SERVICE, REBUILD_ROUTE],
      note: "The delete's derived-data rebuild is confirmed: right after the delete, or later from the trash page's Run rebuild.",
    },
    {
      event: 'rebuild_done',
      from: ['expired_rebuild_pending'],
      to: 'purgeable',
      actors: ['superadmin'],
      writers: [`${TRASH_MIGRATION}#league_trash_rebuild_done`, QUERIES, SERVICE, REBUILD_ROUTE],
      note: 'The way out of the limbo: the rebuild works whatever the purge date.',
    },
    {
      event: 'purge_date_passes',
      from: ['rebuild_pending'],
      to: 'expired_rebuild_pending',
      actors: ['clock'],
      writers: [LIFECYCLE],
      note: 'purge_after <= now while the delete rebuild is pending.',
    },
    {
      event: 'purge_date_passes',
      from: ['in_bin'],
      to: 'purgeable',
      actors: ['clock'],
      writers: [LIFECYCLE],
      note: 'purge_after <= now: the entry can no longer be restored.',
    },
    {
      event: 'restore',
      from: ['in_bin'],
      to: 'restored_rebuild_pending',
      actors: ['superadmin'],
      writers: [
        'supabase/migrations/20261106090000_format_challenges.sql#league_trash_restore',
        QUERIES,
        SERVICE,
        'src/app/api/admin/league-trash/[id]/restore/route.ts',
      ],
      note: 'Refused past the purge date (LEAGUE_TRASH_EXPIRED) and while the delete rebuild is pending (LEAGUE_TRASH_REBUILD_PENDING). Writes the restore tombstone and queues the aggregate jobs of the counted games.',
    },
    {
      event: 'restore_rebuild_done',
      from: ['restored_rebuild_pending'],
      to: 'live',
      actors: ['system', 'superadmin'],
      writers: [`${TRASH_MIGRATION}#league_trash_restore_rebuild_done`, QUERIES, SERVICE, REBUILD_ROUTE],
      note: "The restore's derived-data rebuild is confirmed and the tombstone deleted.",
    },
    {
      event: 'purge',
      from: ['purgeable'],
      to: 'purged',
      actors: ['system'],
      writers: [`${TRASH_MIGRATION}#league_trash_expire`, QUERIES, 'src/app/api/cron/expire-league-trash/route.ts'],
      note: 'The daily expire-league-trash cron; irreversible.',
    },
  ],
});

export type LeagueTrashState = (typeof leagueTrashMachine.spec.states)[number];

/** The states of an entry that is in the bin (a `league_trash` row). */
export type LeagueTrashBinState = Extract<LeagueTrashState, 'rebuild_pending' | 'in_bin' | 'expired_rebuild_pending' | 'purgeable'>;

/**
 * The state of a `league_trash` row at `now`. Expired is `purge_after <= now`, the comparison of
 * `league_trash_restore` and `league_trash_expire`.
 */
export function leagueTrashLifecycleState(
  entry: { readonly rebuildPending: boolean; readonly purgeAfter: string },
  now: string,
): LeagueTrashBinState {
  const expired = Date.parse(entry.purgeAfter) <= Date.parse(now);
  if (expired) return entry.rebuildPending ? 'expired_rebuild_pending' : 'purgeable';
  return entry.rebuildPending ? 'rebuild_pending' : 'in_bin';
}
