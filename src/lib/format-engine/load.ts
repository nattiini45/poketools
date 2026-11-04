/**
 * Loads what a kit league's standings need (`KitStandingsData`) in five reads: the attached format's engine and seed,
 * the phases it generated, then their matches, match outcomes and members in parallel. Server only: the season seed is read here and
 * turned into per-player coin flip draws, so it never reaches a client or a cached value.
 */
import 'server-only';

import {
  getKitPhases,
  getOutcomesByPhases,
  getPhaseMatchIds,
  getPhaseMembers,
  getSeasonKitHead,
  type KitPhaseRow,
} from '@/lib/supabase/queries/format-engine';
import type { Stage } from '@/lib/format-kit/types';
import type { KitStageRules, KitStandingsData } from './context';
import type { KitOutcome } from './standings';
import { coinFlipDraws } from './standings';

/** A phase whose frozen `stage_spec` no longer parses as a kit stage: the standings cannot rank it. */
export class KitStageSpecError extends Error {
  constructor(readonly phaseId: string, detail: string) {
    super(`tournaments ${phaseId}: stage_spec is not a kit stage (${detail})`);
    this.name = 'KitStageSpecError';
  }
}

/**
 * The kit stage frozen into a phase (`tournaments.stage_spec.stage`). The zod schema loads on first use: this module
 * sits on the import path of every standings read, and most leagues never parse a stage.
 */
export async function stageOf(phase: KitPhaseRow): Promise<Stage> {
  const { stageSchema } = await import('@/lib/format-kit/schema/primitives');
  const spec = phase.stage_spec;
  const raw = spec !== null && typeof spec === 'object' && !Array.isArray(spec) ? spec.stage : undefined;
  const parsed = stageSchema.safeParse(raw);
  if (!parsed.success) throw new KitStageSpecError(phase.id, parsed.error.issues[0]?.message ?? 'invalid');
  return parsed.data as Stage;
}

/** The scoring and rank chain of a phase's kit stage. */
export async function stageRulesOf(phase: KitPhaseRow): Promise<KitStageRules> {
  const { key, scoring, rank } = await stageOf(phase);
  return { key, scoring, rank };
}

/** One phase of a kit league: its full stage, the format's engine and seed, and the outcomes of its matches. */
export interface KitPhase {
  engine: 'kit' | 'shadow';
  /** Server-side only. */
  seed: string;
  stage: Stage;
  outcomes: Record<string, KitOutcome>;
}

/** The kit phase `phaseId` of a custom league, or null when the format does not run it (none, `legacy`, not a phase of it). */
export async function loadKitPhase(seasonId: string, phaseId: string): Promise<KitPhase | null> {
  const head = await getSeasonKitHead(seasonId);
  if (head === null || head.engine === 'legacy') return null;
  const phase = (await getKitPhases(seasonId)).find((row) => row.id === phaseId);
  if (!phase) return null;
  const [stage, outcomeRows] = await Promise.all([stageOf(phase), getOutcomesByPhases([phaseId])]);
  const outcomes: Record<string, KitOutcome> = {};
  for (const row of outcomeRows) outcomes[row.match_id] = { kind: row.kind, p1_faints: row.p1_faints, p2_faints: row.p2_faints };
  return { engine: head.engine, seed: head.seed, stage, outcomes };
}

export interface LoadKitOptions {
  /** Load a `legacy` league too, as `shadow` (the admin diff compares before the switch). */
  includeLegacy?: boolean;
}

/**
 * The standings data of a league, or undefined when its format does not rank (no format attached, or the engine
 * `legacy` without `includeLegacy`). Call it only for a `custom` league: no other league type has an attached format.
 */
export async function loadKitStandingsData(
  seasonId: string,
  options: LoadKitOptions = {},
): Promise<KitStandingsData | undefined> {
  const head = await getSeasonKitHead(seasonId);
  if (head === null || (head.engine === 'legacy' && options.includeLegacy !== true)) return undefined;
  const engine = head.engine === 'kit' ? 'kit' : 'shadow';
  const phases = await getKitPhases(seasonId);
  const ids = phases.map((phase) => phase.id);
  const [matchRows, outcomeRows, members] = await Promise.all([
    getPhaseMatchIds(ids),
    getOutcomesByPhases(ids),
    getPhaseMembers(ids),
  ]);

  const stages: Record<string, KitStageRules> = {};
  for (const phase of phases) stages[phase.id] = await stageRulesOf(phase);

  const stageOfMatch: Record<string, string> = {};
  for (const row of matchRows) stageOfMatch[row.id] = row.tournament_id;
  const outcomes: Record<string, KitOutcome> = {};
  for (const row of outcomeRows) {
    outcomes[row.match_id] = { kind: row.kind, p1_faints: row.p1_faints, p2_faints: row.p2_faints };
  }

  const playersOf = new Map<string, string[]>();
  for (const member of members) {
    const list = playersOf.get(member.tournament_id) ?? [];
    list.push(member.player_id);
    playersOf.set(member.tournament_id, list);
  }
  const coinFlips: Record<string, Record<string, number>> = {};
  for (const phase of phases) {
    coinFlips[phase.id] = coinFlipDraws(head.seed, stages[phase.id].key, playersOf.get(phase.id) ?? []);
  }

  return { engine, stages, stageOfMatch, outcomes, coinFlips };
}
