import type { BracketSide } from '@/types/match';
import type { MatchWithPlayers } from '@/types/match';
import type { Tournament } from '@/types/tournament';
import type { ParticipantWithSeed } from '@/types/tournament';
import {
  buildBracketStructureForParticipants,
  buildSlotIndexMap,
  feederLabel,
  seedToParticipantId,
  sortParticipantsBySeed,
  type BracketSlotDef,
  type FeederDef,
} from './bracket-structure';
import {
  createMatchBatch,
  deleteMatchesByIds,
  getMatchesByTournament,
  updateMatchPlayers,
} from '@/lib/supabase/queries/matches';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getGamesByMatch } from '@/lib/supabase/queries/games';

export type SlotResolutionVia = 'match' | 'bye';

export interface SlotResolution {
  winnerId: string | null;
  loserId: string | null;
  via: SlotResolutionVia;
}

type FeederSettlement =
  | { state: 'pending' }
  | { state: 'settled'; playerId: string | null };

function participantIdsInSeedOrder(participants: ParticipantWithSeed[]): string[] {
  return sortParticipantsBySeed(participants).map((p) => p.id);
}

function settleFeeder(
  feeder: FeederDef,
  seedOrderedIds: string[],
  slotResolutions: Map<string, SlotResolution>
): FeederSettlement {
  switch (feeder.kind) {
    case 'seed':
      return {
        state: 'settled',
        playerId: feeder.seed ? seedToParticipantId(seedOrderedIds, feeder.seed) : null,
      };
    case 'bye':
      return { state: 'settled', playerId: null };
    case 'winner': {
      if (!feeder.slotKey) return { state: 'settled', playerId: null };
      const source = slotResolutions.get(feeder.slotKey);
      if (!source) return { state: 'pending' };
      return { state: 'settled', playerId: source.winnerId };
    }
    case 'loser': {
      if (!feeder.slotKey) return { state: 'settled', playerId: null };
      const source = slotResolutions.get(feeder.slotKey);
      if (!source) return { state: 'pending' };
      return { state: 'settled', playerId: source.loserId };
    }
    default: {
      const _exhaustive: never = feeder.kind;
      return _exhaustive;
    }
  }
}

export function findSlotForMatch(
  slots: BracketSlotDef[],
  roundNumber: number,
  bracketSide: BracketSide | null,
  bracketPos: number | null
): BracketSlotDef | undefined {
  return slots.find(
    (s) =>
      s.global_round_number === roundNumber &&
      s.bracket_side === bracketSide &&
      s.bracket_pos === bracketPos
  );
}

export function findMatchForSlot(
  matches: MatchWithPlayers[],
  roundIdByGlobalNumber: Map<number, string>,
  slot: BracketSlotDef
): MatchWithPlayers | undefined {
  const roundId = roundIdByGlobalNumber.get(slot.global_round_number);
  if (!roundId) return undefined;
  return matches.find(
    (m) =>
      m.round_id === roundId &&
      m.bracket_side === slot.bracket_side &&
      m.bracket_pos === slot.bracket_pos
  );
}

/** Build resolutions from all completed matches in the bracket. */
export function buildSlotResolutionsFromMatches(
  slots: BracketSlotDef[],
  matches: MatchWithPlayers[],
  roundNumberById: Map<string, number>
): Map<string, SlotResolution> {
  const resolutions = new Map<string, SlotResolution>();

  for (const match of matches) {
    if (match.status !== 'completed' || !match.winner_id) continue;
    const roundNumber = roundNumberById.get(match.round_id);
    if (roundNumber === undefined) continue;
    const slot = findSlotForMatch(
      slots,
      roundNumber,
      match.bracket_side,
      match.bracket_pos
    );
    if (!slot) continue;
    const loserId =
      match.winner_id === match.player_1_id
        ? match.player_2_id
        : match.player_1_id;
    resolutions.set(slot.slotKey, {
      winnerId: match.winner_id,
      loserId,
      via: 'match',
    });
  }

  return resolutions;
}

/**
 * Resolve bye chains without creating playable matches.
 * A winner/loser feeder whose source slot has no resolution stays pending.
 * Both-settled-null becomes an empty bye-through so LB slots fed by two bye
 * losers keep propagating. Iterates to fixpoint for chained byes.
 */
function resolveByeChains(
  slots: BracketSlotDef[],
  seedOrderedIds: string[],
  slotResolutions: Map<string, SlotResolution>
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const slot of slots) {
      if (slot.isBracketReset) continue;
      if (slotResolutions.has(slot.slotKey)) continue;
      const s1 = settleFeeder(slot.feeder1, seedOrderedIds, slotResolutions);
      const s2 = settleFeeder(slot.feeder2, seedOrderedIds, slotResolutions);
      if (s1.state === 'pending' || s2.state === 'pending') continue;

      const p1 = s1.playerId;
      const p2 = s2.playerId;
      if (p1 && p2) continue;

      if (p1 && !p2) {
        slotResolutions.set(slot.slotKey, { winnerId: p1, loserId: null, via: 'bye' });
        changed = true;
      } else if (!p1 && p2) {
        slotResolutions.set(slot.slotKey, { winnerId: p2, loserId: null, via: 'bye' });
        changed = true;
      } else {
        slotResolutions.set(slot.slotKey, { winnerId: null, loserId: null, via: 'bye' });
        changed = true;
      }
    }
  }
}

/**
 * Materialize bracket slots whose feeders are fully resolved.
 * Skips bye-only advances; creates matches when both players are known.
 * Never rewrites a non-scheduled match or a match that already has games.
 */
export async function materializeReadySlots(
  tournamentId: string,
  _tournament: Tournament,
  participants: ParticipantWithSeed[],
  structure: ReturnType<typeof buildBracketStructureForParticipants>,
  roundIdByGlobalNumber: Map<number, string>,
  existingMatches: MatchWithPlayers[],
  slotResolutions: Map<string, SlotResolution>
): Promise<MatchWithPlayers[]> {
  if (!structure) return [];

  const seedOrderedIds = participantIdsInSeedOrder(participants);
  resolveByeChains(structure.slots, seedOrderedIds, slotResolutions);

  const created: MatchWithPlayers[] = [];
  const matches = [...existingMatches];

  for (const slot of structure.slots) {
    // Bracket reset only materializes when the Losers Bracket champion wins
    // the Grand Finals (i.e. the GF winner is not the WB final winner).
    if (slot.isBracketReset) {
      const gfSlotKey = slot.feeder1.slotKey;
      const gfSlot = gfSlotKey
        ? structure.slots.find((s) => s.slotKey === gfSlotKey)
        : undefined;
      if (!gfSlot) continue;
      const wbFinalKey = gfSlot.feeder1.slotKey;
      const gfRes = slotResolutions.get(gfSlot.slotKey);
      const wbRes = wbFinalKey ? slotResolutions.get(wbFinalKey) : undefined;
      if (!gfRes?.winnerId || !wbRes?.winnerId) continue;
      if (gfRes.winnerId === wbRes.winnerId) continue;
    }

    const existing = findMatchForSlot(matches, roundIdByGlobalNumber, slot);
    const s1 = settleFeeder(slot.feeder1, seedOrderedIds, slotResolutions);
    const s2 = settleFeeder(slot.feeder2, seedOrderedIds, slotResolutions);
    if (s1.state === 'pending' || s2.state === 'pending') continue;

    const p1 = s1.playerId;
    const p2 = s2.playerId;
    if (!p1 || !p2) continue;

    const roundId = roundIdByGlobalNumber.get(slot.global_round_number);
    if (!roundId) continue;

    if (existing) {
      if (existing.player_1_id !== p1 || existing.player_2_id !== p2) {
        if (existing.status !== 'scheduled' || existing.games.length !== 0) {
          console.error({
            message: 'Bracket materialize conflict: refusing to rewrite played/non-scheduled match',
            tournamentId,
            slotKey: slot.slotKey,
            matchId: existing.id,
            status: existing.status,
          });
          continue;
        }
        const updated = await updateMatchPlayers(existing.id, p1, p2);
        const idx = matches.findIndex((m) => m.id === existing.id);
        if (idx >= 0) {
          matches[idx] = { ...matches[idx], ...updated };
        }
      }
      continue;
    }

    const batch = await createMatchBatch([
      {
        round_id: roundId,
        tournament_id: tournamentId,
        player_1_id: p1,
        player_2_id: p2,
        bracket_side: slot.bracket_side,
        bracket_pos: slot.bracket_pos,
      },
    ]);
    // createMatchBatch returns Match[] without player names — refetch not needed for propagation
    const placeholder: MatchWithPlayers = {
      ...batch[0],
      player_1_name: '',
      player_2_name: '',
      player_1_avatar_url: null,
      player_2_avatar_url: null,
      winner_name: null,
      round_status: 'pending',
      games: [],
    };
    matches.push(placeholder);
    created.push(placeholder);
  }

  return created;
}

function overlayCompletingMatch(
  fetched: MatchWithPlayers[],
  match: MatchWithPlayers,
  winnerId: string
): MatchWithPlayers[] {
  const completed: MatchWithPlayers = {
    ...match,
    winner_id: winnerId,
    status: 'completed',
  };
  if (fetched.some((m) => m.id === match.id)) {
    return fetched.map((m) => (m.id === match.id ? { ...m, ...completed, games: m.games } : m));
  }
  return [...fetched, completed];
}

/**
 * After a match completes, propagate winners/losers into downstream slots.
 * Prefers the winner on the match object it receives so a stale DB row
 * (force-complete from in_progress) cannot no-op the advance.
 */
export async function propagateBracketOnMatchComplete(
  match: MatchWithPlayers,
  tournament: Tournament,
  participants: ParticipantWithSeed[]
): Promise<void> {
  if (tournament.bracket_type !== 'single_elim' && tournament.bracket_type !== 'double_elim') {
    return;
  }

  const structure = buildBracketStructureForParticipants(
    tournament.bracket_type,
    participants,
    { bracketResetEnabled: tournament.bracket_reset_enabled ?? true }
  );
  const winnerId = match.winner_id;
  if (!structure || !winnerId) return;

  const rounds = await getRoundsByTournament(tournament.id);
  const roundNumberById = new Map(rounds.map((r) => [r.id, r.round_number]));
  const roundIdByGlobalNumber = new Map(rounds.map((r) => [r.round_number, r.id]));

  const fetched = await getMatchesByTournament(tournament.id);
  const matches = overlayCompletingMatch(fetched, match, winnerId);
  const slotResolutions = buildSlotResolutionsFromMatches(
    structure.slots,
    matches,
    roundNumberById
  );

  await materializeReadySlots(
    tournament.id,
    tournament,
    participants,
    structure,
    roundIdByGlobalNumber,
    matches,
    slotResolutions
  );
}

export interface RepairBracketResult {
  slots_materialized: number;
}

export interface BracketResetSyncResult {
  /** Scheduled (unplayed) reset matches removed after disabling. */
  reset_matches_removed: number;
  /** Matches materialized after enabling (via the repair path). */
  slots_materialized: number;
}

/**
 * Apply a `bracket_reset_enabled` toggle to an existing DE bracket.
 * Disabling deletes scheduled (zero-game) Grand Finals reset matches;
 * enabling runs the repair path so a reset that is already decidable
 * (LB champion won a played Grand Finals) materializes immediately.
 * Safe to call for any bracket type — non-DE returns a no-op result.
 */
export async function syncBracketResetSetting(
  tournament: Tournament,
  participants: ParticipantWithSeed[]
): Promise<BracketResetSyncResult> {
  if (tournament.bracket_type !== 'double_elim') {
    return { reset_matches_removed: 0, slots_materialized: 0 };
  }

  if (tournament.bracket_reset_enabled ?? true) {
    const repaired = await repairBracket(tournament, participants);
    return { reset_matches_removed: 0, slots_materialized: repaired.slots_materialized };
  }

  const rounds = await getRoundsByTournament(tournament.id);
  const roundIdByGlobalNumber = new Map(rounds.map((r) => [r.round_number, r.id]));
  const matches = await getMatchesByTournament(tournament.id);

  // Build with the reset present to locate any materialized reset slot,
  // then delete scheduled zero-game reset matches.
  const structureWithReset = buildBracketStructureForParticipants(
    tournament.bracket_type,
    participants,
    { bracketResetEnabled: true }
  );
  if (!structureWithReset) return { reset_matches_removed: 0, slots_materialized: 0 };

  const resetSlots = structureWithReset.slots.filter((s) => s.isBracketReset);
  const toDelete: string[] = [];
  for (const slot of resetSlots) {
    const match = findMatchForSlot(matches, roundIdByGlobalNumber, slot);
    if (!match) continue;
    if (match.status !== 'scheduled') continue;
    const games = await getGamesByMatch(match.id);
    if (games.length === 0) {
      toDelete.push(match.id);
    }
  }

  if (toDelete.length > 0) {
    await deleteMatchesByIds(toDelete);
  }

  return {
    reset_matches_removed: toDelete.length,
    slots_materialized: 0,
  };
}

/**
 * Reload participants + matches and re-run bye resolution + materialization
 * to heal a bracket after a failed propagation.
 */
export async function repairBracket(
  tournament: Tournament,
  participants: ParticipantWithSeed[]
): Promise<RepairBracketResult> {
  if (tournament.bracket_type !== 'single_elim' && tournament.bracket_type !== 'double_elim') {
    return { slots_materialized: 0 };
  }

  const structure = buildBracketStructureForParticipants(
    tournament.bracket_type,
    participants,
    { bracketResetEnabled: tournament.bracket_reset_enabled ?? true }
  );
  if (!structure) return { slots_materialized: 0 };

  const rounds = await getRoundsByTournament(tournament.id);
  const roundNumberById = new Map(rounds.map((r) => [r.id, r.round_number]));
  const roundIdByGlobalNumber = new Map(rounds.map((r) => [r.round_number, r.id]));

  const matches = await getMatchesByTournament(tournament.id);
  const slotResolutions = buildSlotResolutionsFromMatches(
    structure.slots,
    matches,
    roundNumberById
  );

  const created = await materializeReadySlots(
    tournament.id,
    tournament,
    participants,
    structure,
    roundIdByGlobalNumber,
    matches,
    slotResolutions
  );

  return { slots_materialized: created.length };
}

/** Slots downstream of a reset match that should be un-materialized. */
export function findDownstreamSlotKeys(
  structure: ReturnType<typeof buildBracketStructureForParticipants>,
  originSlotKey: string
): Set<string> {
  const downstream = new Set<string>();
  if (!structure) return downstream;

  const queue = [originSlotKey];
  while (queue.length > 0) {
    const key = queue.pop()!;
    for (const slot of structure.slots) {
      const feeds =
        slot.feeder1.slotKey === key ||
        slot.feeder2.slotKey === key;
      if (feeds && !downstream.has(slot.slotKey)) {
        downstream.add(slot.slotKey);
        queue.push(slot.slotKey);
      }
    }
  }
  return downstream;
}

/**
 * Delete downstream materialized matches with zero games after a reset.
 */
export async function unpropagateBracketOnMatchReset(
  match: MatchWithPlayers,
  tournament: Tournament,
  participants: ParticipantWithSeed[]
): Promise<string[]> {
  if (tournament.bracket_type !== 'single_elim' && tournament.bracket_type !== 'double_elim') {
    return [];
  }

  const structure = buildBracketStructureForParticipants(
    tournament.bracket_type,
    participants,
    { bracketResetEnabled: tournament.bracket_reset_enabled ?? true }
  );
  if (!structure) return [];

  const rounds = await getRoundsByTournament(tournament.id);
  const roundNumberById = new Map(rounds.map((r) => [r.id, r.round_number]));
  const roundIdByGlobalNumber = new Map(rounds.map((r) => [r.round_number, r.id]));

  const roundNumber = roundNumberById.get(match.round_id);
  if (roundNumber === undefined) return [];

  const originSlot = findSlotForMatch(
    structure.slots,
    roundNumber,
    match.bracket_side,
    match.bracket_pos
  );
  if (!originSlot) return [];

  const downstreamKeys = findDownstreamSlotKeys(structure, originSlot.slotKey);
  if (downstreamKeys.size === 0) return [];

  const matches = await getMatchesByTournament(tournament.id);
  const toDelete: string[] = [];

  for (const slotKey of downstreamKeys) {
    const slot = structure.slots.find((s) => s.slotKey === slotKey);
    if (!slot) continue;
    const m = findMatchForSlot(matches, roundIdByGlobalNumber, slot);
    if (!m) continue;
    const games = await getGamesByMatch(m.id);
    if (games.length === 0 && m.status === 'scheduled') {
      toDelete.push(m.id);
    }
  }

  if (toDelete.length > 0) {
    await deleteMatchesByIds(toDelete);
  }

  return toDelete;
}

export function getBracketSlotLabels(
  structure: ReturnType<typeof buildBracketStructureForParticipants>
): Map<string, { label1: string; label2: string }> {
  const labels = new Map<string, { label1: string; label2: string }>();
  if (!structure) return labels;
  const indexMap = buildSlotIndexMap(structure.slots);
  for (const slot of structure.slots) {
    const onLosersSide = slot.bracket_side === 'losers';
    const label2 = feederLabel(slot.feeder2, indexMap, { onLosersSide });
    labels.set(slot.slotKey, {
      label1: feederLabel(slot.feeder1, indexMap, { onLosersSide }),
      label2: slot.isBracketReset ? `${label2} (if necessary)` : label2,
    });
  }
  return labels;
}
