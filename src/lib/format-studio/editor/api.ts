/**
 * The Studio editor's request layer: one small function per format and attach route, each with an injectable
 * `fetch` so the tests run without a network. Client-safe: it imports types from the library and the i18n error
 * helper only, no server code.
 *
 * The error shape is `ApiErrorLike` (a type import only): `@/i18n/api-errors` itself reaches the format pack and so
 * zod in a static import walk, which the editor-core closure test forbids. The body is read here with the same
 * rules instead.
 *
 * Every function resolves to an `ApiOutcome` and never throws: a failed response gives the server's `code` and
 * `params` (the UI renders them with `useApiErrorText`), a request that never reached the server gives
 * `network_error` with status 0. Every path segment is URL-encoded. There are no retries here (the UI decides)
 * and a body is never logged.
 */
import type { ApiErrorLike } from '@/i18n/api-errors';
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

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ApiOutcome<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiErrorLike };

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

function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

const enc = encodeURIComponent;

interface Envelope {
  success?: unknown;
  data?: unknown;
}

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `error`, `code` and `params` members of an API error body that have the right type (as `toApiErrorLike`). */
function errorLikeOf(body: unknown): ApiErrorLike {
  if (!isRecord(body)) return {};
  const out: ApiErrorLike = {};
  if (typeof body.error === 'string') out.error = body.error;
  if (typeof body.code === 'string') out.code = body.code;
  if (isRecord(body.params)) {
    const params: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(body.params)) {
      if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) params[name] = value;
    }
    out.params = params;
  }
  return out.error !== undefined || out.code !== undefined ? out : {};
}

/** The error of a failed response: the server's code and params, else a code derived from the status. */
function failureOf(response: Response, body: unknown): ApiErrorLike {
  const parsed = errorLikeOf(body);
  if (parsed.code !== undefined && parsed.code !== null) return parsed;
  if (response.status === 401) return { ...parsed, code: 'unauthenticated' };
  if (response.status === 429) {
    const header = response.headers?.get('retry-after');
    const seconds = header === null || header === undefined || header.trim() === '' ? Number.NaN : Number(header);
    return Number.isFinite(seconds) && seconds >= 0
      ? { ...parsed, code: 'rate_limited', params: { seconds } }
      : { ...parsed, code: 'rate_limited' };
  }
  return { ...parsed, code: 'unknown_error' };
}

async function request<T>(
  f: FetchLike | undefined,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiOutcome<T>> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await (f ?? defaultFetch)(path, init);
  } catch {
    return { ok: false, status: 0, error: { code: 'network_error' } };
  }
  const parsed: unknown = await response.json().catch(() => null);
  if (response.ok && isEnvelope(parsed) && parsed.success === true) {
    return { ok: true, data: parsed.data as T };
  }
  return { ok: false, status: response.status, error: failureOf(response, parsed) };
}

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

/** `POST /api/formats/presets/{presetId}/fork`: a private copy of a shipped example. */
export function forkPresetRequest(presetId: string, f?: FetchLike): Promise<ApiOutcome<CreatedFormatResponse>> {
  return request(f, 'POST', `/api/formats/presets/${enc(presetId)}/fork`);
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

export type ApiErrorKind =
  | 'stale_revision'
  | 'rate_limited'
  | 'too_large'
  | 'forbidden'
  | 'unauthenticated'
  | 'not_found'
  | 'invalid'
  | 'blocked'
  | 'network'
  | 'other';

export interface ClassifiedError {
  kind: ApiErrorKind;
  /** The revision the server holds (`stale_revision`). */
  staleRev?: number;
  /** Seconds until the next request is allowed (`rate_limited`). */
  retryAfter?: number;
}

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
  format_attach_invalid: 'invalid',
  format_attach_ruleset_required: 'invalid',
  format_attach_manual_phases: 'blocked',
  format_not_attached: 'blocked',
  format_nothing_attached: 'not_found',
  format_detach_blocked: 'blocked',
  season_format_type_locked: 'blocked',
};

/** Codes outside the format list that the editor and the attach panel meet. */
const OTHER_CODE_KINDS: Readonly<Record<string, ApiErrorKind>> = {
  rate_limited: 'rate_limited',
  validation_failed: 'invalid',
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
  season_not_found: 'not_found',
  network_error: 'network',
};

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function numberParam(error: ApiErrorLike, name: string): number | undefined {
  const value = error.params?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Sorts an API error into a class the UI reacts to (a conflict dialog, a retry hint, a sign-in prompt, ...). */
export function classifyApiError(error: ApiErrorLike, status?: number): ClassifiedError {
  const code = error.code ?? undefined;
  if (code === 'format_stale_revision') {
    const staleRev = numberParam(error, 'draft_rev');
    return staleRev === undefined ? { kind: 'stale_revision' } : { kind: 'stale_revision', staleRev };
  }
  if (code === 'rate_limited' || (code === undefined && status === 429)) {
    const retryAfter = numberParam(error, 'seconds');
    return retryAfter === undefined ? { kind: 'rate_limited' } : { kind: 'rate_limited', retryAfter };
  }
  if (code !== undefined) {
    if (hasOwn(FORMAT_CODE_KINDS, code)) return { kind: FORMAT_CODE_KINDS[code as FormatErrorCode] };
    if (hasOwn(OTHER_CODE_KINDS, code)) return { kind: OTHER_CODE_KINDS[code] };
  }
  if (status === 401) return { kind: 'unauthenticated' };
  if (status === 0) return { kind: 'network' };
  return { kind: 'other' };
}
