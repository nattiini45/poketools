/**
 * The Ruleset Studio editor's request layer: one small function per ruleset library route over the studio core's
 * `request` (`@/lib/studio-core/request`), each with an injectable `fetch` so the tests run without a network.
 * Client-safe: it imports types from the library and the i18n error helper only, no server code.
 *
 * Every function resolves to an `ApiOutcome` and never throws: a failed response gives the server's `code` and
 * `params` (the UI renders them with `useApiErrorText`), a request that never reached the server gives
 * `network_error` with status 0. Every path segment is URL-encoded. There are no retries here (the UI decides) and a body
 * is never logged. `classifyApiError` carries the class of every ruleset error code.
 */
import type { LText, Locale } from '@/lib/studio-core/ltext';
import type { RulesetErrorCode } from '@/lib/ruleset-studio/errors';
import type {
  RulesetCheck,
  RulesetDefinitionDetail,
  RulesetDefinitionSummary,
  RulesetVersionSummary,
  RulesetVisibility,
} from '@/lib/ruleset-studio/library-types';
import type { MovePinsOutcome, PinImpact } from '@/lib/ruleset-studio/pin-info';
import { makeClassifier, request, type ApiErrorKind, type ApiOutcome, type FetchLike } from '@/lib/studio-core/request';

export interface CreatedRulesetResponse {
  definition: RulesetDefinitionSummary;
  check: RulesetCheck;
}

export interface SavedRulesetDraftResponse {
  draft_rev: number;
  updated_at: string;
  name: LText;
  check: RulesetCheck;
}

export interface PublishedRulesetResponse {
  version: RulesetVersionSummary;
  definition: RulesetDefinitionSummary;
}

const enc = encodeURIComponent;
const BASE = '/api/ruleset-definitions';

/** `PUT /api/ruleset-definitions/{id}/draft`: compare-and-set on the revision the editor holds. */
export function saveDraftRequest(
  id: string,
  draftRev: number,
  document: unknown,
  f?: FetchLike,
): Promise<ApiOutcome<SavedRulesetDraftResponse>> {
  return request(f, 'PUT', `${BASE}/${enc(id)}/draft`, { draft_rev: draftRev, document });
}

/** `GET /api/ruleset-definitions/{id}`: the definition with its draft, published head and check (those who may edit it). */
export function loadRulesetDetail(id: string, f?: FetchLike): Promise<ApiOutcome<RulesetDefinitionDetail>> {
  return request(f, 'GET', `${BASE}/${enc(id)}`);
}

/** `POST /api/ruleset-definitions/{id}/publish`. */
export function publishRequest(
  id: string,
  draftRev: number,
  changelog?: LText,
  f?: FetchLike,
): Promise<ApiOutcome<PublishedRulesetResponse>> {
  const body: { draft_rev: number; changelog?: LText } = { draft_rev: draftRev };
  if (changelog !== undefined) body.changelog = changelog;
  return request(f, 'POST', `${BASE}/${enc(id)}/publish`, body);
}

/** `PATCH /api/ruleset-definitions/{id}`: change who can see the ruleset. */
export function visibilityRequest(
  id: string,
  visibility: RulesetVisibility,
  f?: FetchLike,
): Promise<ApiOutcome<{ definition: RulesetDefinitionSummary }>> {
  return request(f, 'PATCH', `${BASE}/${enc(id)}`, { visibility });
}

/** `DELETE /api/ruleset-definitions/{id}`. */
export function deleteRulesetRequest(id: string, f?: FetchLike): Promise<ApiOutcome<{ deleted: true }>> {
  return request(f, 'DELETE', `${BASE}/${enc(id)}`);
}

/** `POST /api/ruleset-definitions/{id}/fork`: a private copy of a stored ruleset (no body). */
export function forkRulesetRequest(id: string, f?: FetchLike): Promise<ApiOutcome<CreatedRulesetResponse>> {
  return request(f, 'POST', `${BASE}/${enc(id)}/fork`);
}

/**
 * `POST /api/ruleset-definitions/presets/{presetId}/fork`: a private ruleset based on a catalog preset (`gen9ou`,
 * `gen9natdexdraft`, ...). With `tourOverlay` the preset's documented Smogon tour clauses and bans are added as ordinary
 * editable entries (the server refuses it for a preset that has none).
 */
export function forkPresetRequest(
  presetId: string,
  options: { tourOverlay?: boolean } = {},
  f?: FetchLike,
): Promise<ApiOutcome<CreatedRulesetResponse>> {
  const body = options.tourOverlay === true ? { tour_overlay: true } : undefined;
  return request(f, 'POST', `${BASE}/presets/${enc(presetId)}/fork`, body);
}

/** A league (`season`) or a phase or standalone tournament (`tournament`) whose pin the caller moves. */
export interface PinTargetRef {
  kind: 'season' | 'tournament';
  id: string;
}

/**
 * `POST /api/ruleset-definitions/{id}/pins`: moves the targets that pin a version of this ruleset to version `toVersionNo`.
 * A target that has started needs its id in `confirmStarted`; without it the server answers `ruleset_pin_confirm_required`
 * (naming the targets) and writes nothing.
 */
export function movePinsRequest(
  id: string,
  toVersionNo: number,
  targets: readonly PinTargetRef[],
  confirmStarted: readonly string[] = [],
  f?: FetchLike,
): Promise<ApiOutcome<MovePinsOutcome>> {
  const body: { to_version_no: number; targets: PinTargetRef[]; confirm_started?: string[] } = {
    to_version_no: toVersionNo,
    targets: [...targets],
  };
  if (confirmStarted.length > 0) body.confirm_started = [...confirmStarted];
  return request(f, 'POST', `${BASE}/${enc(id)}/pins`, body);
}

/**
 * `POST /api/ruleset-definitions/{id}/pins/impact`: how many already-submitted teams of the targets would stop being valid if
 * their pin moved to version `toVersionNo`. Writes nothing; the confirmation dialog of a running league shows the answer.
 */
export function pinImpactRequest(
  id: string,
  toVersionNo: number,
  targets: readonly PinTargetRef[],
  f?: FetchLike,
): Promise<ApiOutcome<PinImpact>> {
  return request(f, 'POST', `${BASE}/${enc(id)}/pins/impact`, { to_version_no: toVersionNo, targets: [...targets] });
}

/** The body of `POST /api/ruleset-definitions`: a whole document, or a name, its language and an optional catalog preset. */
export type CreateRulesetBody =
  | { document: unknown }
  | { name: string; base_locale: Locale; preset?: string; tour_overlay?: boolean };

/** `POST /api/ruleset-definitions`. */
export function createRulesetRequest(body: CreateRulesetBody, f?: FetchLike): Promise<ApiOutcome<CreatedRulesetResponse>> {
  return request(f, 'POST', BASE, body);
}

// ─── Error classes ───────────────────────────────────────────────────────────────────────────────

/**
 * The class of every ruleset error code. A `Record` over `RulesetErrorCode` makes a new code a type error until it is
 * classified here.
 */
const RULESET_CODE_KINDS: Readonly<Record<RulesetErrorCode, ApiErrorKind>> = {
  ruleset_not_found: 'not_found',
  ruleset_forbidden: 'forbidden',
  ruleset_slug_taken: 'blocked',
  ruleset_stale_revision: 'stale_revision',
  ruleset_document_not_json: 'invalid',
  ruleset_document_not_object: 'invalid',
  ruleset_document_too_deep: 'invalid',
  ruleset_document_too_many_nodes: 'invalid',
  ruleset_document_too_large: 'too_large',
  ruleset_document_too_large_to_store: 'too_large',
  ruleset_document_invalid: 'invalid',
  ruleset_nothing_to_publish: 'blocked',
  ruleset_not_published: 'blocked',
  ruleset_published_locked: 'forbidden',
  ruleset_visibility_forbidden: 'forbidden',
  ruleset_preset_locked: 'forbidden',
  ruleset_preset_unknown: 'not_found',
  ruleset_in_use: 'blocked',
  ruleset_version_immutable: 'blocked',
  ruleset_legacy_editor_unsupported: 'blocked',
  ruleset_version_quota_exceeded: 'blocked',
  ruleset_owner_quota_exceeded: 'blocked',
  ruleset_pin_mismatch: 'blocked',
  ruleset_pin_locked: 'blocked',
  ruleset_pin_started: 'blocked',
  ruleset_pin_confirm_required: 'blocked',
  // Someone else changed the pin between the read and the move: the page is stale, and the same move can be retried after a refresh.
  ruleset_pin_moved: 'conflict',
};

/** Sorts an API error into a class the UI reacts to (a conflict dialog, a retry hint, a sign-in prompt, ...). */
export const classifyApiError = makeClassifier({ codeKinds: RULESET_CODE_KINDS, staleRevisionCode: 'ruleset_stale_revision' });
