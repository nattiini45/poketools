/**
 * Pure helpers of the admin control panel (draft-frontend §7): which controls
 * are enabled, the settings form model, the audit "change" column and the
 * datetime-local conversion. Client-safe, no React, no text; unit-tested in
 * `__tests__/admin-view.test.ts`. The server stays authoritative for every
 * rule mirrored here (BE §8.2).
 */
import { invalidDraftConfigField, type DraftConfigCore } from '@/lib/draft/schemas';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import {
  DEFAULT_DRAFT_CONFIG,
  type DraftConfigInput,
  type DraftMode,
  type DraftSnapshotDTO,
  type LineId,
} from '@/types/draft-queue';
import type { RedraftPatch } from './admin-actions';

/** Admin and audit reasons: 3..500 characters after trimming (`reasonSchema`). */
export const REASON_MIN = 3;
export const REASON_MAX = 500;

export function reasonValid(reason: string): boolean {
  const n = reason.trim().length;
  return n >= REASON_MIN && n <= REASON_MAX;
}

/** Void / correct need a paused or complete draft (BR-8, `CORRECTION_REQUIRES_PAUSE`). */
export function correctionsAllowed(vm: Pick<DraftViewModel, 'paused' | 'status'>): boolean {
  return vm.paused || vm.status === 'complete';
}

/** The settings form is editable in setup (initial) or in the redraft's submission phase. */
export function configEditable(vm: Pick<DraftViewModel, 'kind' | 'phase'>): boolean {
  return vm.kind === 'initial' ? vm.phase === 'setup' : vm.phase === 'submissions';
}

/** The penalty select's options: one per ladder stage, `0..ladder.length − 1`. */
export function penaltyStages(ladderSeconds: readonly number[]): number[] {
  return ladderSeconds.map((_, i) => i);
}

/**
 * Publish is enabled once the deadline has passed; before it only with
 * "Force publish" and a reason. Only while the redraft waits for its reveal.
 */
export function publishAllowed(input: {
  phase: 'submissions' | 'locked' | 'drafting' | 'complete' | null;
  deadlineAt: string | null;
  nowMs: number;
  force: boolean;
  reason: string;
}): boolean {
  if (input.phase !== 'submissions' && input.phase !== 'locked') return false;
  const deadline = input.deadlineAt === null ? Number.NaN : Date.parse(input.deadlineAt);
  const due = Number.isFinite(deadline) && deadline <= input.nowMs;
  if (due) return !input.force || reasonValid(input.reason);
  return input.force && reasonValid(input.reason);
}

/** Moves one entry of a list by `delta` (−1 up, +1 down); out-of-range moves return the list unchanged. */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// ── datetime-local ↔ ISO (the viewer's own zone, like the browser's picker) ──

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** ISO instant → `YYYY-MM-DDTHH:mm` in the runtime's local zone; '' for null/invalid. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `YYYY-MM-DDTHH:mm` (local) → ISO UTC; null for '' or an invalid value. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── Settings form ────────────────────────────────────────────────────────

/** Numbers are kept as the input's text so a half-typed value is not lost. */
export interface ConfigFormState {
  mode: DraftMode;
  roster_size: string;
  budget: string;
  pick_seconds: string;
  makeup_seconds: string;
  extensions_enabled: boolean;
  /** '' = no limit. */
  redraft_max_lines: string;
  participant_order: string[];
  /** datetime-local; '' = until the first confirmed result. */
  token_purchase_closes_at: string;
}

/** Live default 300 s, slow default 43 200 s (§7.1). */
export function defaultPickSeconds(mode: DraftMode): number {
  return mode === 'slow' ? 43_200 : DEFAULT_DRAFT_CONFIG.pick_seconds;
}

/**
 * The form's starting values from the snapshot. The snapshot carries no
 * `token_purchase_closes_at`, so that field starts empty and is only sent
 * when the admin sets it.
 */
export function configFormFromSnapshot(dto: DraftSnapshotDTO): ConfigFormState {
  const order = [...dto.participants].sort((a, b) => a.seat - b.seat).map((p) => p.player_id);
  return {
    mode: dto.pool.mode,
    roster_size: String(dto.pool.roster_size),
    budget: String(dto.pool.budget),
    pick_seconds: String(dto.config.pick_seconds),
    makeup_seconds: String(dto.config.makeup_seconds),
    // `extension_seconds` is null in slow mode or when extensions are off.
    extensions_enabled: dto.pool.mode === 'slow' ? DEFAULT_DRAFT_CONFIG.extensions_enabled : dto.config.extension_seconds !== null,
    redraft_max_lines: dto.config.redraft_max_lines === null ? '' : String(dto.config.redraft_max_lines),
    participant_order: order,
    token_purchase_closes_at: '',
  };
}

function toInt(text: string): number {
  const trimmed = text.trim();
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

function maxLinesOf(text: string): number | null {
  return text.trim() === '' ? null : toInt(text);
}

/** First invalid field of the form (BE `invalidDraftConfigField`), or null. */
export function invalidConfigField(form: ConfigFormState, ladderSeconds: readonly number[]): keyof DraftConfigCore | null {
  return invalidDraftConfigField({
    mode: form.mode,
    roster_size: toInt(form.roster_size),
    budget: toInt(form.budget),
    pick_seconds: toInt(form.pick_seconds),
    makeup_seconds: toInt(form.makeup_seconds),
    slow_ladder_seconds: [...ladderSeconds],
    redraft_max_lines: maxLinesOf(form.redraft_max_lines),
  });
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * The changed fields only, split by route: an initial pool saves everything
 * through BE #3; a redraft in its submission phase sends `redraft_max_lines`
 * and `participant_order` through BE #21 and the clock settings through #3.
 */
export function configChanges(
  initial: ConfigFormState,
  form: ConfigFormState,
  kind: 'initial' | 'redraft',
): { config: DraftConfigInput; redraft: RedraftPatch } {
  const config: DraftConfigInput = {};
  const redraft: RedraftPatch = {};
  if (form.mode !== initial.mode) config.mode = form.mode;
  if (form.roster_size !== initial.roster_size) config.roster_size = toInt(form.roster_size);
  if (form.budget !== initial.budget) config.budget = toInt(form.budget);
  if (form.pick_seconds !== initial.pick_seconds) config.pick_seconds = toInt(form.pick_seconds);
  if (form.makeup_seconds !== initial.makeup_seconds) config.makeup_seconds = toInt(form.makeup_seconds);
  if (form.extensions_enabled !== initial.extensions_enabled) config.extensions_enabled = form.extensions_enabled;

  const maxChanged = form.redraft_max_lines !== initial.redraft_max_lines;
  const orderChanged = !sameOrder(form.participant_order, initial.participant_order);
  if (kind === 'redraft') {
    const max = maxLinesOf(form.redraft_max_lines);
    if (maxChanged && max !== null) redraft.redraft_max_lines = max;
    else if (maxChanged) config.redraft_max_lines = null;
    if (orderChanged) redraft.participant_order = [...form.participant_order];
  } else {
    if (maxChanged) config.redraft_max_lines = maxLinesOf(form.redraft_max_lines);
    if (orderChanged) config.participant_order = [...form.participant_order];
    if (form.token_purchase_closes_at !== initial.token_purchase_closes_at) {
      config.token_purchase_closes_at = localInputToIso(form.token_purchase_closes_at);
    }
  }
  return { config, redraft };
}

export function hasChanges(changes: { config: DraftConfigInput; redraft: RedraftPatch }): boolean {
  return Object.keys(changes.config).length > 0 || Object.keys(changes.redraft).length > 0;
}

// ── Lines ────────────────────────────────────────────────────────────────

/** Catalog lines nobody owns this season (assign / correct candidates; the server re-checks). */
export function availableLineIds(catalog: DraftLineCatalog, takenBy: Record<LineId, unknown>): LineId[] {
  return catalog.lines.filter((l) => !(l.lineId in takenBy)).map((l) => l.lineId);
}

// ── Audit "change" column ────────────────────────────────────────────────

export const AUDIT_MAX_PAIRS = 4;

export interface AuditChange {
  key: string;
  from: string;
  to: string;
}

/** A logged value as short text (ids and numbers verbatim; arrays comma-separated; '–' for none). */
export function auditValueText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '–';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(auditValueText).join(', ');
  return JSON.stringify(value);
}

/**
 * `key: old → new` pairs of the keys whose value changed (both sides' keys,
 * in first-seen order), at most `max`; `more` counts the rest.
 */
export function auditChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  max = AUDIT_MAX_PAIRS,
): { pairs: AuditChange[]; more: number } {
  const keys: string[] = [];
  for (const key of [...Object.keys(before ?? {}), ...Object.keys(after ?? {})]) {
    if (!keys.includes(key)) keys.push(key);
  }
  const changed: AuditChange[] = [];
  for (const key of keys) {
    const from = auditValueText(before?.[key]);
    const to = auditValueText(after?.[key]);
    if (from !== to) changed.push({ key, from, to });
  }
  return { pairs: changed.slice(0, max), more: Math.max(0, changed.length - max) };
}

// ── Redraft slots for "Restore drop" ─────────────────────────────────────

/** One published redraft slot as the admin needs it for BE #23. */
export interface AdminRedraftSlot {
  redraftSlotId: string;
  playerId: string;
  lineId: LineId;
  label: string;
  filledByPickId: string | null;
}

/**
 * Every published redraft slot, for admins: the snapshot's typed
 * `redraft.admin_slots` (sent to pool admins after publish only). Before the
 * publish, or for a viewer who gets no slot list, this returns null and
 * "Restore drop" / the Redraft-slot chooser wait for the publish.
 */
export function adminRedraftSlots(redraft: DraftSnapshotDTO['redraft']): AdminRedraftSlot[] | null {
  const raw = redraft?.admin_slots;
  if (!Array.isArray(raw)) return null;
  return raw.map((s) => ({
    redraftSlotId: s.redraft_slot_id,
    playerId: s.player_id,
    lineId: s.dropped_line_id,
    label: s.label,
    filledByPickId: s.filled_by_pick_id ?? null,
  }));
}

/**
 * The published slot a drop can be restored through (BE #23 takes its id):
 * the player's slot for that line that no pick has filled yet. null while
 * the slot list is unknown or the slot is already filled.
 */
export function restorableSlotFor(
  slots: readonly AdminRedraftSlot[] | null,
  drop: { player_id: string; line_id: LineId },
): AdminRedraftSlot | null {
  return (
    slots?.find((s) => s.playerId === drop.player_id && s.lineId === drop.line_id && s.filledByPickId === null) ?? null
  );
}

// ── Pool tabs ────────────────────────────────────────────────────────────

export interface PoolTab {
  id: string;
  kind: 'initial' | 'redraft';
  /** 1-based number among the redraft pools of the same league group (0 for an initial pool). */
  redraftNo: number;
  /** League groups: the pool's group name (null in a league without groups). */
  groupName: string | null;
}

/**
 * Tabs in the given order (creation order; a league with groups: by group, then creation): "Initial draft",
 * "Redraft 1", "Redraft 2", … Redrafts are numbered per league group (a league without groups: one sequence).
 * Queue-engine pools only: a legacy (pre-M2) pool gets no tab (the page lists
 * it with links instead; its snapshot raises POOL_ENGINE_LEGACY).
 */
export function poolTabs(
  pools: readonly {
    id: string;
    kind: 'initial' | 'redraft';
    engine?: 'legacy' | 'queue';
    season_group_id?: string | null;
    season_group_name?: string | null;
  }[],
): PoolTab[] {
  const counts = new Map<string, number>();
  return pools
    .filter((p) => p.engine !== 'legacy')
    .map((p) => {
      const key = p.season_group_id ?? '';
      const redraftNo = p.kind === 'redraft' ? (counts.get(key) ?? 0) + 1 : 0;
      if (p.kind === 'redraft') counts.set(key, redraftNo);
      return { id: p.id, kind: p.kind, redraftNo, groupName: p.season_group_name ?? null };
    });
}
