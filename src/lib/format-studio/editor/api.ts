/**
 * The Format Studio editor's request layer: one small function per format and attach route over the studio core's
 * `request` (`@/lib/studio-core/request`), each with an injectable `fetch` so the tests run without a network.
 * Client-safe: it imports types from the library and the i18n error helper only, no server code.
 *
 * Every function resolves to an `ApiOutcome` and never throws: a failed response gives the server's `code` and
 * `params` (the UI renders them with `useApiErrorText`), a request that never reached the server gives
 * `network_error` with status 0. Every path segment is URL-encoded. There are no retries here (the UI decides)
 * and a body is never logged. `classifyApiError` carries the class of every format error code.
 */
import type { LText, Locale } from '@/lib/format-kit/client';
import type { FormatErrorCode } from '@/lib/format-studio/errors';
import type {
  EngineGap,
  FormatCheck,
  FormatDefinitionDetail,
  FormatDefinitionSummary,
  FormatVersionSummary,
  FormatVisibility,
  SeasonFormatSummary,
} from '@/lib/format-studio/library-types';
import { makeClassifier, request, type ApiErrorKind, type ApiOutcome, type FetchLike } from '@/lib/studio-core/request';

export interface CreatedFormatResponse {
  definition: FormatDefinitionSummary;
  check: FormatCheck;
}

export interface SavedDraftResponse {
  draft_rev: number;
  updated_at: string;
  name: LText;
  check: FormatCheck;
}

export interface PublishedFormatResponse {
  version: FormatVersionSummary;
  definition: FormatDefinitionSummary;
}

export interface SeasonFormatAttachResponse {
  season_format: SeasonFormatSummary;
  stages: { id: string; key: string; bracket_type: string; stage_order: number }[];
  warnings: EngineGap[];
}

const enc = encodeURIComponent;

// ─── Format routes ───────────────────────────────────────────────────────────────────────────────

/** `PUT /api/formats/{id}/draft`: compare-and-set on the revision the editor holds. */
export function saveDraftRequest(
  id: string,
  draftRev: number,
  document: unknown,
  f?: FetchLike,
): Promise<ApiOutcome<SavedDraftResponse>> {
  return request(f, 'PUT', `/api/formats/${enc(id)}/draft`, { draft_rev: draftRev, document });
}

/** `GET /api/formats/{id}`: the definition with its draft, published head and check (owner and site admins). */
export function loadFormatDetail(id: string, f?: FetchLike): Promise<ApiOutcome<FormatDefinitionDetail>> {
  return request(f, 'GET', `/api/formats/${enc(id)}`);
}

/** `POST /api/formats/{id}/publish`. */
export function publishRequest(
  id: string,
  draftRev: number,
  changelog?: LText,
  f?: FetchLike,
): Promise<ApiOutcome<PublishedFormatResponse>> {
  const body: { draft_rev: number; changelog?: LText } = { draft_rev: draftRev };
  if (changelog !== undefined) body.changelog = changelog;
  return request(f, 'POST', `/api/formats/${enc(id)}/publish`, body);
}

/** `PATCH /api/formats/{id}`: change who can see the format. */
export function visibilityRequest(
  id: string,
  visibility: FormatVisibility,
  f?: FetchLike,
): Promise<ApiOutcome<{ definition: FormatDefinitionSummary }>> {
  return request(f, 'PATCH', `/api/formats/${enc(id)}`, { visibility });
}

/** `DELETE /api/formats/{id}`. */
export function deleteFormatRequest(id: string, f?: FetchLike): Promise<ApiOutcome<{ deleted: true }>> {
  return request(f, 'DELETE', `/api/formats/${enc(id)}`);
}

/** `POST /api/formats/{id}/fork`: a private copy of a stored format (no body). */
export function forkFormatRequest(id: string, f?: FetchLike): Promise<ApiOutcome<CreatedFormatResponse>> {
  return request(f, 'POST', `/api/formats/${enc(id)}/fork`);
}

/**
 * `POST /api/formats/presets/{presetId}/fork`: a private copy of a shipped example, optionally with a rule preset
 * (a catalog id) pre-picked on every stage.
 */
export function forkPresetRequest(
  presetId: string,
  rulesetPreset?: string,
  f?: FetchLike,
): Promise<ApiOutcome<CreatedFormatResponse>> {
  return request(f, 'POST', `/api/formats/presets/${enc(presetId)}/fork`, rulesetPreset === undefined ? undefined : { ruleset_preset: rulesetPreset });
}

/** `POST /api/formats`: a whole document, or a name and its language for a skeleton. */
export function createFormatRequest(
  body: { document: unknown } | { name: string; base_locale: Locale },
  f?: FetchLike,
): Promise<ApiOutcome<CreatedFormatResponse>> {
  return request(f, 'POST', '/api/formats', body);
}

// ─── Attach routes ───────────────────────────────────────────────────────────────────────────────

/** `POST /api/seasons/{id}/format`: attach (or re-attach) a published version to a custom league. */
export function attachFormatRequest(
  seasonId: string,
  definitionId: string,
  versionNo: number,
  f?: FetchLike,
): Promise<ApiOutcome<SeasonFormatAttachResponse>> {
  return request(f, 'POST', `/api/seasons/${enc(seasonId)}/format`, { definition_id: definitionId, version_no: versionNo });
}

/** `DELETE /api/seasons/{id}/format`: remove the attached format and the phases it created. */
export function detachFormatRequest(seasonId: string, f?: FetchLike): Promise<ApiOutcome<{ removed_stage_ids: string[] }>> {
  return request(f, 'DELETE', `/api/seasons/${enc(seasonId)}/format`);
}

// ─── Error classes ───────────────────────────────────────────────────────────────────────────────

/**
 * The class of every format error code. A `Record` over `FormatErrorCode` makes a new code a type error until it
 * is classified here.
 */
const FORMAT_CODE_KINDS: Readonly<Record<FormatErrorCode, ApiErrorKind>> = {
  format_not_found: 'not_found',
  format_preset_not_found: 'not_found',
  format_stale_revision: 'stale_revision',
  format_slug_taken: 'blocked',
  format_document_not_json: 'invalid',
  format_document_not_object: 'invalid',
  format_document_too_deep: 'invalid',
  format_document_too_many_nodes: 'invalid',
  format_document_too_large: 'too_large',
  format_document_too_large_to_store: 'too_large',
  format_document_name_required: 'invalid',
  format_publish_invalid: 'invalid',
  format_nothing_to_publish: 'blocked',
  format_not_published: 'blocked',
  format_published_locked: 'forbidden',
  format_visibility_forbidden: 'forbidden',
  format_preset_locked: 'forbidden',
  format_attached: 'blocked',
  format_has_versions: 'blocked',
  format_version_immutable: 'blocked',
  format_season_not_custom: 'blocked',
  format_season_started: 'blocked',
  format_attach_forbidden: 'forbidden',
  format_attach_ruleset_forbidden: 'forbidden',
  format_attach_invalid: 'invalid',
  format_attach_ruleset_required: 'invalid',
  format_attach_manual_phases: 'blocked',
  format_not_attached: 'blocked',
  format_nothing_attached: 'not_found',
  format_detach_blocked: 'blocked',
  season_format_type_locked: 'blocked',
};

/** Sorts an API error into a class the UI reacts to (a conflict dialog, a retry hint, a sign-in prompt, ...). */
export const classifyApiError = makeClassifier({
  // `season_not_found` is the one code outside the format list that the attach panel meets.
  codeKinds: { ...FORMAT_CODE_KINDS, season_not_found: 'not_found' },
  staleRevisionCode: 'format_stale_revision',
});
