import type { SeasonFormatType } from '@/types/season';

/**
 * Central capability configuration per league format.
 *
 * UI sections, admin tools, and match presentation derive their visibility
 * from these flags instead of checking format names directly. This keeps
 * feature gating declarative and prevents unrelated sections from leaking
 * into formats that don't support them.
 *
 * Consumers per flag are noted inline: flags marked "engine" describe
 * rules-engine behavior (finalize hooks, standings) documented here for
 * completeness; they are not read by UI gating code.
 */
export interface FormatCapabilities {
  /** Gym-leader type per participant — gates the type dropdown in LeagueParticipantManager */
  participantTypeAssignment: boolean;
  /** Core Liga 3-type cores — gates CoreLigaManager (admin) + CoreLigaParticipants (public) */
  typeCores: boolean;
  /** Old Evolution League / Draft tier pool — gates EvolutionTierEditor (admin) */
  evolutionTiers: boolean;
  /** Wildcard assignments — engine/UI lives inside EvolutionTierEditor (gated by evolutionTiers) */
  wildcards: boolean;
  /** S/A/B/C tier pick limits — gates DraftTierLimitsEditor (admin) */
  tierLimits: boolean;
  /** Manually managed draft pool (draft_pool_entries) — gates DraftPoolEditor (admin) */
  genericDraftPool: boolean;
  /** Versioned point-buy list defines the pool — gates PointBuyListManager + FormatRulesEditor (admin), point-buy nav link (public) */
  pointBuyList: boolean;
  /** Draft Kill Tokens bought from unspent draft points — gates the admin TokenAdminSummary (admin
   *  league page + admin draft panel); players buy them in TokenCenter (/leagues/[id]/tokens) */
  draftTokens: boolean;
  /** Comeback Tokens earned from shutout losses — gates the admin TokenAdminSummary; players spend
   *  them in TokenCenter (/leagues/[id]/tokens); awarding is engine */
  killTokens: boolean;
  /** Participation tokens of the format pack's participation line — engine (awardCosmoPoint in match finalize) */
  cosmoPoints: boolean;
  /** Per-line evolution progress tracking — gates Teams & Progress nav link (public) */
  evolutionProgress: boolean;
  /** Evolution points standings tiebreaker — engine (computeStandingsForFormat) */
  evolutionPoints: boolean;
  /** Between-legs redraft phase — gates the admin league page's redraft section (link to the admin
   *  draft panel's RedraftPhaseManager). Consented trades are retired. */
  evolutionRedraft: boolean;
  /** Early stage-3 suspension rule — engine (checkEarlyStage3Lock in match finalize) */
  earlyFinalStageLock: boolean;
  /** Matchup analysis with stage-dependent roles — gates Matchup Analysis nav link (public) */
  matchupRoles: boolean;
}

// ── Per-format capability definitions ──────────────────────────────

const BASELINE: FormatCapabilities = Object.freeze({
  // Gym-type assignment is a participant-level feature available in every
  // classic format; only EPB (which has no gym leaders) hides it
  participantTypeAssignment: true,
  // Core Liga runs on classic formats (no dedicated format type) — the
  // admin section stays available everywhere except EPB; the public
  // CoreLigaParticipants additionally self-hides when no cores exist
  typeCores: true,
  evolutionTiers: false,
  wildcards: false,
  tierLimits: false,
  genericDraftPool: false,
  pointBuyList: false,
  draftTokens: false,
  killTokens: false,
  cosmoPoints: false,
  evolutionProgress: false,
  evolutionPoints: false,
  evolutionRedraft: false,
  earlyFinalStageLock: false,
  matchupRoles: false,
});

const DRAFT_CAPABILITIES: FormatCapabilities = Object.freeze({
  ...BASELINE,
  evolutionTiers: true,
  wildcards: true,
  tierLimits: true,
  genericDraftPool: true,
});

const EVOLUTION_POINT_BUY_CAPABILITIES: FormatCapabilities = Object.freeze({
  ...BASELINE,
  participantTypeAssignment: false,
  typeCores: false,
  pointBuyList: true,
  draftTokens: true,
  killTokens: true,
  cosmoPoints: true,
  evolutionProgress: true,
  evolutionPoints: true,
  evolutionRedraft: true,
  earlyFinalStageLock: true,
  matchupRoles: true,
});

const CAPABILITY_MAP: Record<SeasonFormatType, FormatCapabilities> = Object.freeze({
  singles: BASELINE,
  doubles: BASELINE,
  draft: DRAFT_CAPABILITIES,
  evolution_point_buy: EVOLUTION_POINT_BUY_CAPABILITIES,
});

/**
 * Get the capability configuration for a given league format.
 * Returns a frozen object — callers must not mutate.
 */
export function getFormatCapabilities(format: SeasonFormatType): FormatCapabilities {
  return CAPABILITY_MAP[format] ?? BASELINE;
}
