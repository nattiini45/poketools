import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { expirePublicTags, publicTags } from '@/lib/revalidation';
import type { Team } from '@/types/team';

/**
 * Expire the public cached reads built from a team row's roster, right after
 * a write to that row committed (AGENTS.md: a write that expires no tag is not
 * bounded by the TTL). Two reads count team rosters:
 *
 * - item usage on the species pages (H9, `publicReads.itemUsage`, tagged with
 *   the aggregate scopes): only rows linked to a match count, so their
 *   all-time, tournament and league aggregate tags expire;
 * - the league world's aces (`publicReads.worldRouteData`, the season tag):
 *   rows an anonymous visitor may see feed them (linked to a match, whose
 *   status decides at read time, or in an `always_public` tournament), so the
 *   league's season tag expires. An admin correction of a completed match's
 *   roster therefore shows on the next view.
 *
 * Personal rows (no match, tournament or season) feed neither: nothing to do.
 * A planned row in a tournament that is not `always_public` feeds neither.
 *
 * Never fails the request: a failure is logged with its cause and the affected
 * entries expire by their TTL. `source` names the caller in the log line.
 */
export async function expireItemUsageReads(team: Team, source: string): Promise<void> {
  const linked = Boolean(team.match_id);
  if (!linked && !team.tournament_id && !team.season_id) return;

  const tags: string[] = linked ? [publicTags.aggregates('all_time', null)] : [];
  // The league whose world aces this row feeds (a season-level row only through a match link).
  let worldSeasonId: string | null = linked ? team.season_id || null : null;
  if (team.tournament_id) {
    if (linked) tags.push(publicTags.aggregates('tournament', team.tournament_id));
    try {
      const tournament = await getTournamentById(team.tournament_id);
      if (tournament?.season_id) {
        if (linked) tags.push(publicTags.aggregates('league', tournament.season_id));
        // A planned row reaches the world aces only in an always_public stage.
        if (linked || tournament.team_visibility === 'always_public') worldSeasonId ??= tournament.season_id;
      }
    } catch (err) {
      console.error(
        `[${source}] team roster cache: tournament lookup failed after a committed write; the league-scope entries expire by their TTL`,
        { teamId: team.id, tournamentId: team.tournament_id, err }
      );
    }
  }
  if (worldSeasonId) tags.push(publicTags.season(worldSeasonId));
  if (tags.length === 0) return;

  try {
    expirePublicTags(tags);
  } catch (err) {
    console.error(
      `[${source}] team roster cache: tag expiry failed after a committed write; the entries expire by their TTL`,
      { teamId: team.id, tags, err }
    );
  }
}
