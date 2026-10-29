/**
 * Ambiguity as data (plan 4.9). The model emits structured intent; deterministic code does dates, counts, name
 * matching and canonicalisation. A question is BLOCKING only if the Plan cannot be `ready` without the answer;
 * everything else gets a default recorded as an assumption (an "assumed" chip with a one-click change) and, at most,
 * a non-blocking question. At most three blocking questions go to the admin per turn; the rest wait.
 *
 * This module derives the questions the Plan itself implies, from its readiness blockers and a few non-blocking
 * defaults. Each question is a structured card (`choice`, `multi`, `text`, `date`, `player_pick`, `number`): ids,
 * options as ids, params. No prose is produced here; the card catalog (`admin-assistant-cards`) words each topic and
 * option id. The validated answer becomes the `request_clarification` tool result, so free text cannot pose as an
 * approval.
 *
 * Questions the Plan cannot see (resolving "next Monday" to a date, the capability-gap card text) belong to the
 * `resolve_date` and `engine_support` tools; the double-round-robin gap appears here as the choice it implies.
 */
import type { PlanFacts } from './facts';
import type { BlockerParams, PlanBlocker, PlanReadiness } from './readiness';
import type { PlanDocument } from './schema';
import type { Locale } from '@/i18n/config';

export type ClarificationKind = 'choice' | 'multi' | 'text' | 'date' | 'player_pick' | 'number';

export type ClarificationTopic =
  | 'roster_candidates'
  | 'roster_unresolved'
  | 'roster_names'
  | 'roster_count'
  | 'double_round_robin'
  | 'ban_unresolved'
  | 'ban_forme'
  | 'season_dates'
  | 'structure_door'
  | 'ruleset_choice'
  | 'content_language'
  | 'tour_overlay';

export interface ClarificationOption {
  id: string;
  /** The default the assistant would pick; shown first and pre-selected. */
  recommended?: boolean;
}

export interface Clarification {
  /** Stable for the same question, so an answered question is not asked again. */
  id: string;
  kind: ClarificationKind;
  topic: ClarificationTopic;
  blocking: boolean;
  /** The Plan field the answer fixes (the Fix shortcut target). */
  path: string;
  params: BlockerParams;
  options: ClarificationOption[];
}

export interface ClarificationContext {
  /** The viewer's UI language. */
  uiLocale: Locale;
  /** Facts, for the non-blocking questions that need them (the preset's tour extras). */
  facts?: PlanFacts;
}

/** The most blocking questions put to the admin in one turn (plan 4.9). */
export const MAX_BLOCKING_QUESTIONS = 3;

function ask(
  topic: ClarificationTopic,
  kind: ClarificationKind,
  blocking: boolean,
  path: string,
  params: BlockerParams = {},
  options: ClarificationOption[] = [],
): Clarification {
  return { id: `${topic}:${path}`, kind, topic, blocking, path, params, options };
}

function fromBlocker(plan: PlanDocument, blocker: PlanBlocker): Clarification[] {
  const { code, path, params } = blocker;
  switch (code) {
    case 'roster_unresolved': {
      const out: Clarification[] = [];
      plan.slots.roster?.entries.forEach((entry, index) => {
        const entryPath = `/slots/roster/entries/${index}`;
        if (entry.state === 'candidates') {
          out.push(
            ask('roster_candidates', 'player_pick', true, entryPath, { input: entry.input }, entry.player_ids.map((id) => ({ id }))),
          );
        } else if (entry.state === 'unresolved') {
          // Never auto-create a guest, never auto-pick a fuzzy match.
          out.push(
            ask('roster_unresolved', 'choice', true, entryPath, { input: entry.input }, [
              { id: 'search_again', recommended: true },
              { id: 'skip' },
              { id: 'ask_site_admin_for_guest' },
            ]),
          );
        }
      });
      return out;
    }
    case 'roster_required':
      return [ask('roster_names', 'text', true, path, params)];
    case 'roster_count_mismatch':
      return [ask('roster_count', 'number', true, path, params)];
    case 'double_round_robin_unsupported':
      return [
        ask('double_round_robin', 'choice', true, path, params, [
          { id: 'single_round_robin', recommended: true },
          { id: 'owner_schedules_engine_change' },
        ]),
      ];
    case 'ban_name_unresolved':
      return [ask('ban_unresolved', 'text', true, path, params)];
    case 'forme_expansion_needed':
      return [ask('ban_forme', 'choice', true, path, params, [{ id: 'all_formes' }, { id: 'this_forme_only', recommended: true }])];
    case 'SEASON_DATES_INVALID':
      return [ask('season_dates', 'date', true, path, params)];
    case 'custom_league_has_phases':
      // The structure door (Q6): classic phases are what the engine runs and the default.
      return [ask('structure_door', 'choice', true, path, params, [{ id: 'classic_phases', recommended: true }, { id: 'custom_format' }])];
    case 'ruleset_missing':
      // Every phase that names the Plan's ruleset reports it; one question settles them all.
      return [
        ask('ruleset_choice', 'choice', true, '/slots/ruleset', {}, [
          { id: 'new_own_copy', recommended: true },
          { id: 'use_existing' },
          { id: 'fork_existing' },
        ]),
      ];
    default:
      return [];
  }
}

/** Defaults the assistant may confirm in passing: asked once, never blocking. */
function nonBlocking(plan: PlanDocument, context: ClarificationContext): Clarification[] {
  const out: Clarification[] = [];
  const { league, ruleset } = plan.slots;
  const answered = (key: string): boolean => plan.assumptions.some((assumption) => assumption.key === key && assumption.confirmed);

  if (league && context.uiLocale !== plan.contentLocale && !answered('league.language')) {
    // Stored and posted text uses the league's content language; ask once when it differs from the admin's UI language.
    out.push(
      ask('content_language', 'choice', false, '/slots/league/language', { ui: context.uiLocale, content: plan.contentLocale }, [
        { id: plan.contentLocale, recommended: true },
        { id: context.uiLocale },
      ]),
    );
  }
  if (ruleset?.mode === 'new' && ruleset.preset !== undefined && ruleset.tour_overlay === undefined) {
    if (context.facts?.rulesetPresets?.[ruleset.preset]?.hasTourOverlay === true && !answered('ruleset.tour_overlay')) {
      // Draft presets are Showdown-faithful; "add Smogon tour bans" is a visible toggle.
      out.push(
        ask('tour_overlay', 'choice', false, '/slots/ruleset/tour_overlay', { preset: ruleset.preset }, [
          { id: 'keep_preset_bans', recommended: true },
          { id: 'add_tour_bans' },
        ]),
      );
    }
  }
  return out;
}

/** Every question the Plan implies, blocking ones first, in the order of the readiness blockers. */
export function deriveClarifications(plan: PlanDocument, readiness: PlanReadiness, context: ClarificationContext): Clarification[] {
  const seen = new Set<string>();
  const all: Clarification[] = [];
  for (const blocker of readiness.blockers) {
    for (const question of fromBlocker(plan, blocker)) {
      if (seen.has(question.id)) continue;
      seen.add(question.id);
      all.push(question);
    }
  }
  for (const question of nonBlocking(plan, context)) {
    if (!seen.has(question.id)) all.push(question);
  }
  return all;
}

export interface QuestionBatch {
  /** Put to the admin now: up to `max` blocking questions. */
  ask: Clarification[];
  /** Everything else: later turns, or answered by the default. */
  later: Clarification[];
}

/** Take the first `max` blocking questions for this turn. Non-blocking ones never use the budget; they wait. */
export function nextQuestions(questions: readonly Clarification[], max: number = MAX_BLOCKING_QUESTIONS): QuestionBatch {
  const blocking = questions.filter((question) => question.blocking);
  const batch = blocking.slice(0, Math.max(0, max));
  const chosen = new Set(batch.map((question) => question.id));
  return { ask: batch, later: questions.filter((question) => !chosen.has(question.id)) };
}
