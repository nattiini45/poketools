/**
 * The league groups editor's requests and what each answer means for the editor (client-safe, no React, no DOM).
 * `LeagueGroupsEditor` drives them with the browser's `fetch`; tests drive them with a fake one.
 *
 * Endpoints (all league-admin only):
 * - `GET  /api/seasons/[id]/groups` — the editor DTO;
 * - `PUT  …/groups` — split by seed (`serpentine`) or remove every group (`clear`); answers the DTO;
 * - `PATCH …/groups/members` — move a trainer, or place one who is in no group; answers the DTO;
 * - `PATCH …/groups/[groupId]` — rename; answers the group only, so the editor reloads the DTO.
 */
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import type { ApiResult } from '@/types/api';
import type { LeagueGroupsEditorDTO } from '@/types/league-groups-editor';

/** The editor's own failure keys (`league-admin/groups` `editor.errors.*`): a request that got no usable answer. */
export type EditorFailKey = 'loadFailed' | 'saveFailed' | 'renameFailed' | 'moveFailed';

export interface EditorWrite {
  url: string;
  method: 'PUT' | 'PATCH';
  body: unknown;
  failKey: Exclude<EditorFailKey, 'loadFailed'>;
}

/** `fetch` as the editor uses it (the browser's, or a test double). */
export type EditorFetch = (url: string, init?: RequestInit) => Promise<{ json: () => Promise<unknown> }>;

export function groupsBase(seasonId: string): string {
  return `/api/seasons/${encodeURIComponent(seasonId)}/groups`;
}

export function splitWrite(seasonId: string, groupCount: number): EditorWrite {
  return { url: groupsBase(seasonId), method: 'PUT', body: { mode: 'serpentine', group_count: groupCount }, failKey: 'saveFailed' };
}

export function clearWrite(seasonId: string): EditorWrite {
  return { url: groupsBase(seasonId), method: 'PUT', body: { mode: 'clear' }, failKey: 'saveFailed' };
}

export function placeWrite(seasonId: string, playerId: string, groupId: string): EditorWrite {
  return {
    url: `${groupsBase(seasonId)}/members`,
    method: 'PATCH',
    body: { player_id: playerId, group_id: groupId },
    failKey: 'moveFailed',
  };
}

export function renameWrite(seasonId: string, groupId: string, name: string): EditorWrite {
  return {
    url: `${groupsBase(seasonId)}/${encodeURIComponent(groupId)}`,
    method: 'PATCH',
    body: { name },
    failKey: 'renameFailed',
  };
}

/** A DTO-shaped answer (the PUT and members PATCH); a rename answers the group instead. */
export function isEditorDTO(value: unknown): value is LeagueGroupsEditorDTO {
  return (
    typeof value === 'object' &&
    value !== null &&
    'groups' in value &&
    Array.isArray(value.groups) &&
    'participants' in value &&
    Array.isArray(value.participants)
  );
}

function isApiResult(value: unknown): value is ApiResult<unknown> {
  return typeof value === 'object' && value !== null && 'success' in value && typeof value.success === 'boolean';
}

export type EditorLoadOutcome =
  | { kind: 'loaded'; data: LeagueGroupsEditorDTO }
  | { kind: 'refused'; error: ApiErrorLike }
  | { kind: 'failed'; key: 'loadFailed' };

/** Reads the editor DTO. A refusal keeps its code; no answer, or an answer that is no DTO, is `loadFailed`. */
export async function loadEditor(fetchFn: EditorFetch, seasonId: string): Promise<EditorLoadOutcome> {
  try {
    const result = await (await fetchFn(groupsBase(seasonId))).json();
    if (!isApiResult(result)) {
      console.error('[league-groups-editor] the groups read answered no API result:', result);
      return { kind: 'failed', key: 'loadFailed' };
    }
    if (!result.success) return { kind: 'refused', error: toApiErrorLike(result) };
    if (isEditorDTO(result.data)) return { kind: 'loaded', data: result.data };
    console.error('[league-groups-editor] the groups read answered no editor DTO:', result.data);
    return { kind: 'failed', key: 'loadFailed' };
  } catch (err) {
    // A network failure or a non-JSON body; logged so a client bug does not pass for a network failure.
    console.error('[league-groups-editor] loading the groups failed:', err);
    return { kind: 'failed', key: 'loadFailed' };
  }
}

export type EditorWriteOutcome =
  /** `data` null: the answer is no DTO (a rename): reload it. */
  | { kind: 'saved'; data: LeagueGroupsEditorDTO | null }
  /** The server refused (its code renders the reason); the lock state may have changed meanwhile: reload it. */
  | { kind: 'refused'; error: ApiErrorLike }
  /** No usable answer (network, a non-JSON body). */
  | { kind: 'failed'; key: EditorWrite['failKey'] };

export async function sendEditorWrite(fetchFn: EditorFetch, write: EditorWrite): Promise<EditorWriteOutcome> {
  try {
    const res = await fetchFn(write.url, {
      method: write.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(write.body),
    });
    const result = await res.json();
    if (!isApiResult(result)) {
      console.error(`[league-groups-editor] ${write.method} ${write.url} answered no API result:`, result);
      return { kind: 'failed', key: write.failKey };
    }
    if (!result.success) return { kind: 'refused', error: toApiErrorLike(result) };
    return { kind: 'saved', data: isEditorDTO(result.data) ? result.data : null };
  } catch (err) {
    // A network failure or a non-JSON body; logged so a client bug does not pass for a network failure.
    console.error(`[league-groups-editor] ${write.method} ${write.url} failed:`, err);
    return { kind: 'failed', key: write.failKey };
  }
}

/**
 * Whether the editor re-reads its DTO after a write: after a rename (its answer is no DTO) and after a refusal (a
 * draft may have started, or a round been generated, since the editor loaded: the fresh lock state explains the
 * refusal and greys the controls out). A failed request changed nothing the editor could see: no reload.
 */
export function reloadAfter(outcome: EditorWriteOutcome): boolean {
  return (outcome.kind === 'saved' && outcome.data === null) || outcome.kind === 'refused';
}

/** What the editor shows after a write: an API refusal (rendered from its code) or a request that got no answer. */
export type EditorWriteError = { api: ApiErrorLike } | { key: EditorFailKey };

/** The editor's state setters one write drives (`runEditorWrite`), so the sequence is testable without a DOM. */
export interface EditorWriteSink {
  /** Clear the previous refusal and the "saved" note before sending. */
  begin(): void;
  /** The write went through; `data` is the fresh DTO, or null when the answer carries none (a rename). */
  saved(data: LeagueGroupsEditorDTO | null): void;
  /** The write was refused or got no answer. */
  failed(error: EditorWriteError): void;
  /** Re-read the DTO; `keepError`: a reload after a refusal keeps the refusal on screen. */
  reload(keepError: boolean): Promise<void>;
}

/**
 * One editor write: clear, send, apply the answer, then re-read when `reloadAfter` says so (after a rename, and
 * after a refusal, keeping the refusal visible while the fresh lock state greys the controls out). Resolves true
 * when the write went through.
 */
export async function runEditorWrite(fetchFn: EditorFetch, write: EditorWrite, sink: EditorWriteSink): Promise<boolean> {
  sink.begin();
  const outcome = await sendEditorWrite(fetchFn, write);
  if (outcome.kind === 'saved') sink.saved(outcome.data);
  else sink.failed(outcome.kind === 'refused' ? { api: outcome.error } : { key: outcome.key });
  if (reloadAfter(outcome)) await sink.reload(outcome.kind === 'refused');
  return outcome.kind === 'saved';
}

/** The state change a load's answer makes (`undefined` = leave that piece as it is). */
export interface EditorLoadUpdate {
  data?: LeagueGroupsEditorDTO;
  /** null clears the shown error. */
  error?: EditorWriteError | null;
  /** The split control's group count follows a league that already has two or more groups. */
  groupCount?: number;
}

/**
 * Applies a load's answer. A fresh DTO replaces the data and (unless `keepError`) clears the error; a failed load
 * shows its own error, except a reload after a refusal (`keepError`), which keeps the refusal that explains it.
 */
export function editorLoadUpdate(outcome: EditorLoadOutcome, keepError: boolean): EditorLoadUpdate {
  if (outcome.kind === 'loaded') {
    return {
      data: outcome.data,
      ...(keepError ? {} : { error: null }),
      ...(outcome.data.groups.length >= 2 ? { groupCount: outcome.data.groups.length } : {}),
    };
  }
  if (keepError) return {};
  return { error: outcome.kind === 'refused' ? { api: outcome.error } : { key: outcome.key } };
}
