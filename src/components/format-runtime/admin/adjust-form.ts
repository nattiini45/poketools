/**
 * The forms of the adjustments panel, as plain functions: which kinds the UI builds, and how a draft the admin typed
 * becomes the request body (or the first problem with it). The server checks everything again (the zod schema and the
 * library), so this is the cheap first line that keeps an obviously wrong request off the wire. Pure and client-safe.
 */
import { SCORE_ABS_MAX } from '@/lib/format-kit/limits';
import type { AdjustmentRequestBody } from '@/lib/format-engine/runtime/client-api-admin';
import type { SubmittableAdjustKind } from '@/lib/format-engine/runtime/view-types';

/** The kinds this panel builds a form for. `action` has buttons on the player actions section instead. */
export const FORM_KINDS = ['points', 'resource', 'relation'] as const;
export type FormKind = (typeof FORM_KINDS)[number];

/** The kinds of the format that this UI has no form for: they stay available through the API only. */
export const API_ONLY_KINDS = ['rank', 'domain', 'relation_links'] as const;
export type ApiOnlyKind = (typeof API_ONLY_KINDS)[number];

/** The form kinds the format allows, in display order. */
export function formKindsOf(allowed: readonly SubmittableAdjustKind[]): FormKind[] {
  return FORM_KINDS.filter((kind) => allowed.includes(kind));
}

/** Allowed kinds without a form here (`relation_links`: a relation can be revealed here, linked through the API). */
export function apiOnlyKindsOf(allowed: readonly SubmittableAdjustKind[]): ApiOnlyKind[] {
  const out: ApiOnlyKind[] = [];
  if (allowed.includes('rank')) out.push('rank');
  if (allowed.includes('domain')) out.push('domain');
  if (allowed.includes('relation')) out.push('relation_links');
  return out;
}

/** The first problem of a draft, by key (`adjust.error.<key>`). */
export type DraftError =
  | 'stage_required'
  | 'player_required'
  | 'points_required'
  | 'points_format'
  | 'points_zero'
  | 'points_range'
  | 'resource_required'
  | 'item_required'
  | 'amount_required'
  | 'amount_format'
  | 'amount_range'
  | 'relation_required'
  | 'nothing_to_do';

export type Parsed = { ok: true; body: AdjustmentRequestBody['adjustment'] } | { ok: false; error: DraftError };

export interface PointsDraft {
  stage: string;
  player: string;
  points: string;
}

export interface ResourceDraft {
  resource: string;
  player: string;
  /** The entry id; '' while none is chosen (a counter resource needs none). */
  item: string;
  direction: 'grant' | 'revoke';
  amount: string;
}

export interface RelationDraft {
  relation: string;
  reveal: boolean;
}

export const EMPTY_POINTS: PointsDraft = { stage: '', player: '', points: '' };
export const EMPTY_RESOURCE: ResourceDraft = { resource: '', player: '', item: '', direction: 'grant', amount: '1' };
export const EMPTY_RELATION: RelationDraft = { relation: '', reveal: false };

/** At most 2 decimals; a comma works as the decimal mark. */
const POINTS_PATTERN = /^[+-]?\d+(?:[.,]\d{1,2})?$/;
const AMOUNT_MAX = 64;

export function parsePoints(draft: PointsDraft): Parsed {
  if (draft.stage === '') return { ok: false, error: 'stage_required' };
  if (draft.player === '') return { ok: false, error: 'player_required' };
  const raw = draft.points.trim();
  if (raw === '') return { ok: false, error: 'points_required' };
  if (!POINTS_PATTERN.test(raw)) return { ok: false, error: 'points_format' };
  const points = Number(raw.replace(',', '.'));
  if (points === 0) return { ok: false, error: 'points_zero' };
  if (Math.abs(points) > SCORE_ABS_MAX) return { ok: false, error: 'points_range' };
  return { ok: true, body: { kind: 'points', stage: draft.stage, player_id: draft.player, points } };
}

/** `holdsDomain`: the chosen resource holds entries of a list, so an entry must be chosen. */
export function parseResource(draft: ResourceDraft, holdsDomain: boolean): Parsed {
  if (draft.resource === '') return { ok: false, error: 'resource_required' };
  if (draft.player === '') return { ok: false, error: 'player_required' };
  if (holdsDomain && draft.item === '') return { ok: false, error: 'item_required' };
  const raw = draft.amount.trim();
  if (raw === '') return { ok: false, error: 'amount_required' };
  if (!/^\d+$/.test(raw)) return { ok: false, error: 'amount_format' };
  const amount = Number(raw);
  if (amount < 1 || amount > AMOUNT_MAX) return { ok: false, error: 'amount_range' };
  return {
    ok: true,
    body: {
      kind: 'resource',
      resource: draft.resource,
      player_id: draft.player,
      ...(holdsDomain ? { item_id: draft.item } : {}),
      amount: draft.direction === 'revoke' ? -amount : amount,
    },
  };
}

export function parseRelation(draft: RelationDraft): Parsed {
  if (draft.relation === '') return { ok: false, error: 'relation_required' };
  if (!draft.reveal) return { ok: false, error: 'nothing_to_do' };
  return { ok: true, body: { kind: 'relation', relation: draft.relation, reveal: true } };
}

export function isPointsDirty(draft: PointsDraft): boolean {
  return draft.stage !== '' || draft.player !== '' || draft.points !== '';
}

export function isResourceDirty(draft: ResourceDraft): boolean {
  return draft.resource !== '' || draft.player !== '' || draft.item !== '' || draft.direction !== 'grant' || draft.amount !== EMPTY_RESOURCE.amount;
}

export function isRelationDirty(draft: RelationDraft): boolean {
  return draft.relation !== '' || draft.reveal;
}
