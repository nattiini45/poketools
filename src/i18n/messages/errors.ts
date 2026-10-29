/**
 * The error-code contract (i18n-core §4.1; owner G0-ERR, never edited
 * afterwards: a catalog's codes change only inside its own `en.ts`/`de.ts`).
 *
 * Servers keep sending an English `error` and add a `code` (plus `params`
 * for templated messages). `ApiErrorCode` is the union of every catalog's
 * keys; keys are unique across catalogs (`error-codes.test.ts`). Clients
 * render through `useApiErrorText(...)` (`src/i18n/use-api-error.ts`).
 *
 * Imported as `@/i18n/messages/errors`. It lives beside the `errors/` folder
 * rather than in `errors/index.ts`: every `messages/**\/index.ts` is one
 * namespace (`parity.test.ts`), and this module is the registry of thirteen.
 */
import type { MessageTree, Namespace, ParamNames, PluralForms } from '@/i18n/types';
import type adminEn from './errors/admin/en';
import type adminAssistantEn from './errors/admin-assistant/en';
import type aiEn from './errors/ai/en';
import type authEn from './errors/auth/en';
import type broadcastEn from './errors/broadcast/en';
import type commonEn from './errors/common/en';
import type draftEn from './errors/draft/en';
import type draftLegacyEn from './errors/draft-legacy/en';
import type matchesEn from './errors/matches/en';
import type playersEn from './errors/players/en';
import type seasonsEn from './errors/seasons/en';
import type statsEn from './errors/stats/en';
import type teamsEn from './errors/teams/en';
import type tournamentsEn from './errors/tournaments/en';
import { errorsAdmin } from './errors/admin';
import { errorsAdminAssistant } from './errors/admin-assistant';
import { errorsAi } from './errors/ai';
import { errorsAuth } from './errors/auth';
import { errorsBroadcast } from './errors/broadcast';
import { errorsCommon } from './errors/common';
import { errorsDraft } from './errors/draft';
import { errorsDraftLegacy } from './errors/draft-legacy';
import { errorsMatches } from './errors/matches';
import { errorsPlayers } from './errors/players';
import { errorsSeasons } from './errors/seasons';
import { errorsStats } from './errors/stats';
import { errorsTeams } from './errors/teams';
import { errorsTournaments } from './errors/tournaments';

export {
  errorsAdmin,
  errorsAdminAssistant,
  errorsAi,
  errorsAuth,
  errorsBroadcast,
  errorsCommon,
  errorsDraft,
  errorsDraftLegacy,
  errorsMatches,
  errorsPlayers,
  errorsSeasons,
  errorsStats,
  errorsTeams,
  errorsTournaments,
};

/** Every error catalog by domain. `errorsCommon` is always consulted first by `apiErrorText`. */
export const ERROR_CATALOGS = {
  common: errorsCommon,
  auth: errorsAuth,
  players: errorsPlayers,
  teams: errorsTeams,
  tournaments: errorsTournaments,
  matches: errorsMatches,
  seasons: errorsSeasons,
  admin: errorsAdmin,
  adminAssistant: errorsAdminAssistant,
  ai: errorsAi,
  broadcast: errorsBroadcast,
  stats: errorsStats,
  draft: errorsDraft,
  draftLegacy: errorsDraftLegacy,
} as const;

type AllErrorMessages = typeof commonEn &
  typeof authEn &
  typeof playersEn &
  typeof teamsEn &
  typeof tournamentsEn &
  typeof matchesEn &
  typeof seasonsEn &
  typeof adminEn &
  typeof adminAssistantEn &
  typeof aiEn &
  typeof broadcastEn &
  typeof statsEn &
  typeof draftEn &
  typeof draftLegacyEn;

/** Every machine-readable API error code. */
export type ApiErrorCode = keyof AllErrorMessages & string;

/** Placeholder names of one catalog leaf (`count` included for plurals). */
type LeafParamNames<L> = L extends string
  ? ParamNames<L>
  : L extends PluralForms
    ? ParamNames<L['one']> | ParamNames<L['other']> | 'count'
    : never;

/** The placeholder names the English message of `C` prints. */
export type MessageParams<C extends ApiErrorCode> = LeafParamNames<AllErrorMessages[C]>;

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

/**
 * Params of an error. Exact for one literal code (every placeholder is
 * required); permissive for a union or the wide `ApiErrorCode`. Extra params
 * are always allowed (e.g. `STALE_SLOT` sends `current_slot_id`), and values
 * are never `null`.
 */
export type ApiErrorParams<C extends ApiErrorCode> =
  true extends IsUnion<C>
    ? Readonly<Record<string, string | number>>
    : { readonly [K in MessageParams<C>]: string | number } & Readonly<Record<string, string | number>>;

/** Any error catalog, as `apiErrorText` / `useApiErrorText` take it. */
export type ErrorCatalog = Namespace<MessageTree>;
