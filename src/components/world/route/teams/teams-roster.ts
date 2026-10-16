import { typeColors } from '@/lib/design/tokens';
import { castKbOf, figureHeightM, figureScale, type FigureEntry, type FigureIndex } from '@/lib/route-world/model-manifest';
import { TEAMS_COLOSSAL_M, footprintFromBounds, teamsInStandingsOrder, type TeamsAce } from '@/lib/route-world/teams-formation';
import type { EvolutionTracker } from '@/types/evolution';
import { compareTrackersForDisplay } from '@/lib/draft-ui/progress-display';
import type { LedgerColumnCopy } from './ledger-painter';

/**
 * The teams station's roster in STANDINGS order (fidelity wave 2, seat 2G —
 * D16: "teams order that is not the data order" is anti-pattern §5.9), shared
 * by the four worlds' formations and ledgers. Everything derives from the
 * page-loaded route data and the manifest — no species, type or stat literal.
 */

export interface TeamsRosterEntry {
  playerId: string;
  playerName: string;
  /** Gym type as the data names it, or null. */
  gymType: string | null;
  /** The ace species (most evolved line, ties by KOs), or null with no tracker. */
  species: string | null;
  /** The manifest figure, inside the quality rung's GLB budget; null → card / nothing. */
  entry: FigureEntry | null;
  /** The resolved manifest figure regardless of the budget (heights come from it). */
  resolved: FigureEntry | null;
  heightM: number;
  footprintM: number;
  /** Width across the view (m): the figure's local x extent at its real scale. */
  widthM: number;
  band: string;
  bandInk: string;
}

/** A card stand-in's size (the framed sprite card every world mounts). */
export const CARD_SIZE = { heightM: 0.96, footprintM: 0.8 } as const;
/** Gym band for a trainer without a gym type — a neutral stone grey, not a type. */
const NEUTRAL_BAND = { bg: '#6b7280', text: '#ffffff' } as const;

/**
 * The participant's ace: the first of their lines in display order
 * (`compareTrackersForDisplay`, draft-frontend §8.3) — most evolved, then
 * self-earned KOs (`real_kills`), then total progress. The merged total is
 * never the KO tiebreak on its own.
 */
export function pickAceTracker(trackers: readonly EvolutionTracker[]): EvolutionTracker | null {
  if (trackers.length === 0) return null;
  return [...trackers].sort(compareTrackersForDisplay)[0];
}

export function bandOf(gymType: string | null): { bg: string; text: string } {
  return (gymType ? typeColors[gymType] : undefined) ?? NEUTRAL_BAND;
}

/**
 * Participants → roster entries, standings first. `heroFigures` is the rung's
 * GLB budget: the cheapest files get models, the rest keep their manifest
 * stature (for the formation) but mount the card.
 */
export function teamsRoster(
  participants: readonly { id: string; name: string; gym_type?: string | null }[],
  trackers: readonly EvolutionTracker[],
  standings: readonly { player_id: string }[],
  index: Pick<FigureIndex, 'resolve'>,
  heroFigures: number,
): TeamsRosterEntry[] {
  const ordered = teamsInStandingsOrder(participants, standings);
  const list = ordered.map((player) => {
    const ace = pickAceTracker(trackers.filter((t) => t.player_id === player.id));
    const species = ace ? (ace.current_form ?? ace.base_pokemon) : null;
    const resolved = ace ? index.resolve(ace.current_form, ace.base_pokemon) : null;
    const band = bandOf(player.gym_type ?? null);
    return {
      playerId: player.id,
      playerName: player.name,
      gymType: player.gym_type ?? null,
      species,
      entry: resolved,
      resolved,
      heightM: resolved ? figureHeightM(resolved) : CARD_SIZE.heightM,
      footprintM: resolved ? footprintFromBounds(resolved.bounds, figureScale(resolved)) : CARD_SIZE.footprintM,
      widthM: resolved ? (resolved.bounds.max[0] - resolved.bounds.min[0]) * figureScale(resolved) : CARD_SIZE.footprintM,
      band: band.bg,
      bandInk: band.text,
    };
  });
  const budget = new Set(
    [...list]
      .filter((e) => e.resolved)
      // D42: sorted by the cast currency (`castKb ?? kb`), never the wire size.
      .sort((a, b) => (a.resolved ? castKbOf(a.resolved) : 0) - (b.resolved ? castKbOf(b.resolved) : 0))
      .slice(0, Math.max(0, heroFigures))
      .map((e) => e.playerId),
  );
  return list.map((e) => (budget.has(e.playerId) ? e : { ...e, entry: null }));
}

/** The formation's view of the roster (a card stands where no GLB is budgeted). */
export function formationAces(roster: readonly TeamsRosterEntry[], lift?: (e: TeamsRosterEntry) => number): TeamsAce[] {
  return roster.map((e) => ({
    id: e.playerId,
    heightM: e.entry ? e.heightM : e.species ? CARD_SIZE.heightM : 0.1,
    footprintM: e.entry ? e.footprintM : CARD_SIZE.footprintM,
    widthM: e.entry ? e.widthM : CARD_SIZE.footprintM,
    liftM: lift?.(e) ?? 0,
  }));
}

/**
 * The ledger's column copy (real stature from the manifest, even when a card
 * stands in). `setBack` is the formation's colossal law on the same stature
 * `formationAces` hands it (a budgeted GLB taller than `TEAMS_COLOSSAL_M`
 * stands on the back line), so the ledger names the depth it sees.
 */
export function ledgerCopy(roster: readonly TeamsRosterEntry[]): LedgerColumnCopy[] {
  return roster.map((e, i) => ({
    id: e.playerId,
    rank: i + 1,
    name: e.playerName,
    species: e.species,
    heightM: e.resolved ? e.heightM : null,
    band: e.band,
    bandInk: e.bandInk,
    setBack: e.entry !== null && e.heightM > TEAMS_COLOSSAL_M,
  }));
}
