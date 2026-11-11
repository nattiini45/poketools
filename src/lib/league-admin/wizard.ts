import type { Locale } from '@/i18n/config';
import type { RouteThemeId, SeasonFormData, SeasonFormatType } from '@/types/season';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { buildCreateRequest, type CloneChoice, type CreateLeagueRequest } from './clone-source';
import { leagueCreatedHref } from './tabs';

/**
 * The new-competition wizard (`/admin/leagues/new`). Pure and client-safe: the server page builds the starting points,
 * the client wizard reads the same helpers to build the one `POST /api/seasons` request.
 */

/** One stage of an example, as the summary rail lists it (already in the viewer's language). */
export interface WizardStage {
  key: string;
  name: string;
  /** Pairing and series in one line. */
  detail: string;
}

/** A shipped example format the wizard can create a league from. */
export interface WizardExample {
  id: string;
  title: string;
  summary: string | null;
  /** The stage chain in one sentence. */
  overview: string;
  stages: WizardStage[];
  /** A stage plays under the league's ruleset, so the league needs one. */
  needsLeagueRuleset: boolean;
  /** Rulesets the example brings along (created with the league from its rule presets). */
  presetRulesetCount: number;
}

/** A published format the viewer may attach. Names only: no owner id, no draft body. */
export interface WizardFormat {
  id: string;
  name: string;
  version: number;
  ownerName: string | null;
  mine: boolean;
}

/** Where the new league starts. */
export type WizardStart = { kind: 'preset'; id: string } | { kind: 'format'; id: string } | { kind: 'blank' } | { kind: 'copy' };

export const WIZARD_STEPS = ['start', 'details', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** The Details step's values, as the inputs hold them (empty string = unset). */
export interface WizardDetails {
  name: string;
  description: string;
  formatType: SeasonFormatType;
  rulesetId: string;
  startDate: string;
  endDate: string;
  routeTheme: RouteThemeId;
  language: Locale;
}

/** The link that opens the wizard with a starting point already picked. */
export function wizardHref(start?: { preset: string } | { format: string }): string {
  if (!start) return '/admin/leagues/new';
  return 'preset' in start
    ? `/admin/leagues/new?preset=${encodeURIComponent(start.preset)}`
    : `/admin/leagues/new?format=${encodeURIComponent(start.format)}`;
}

/** The starting point a wizard link names, if it is one the viewer can use; otherwise none is picked. */
export function wizardStartFromQuery(
  query: { preset?: string; format?: string },
  examples: readonly WizardExample[],
  formats: readonly WizardFormat[],
): WizardStart | null {
  if (query.preset && examples.some((example) => example.id === query.preset)) return { kind: 'preset', id: query.preset };
  if (query.format && formats.some((format) => format.id === query.format)) return { kind: 'format', id: query.format };
  return null;
}

/** True when the league type is chosen by the starting point (a format makes the league `custom`). */
export function startsFromFormat(start: WizardStart): start is { kind: 'preset'; id: string } | { kind: 'format'; id: string } {
  return start.kind === 'preset' || start.kind === 'format';
}

export type WizardRequest = CreateLeagueRequest & {
  from_format?: { preset_id: string } | { definition_id: string; version_no?: number };
};

/**
 * The `POST /api/seasons` body for the wizard's choices. A format start is a `custom` league with `from_format`; a copy
 * carries `clone_from`; a blank league is the plain create. A point-buy league never sends a ruleset: the server sets
 * the pack's battle ruleset.
 */
export function buildWizardRequest(input: {
  start: WizardStart;
  details: WizardDetails;
  formats: readonly WizardFormat[];
  clone: CloneChoice | null;
  isSiteAdmin: boolean;
}): WizardRequest {
  const { start, details } = input;
  const formatType: SeasonFormatType = startsFromFormat(start) ? 'custom' : details.formatType;
  const data: SeasonFormData = {
    name: details.name.trim(),
    description: details.description || undefined,
    format_type: formatType,
    ruleset_id: isEvolutionPointBuy(formatType) ? null : details.rulesetId || null,
    start_date: details.startDate || null,
    end_date: details.endDate || null,
    route_theme: details.routeTheme,
    language: details.language,
  };
  if (start.kind === 'preset') return { ...data, from_format: { preset_id: start.id } };
  if (start.kind === 'format') {
    const format = input.formats.find((entry) => entry.id === start.id);
    return { ...data, from_format: { definition_id: start.id, ...(format ? { version_no: format.version } : {}) } };
  }
  return buildCreateRequest(data, start.kind === 'copy' ? input.clone : null, input.isSiteAdmin);
}

/**
 * Where the admin lands after the league exists. A league made from a format opens its overview, where the readiness
 * card lists the next steps; the others go where a plain create goes.
 */
export function wizardCreatedHref(leagueId: string, start: WizardStart, formatType: SeasonFormatType): string {
  return startsFromFormat(start) ? `/admin/leagues/${leagueId}` : leagueCreatedHref(leagueId, formatType);
}

/** What stops the Details step (a key of `wizard.problems`), or null when it may continue. */
export function detailsProblem(start: WizardStart, details: WizardDetails, example: WizardExample | null, cloneSourceId: string | null): 'name' | 'dates' | 'ruleset' | 'source' | null {
  if (!details.name.trim()) return 'name';
  if (details.startDate && details.endDate && details.endDate < details.startDate) return 'dates';
  if (start.kind === 'preset' && example?.needsLeagueRuleset && !details.rulesetId) return 'ruleset';
  if (start.kind === 'copy' && !cloneSourceId) return 'source';
  return null;
}
