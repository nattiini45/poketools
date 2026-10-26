import type { Locale } from '@/i18n/config';
import type { SeasonFormData, SeasonFormatType, SeasonStatus, RouteThemeId } from '@/types/season';

/**
 * "Start from an existing league" (admin league create page). Pure and
 * client-safe: the server page builds the options, the client picker and
 * creator read the same helpers.
 */

/** A league the viewer may start from: lean season fields and two counts, no player rows. */
export interface CloneSourceOption {
  id: string;
  name: string;
  format_type: SeasonFormatType;
  status: SeasonStatus;
  archived: boolean;
  is_test_season: boolean;
  ruleset_id: string | null;
  route_theme: RouteThemeId;
  language: Locale;
  description: string;
  /** Phases (stages) of the league. */
  phase_count: number;
  /** Roster size of the league. */
  participant_count: number;
}

/**
 * Whether a league of this type can be a clone source. A custom league gets its phases from an
 * attached format, so a copy of its phases could not attach one and could never start: the picker
 * leaves such leagues out and the server refuses them (`SEASON_CLONE_CUSTOM_FORMAT`).
 */
export function isCloneSourceFormat(format: SeasonFormatType): boolean {
  return format !== 'custom';
}

/** What the viewer picked in the source picker. */
export interface CloneChoice {
  sourceId: string;
  copyRoster: boolean;
  copyAdmins: boolean;
}

/** The `POST /api/seasons` body: the form payload and the optional clone block (`seasonCreateRequestSchema`). */
export type CreateLeagueRequest = SeasonFormData & {
  clone_from?: { season_id: string; copy_roster?: boolean; copy_admins?: boolean };
};

/**
 * The create form's starting values for a source: the settings a new league
 * usually repeats. Never the name (it must be new) and never the dates (they
 * belong to the new season).
 */
export function cloneFormDefaults(option: CloneSourceOption): Partial<SeasonFormData> {
  return {
    format_type: option.format_type,
    ruleset_id: option.ruleset_id,
    route_theme: option.route_theme,
    language: option.language,
    description: option.description,
  };
}

/** What the admin typed that belongs to the new league whatever it starts from ('' = unset). */
export interface LeagueFormIdentity {
  name: string;
  start_date: string;
  end_date: string;
}

/**
 * The create form's `initialData`: the source's defaults (if any) under what was typed, so picking
 * or changing the source (which remounts the form) never wipes the name and dates.
 */
export function createFormInitialData(
  option: CloneSourceOption | null,
  identity: LeagueFormIdentity,
): Partial<SeasonFormData> {
  return { ...(option ? cloneFormDefaults(option) : {}), ...identity };
}

/**
 * The `POST /api/seasons` body. Without a source it is the form payload as
 * is; with one it gains `clone_from`. `copy_admins` is sent only by site
 * admins (the server refuses it from anyone else).
 */
export function buildCreateRequest(
  data: SeasonFormData,
  choice: CloneChoice | null,
  isSiteAdmin: boolean,
): CreateLeagueRequest {
  if (!choice) return data;
  return {
    ...data,
    clone_from: {
      season_id: choice.sourceId,
      copy_roster: choice.copyRoster,
      ...(isSiteAdmin ? { copy_admins: choice.copyAdmins } : {}),
    },
  };
}
