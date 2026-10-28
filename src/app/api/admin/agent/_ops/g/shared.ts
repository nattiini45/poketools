/**
 * Small helpers the Build bindings share: reading an id out of a route answer, comparing names the way the routes do, the
 * clock margin of a natural-key reconcile, and the reads the read-backs use (existing query modules only; every function
 * here reads and nothing writes).
 */
import type { Outcome } from '@/lib/ai/admin-agent/dispatch';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { listSeasons, listSeasonsByIds, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId, getTournamentById, listAllTournaments } from '@/lib/supabase/queries/tournaments';
import { isValidUuid } from '@/lib/utils/uuid';

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A uuid in lower case, or `null`. */
export const uuidOrNull = (value: unknown): string | null => (typeof value === 'string' && isValidUuid(value) ? value.toLowerCase() : null);

/** The id a route answered with (`data.id`), or `null` when it answered nothing usable (an unknown outcome). */
export const idOfOutcome = (outcome: Outcome): string | null => (outcome.kind === 'ok' && isRecord(outcome.data) ? uuidOrNull(outcome.data.id) : null);

/** The id of the ledger result a reversal is built from (`{ id, ... }`). */
export const idOfResult = (result: unknown): string | null => (isRecord(result) ? uuidOrNull(result.id) : null);

/** Names compare the way the routes compare them: Unicode-normalised, trimmed, case-insensitive. */
export const nameKey = (name: string): string => name.normalize('NFC').trim().toLowerCase();

/**
 * The database stamps `created_at`, the approval is stamped by the app: a natural-key lookup accepts a row this much older
 * than the approval, so a clock that runs a little apart cannot hide the row the step just wrote.
 */
export const CLOCK_SKEW_MS = 60_000;

/** Whether a row created at `createdAt` can be the one the step created after `approvedAt`. */
export function createdSince(createdAt: string, approvedAt: string): boolean {
  const created = Date.parse(createdAt);
  const approved = Date.parse(approvedAt);
  return Number.isFinite(created) && Number.isFinite(approved) && created >= approved - CLOCK_SKEW_MS;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** A league by id, archived or not (`null`: no such row). Not the `cache()`d getter: a read-back must see the write. */
export async function readLeague(id: string) {
  const [league] = await listSeasonsByIds([id]);
  return league ?? null;
}

/** The newest 100 live leagues, test leagues included: where a league the step may have created shows up. */
export const readLiveLeagues = () => listSeasons({ includeTestSeasons: true });

/** The lower-cased player ids on a league's roster. */
export async function readRosterIds(seasonId: string): Promise<Set<string>> {
  return new Set((await getSeasonParticipants(seasonId)).map((participant) => participant.id.toLowerCase()));
}

/** A league's phases, with their enrollment source and participant count. */
export const readPhases = (seasonId: string) => getStagesBySeasonId(seasonId);

export const readTournament = (id: string) => getTournamentById(id);

/** The newest 200 tournaments, phases included (filter on `season_id === null` for the standalone ones). */
export const readNewestTournaments = () => listAllTournaments();

/** Whether the admin can administer the tournament: a site admin always can, anyone else through a `resource_admins` row. */
export async function canAdministerTournament(adminId: string, isSiteAdmin: boolean | undefined, tournamentId: string): Promise<boolean> {
  if (isSiteAdmin === true) return true;
  return isResourceAdminFor(adminId, 'tournament', tournamentId);
}
