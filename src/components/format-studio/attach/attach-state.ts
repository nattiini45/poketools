/**
 * Pure helpers of the attach panel: which button state a situation gives, how the candidates are grouped in the
 * picker, and the plain shapes the server page hands to the panel.
 *
 * The two view types mirror `AttachedFormatInfo` and `AttachCandidate` of the server helpers
 * (`readiness-loader.ts`, `attach-candidates.ts`) structurally, so a server value is assignable to them; they are
 * declared here because a client module must not import a `server-only` file, not even for a type.
 */
import type { FormatVisibility } from '@/lib/format-studio/library-types';
import type { AttachPreview } from '@/lib/format-studio/editor/attach-preview';
import type { LText } from '@/lib/studio-core/ltext';

/** What a league stores about its attached format, as shown in the summary (no spec, no seed). */
export interface AttachedFormatView {
  definition_id: string | null;
  version_no: number;
  spec_hash: string;
  frozen_at: string;
  name: LText;
  stageCount: number;
  createdPhases: number;
}

/** One published format the picker offers. Names and ids only: no owner id, no draft. */
export interface AttachCandidateView {
  id: string;
  slug: string;
  name: LText;
  version_no: number;
  content_hash: string;
  visibility: FormatVisibility;
  ownerName: string | null;
  mine: boolean;
}

export type AttachBlockReason =
  | 'started'
  | 'busy'
  | 'nothing_selected'
  | 'loading'
  | 'invalid'
  | 'ruleset_missing'
  | 'manual_phases';

export interface AttachButtonInput {
  /** The league has started: nothing about its format may change. */
  started: boolean;
  /** A format is chosen in the picker. */
  selected: boolean;
  /** The preview of the chosen version; null while it loads or when loading failed. */
  preview: AttachPreview | null;
  /** Phases made by hand: the attach would be refused. */
  manualPhaseCount: number;
  /** An attach or detach request is running. */
  busy: boolean;
}

export interface AttachButtonState {
  enabled: boolean;
  reason: AttachBlockReason | null;
}

/**
 * Whether the Attach button can be pressed, and the first reason why not. The order is the order a person fixes
 * things in: a started league cannot change at all, a running request must finish, then a version must be chosen,
 * loaded and valid, and last come the two league conditions the API refuses too.
 */
export function attachButtonState(input: AttachButtonInput): AttachButtonState {
  const { started, selected, preview, manualPhaseCount, busy } = input;
  const no = (reason: AttachBlockReason): AttachButtonState => ({ enabled: false, reason });
  if (started) return no('started');
  if (busy) return no('busy');
  if (!selected) return no('nothing_selected');
  if (preview === null) return no('loading');
  if (!preview.ok) return no('invalid');
  if (preview.leagueRulesetMissing > 0) return no('ruleset_missing');
  if (manualPhaseCount > 0) return no('manual_phases');
  return { enabled: true, reason: null };
}

export type CandidateGroup = 'mine' | 'league' | 'gallery' | 'others';

/** The picker group of a candidate: yours, shared with league admins, the gallery, or (site admins) another admin's. */
export function candidateGroup(candidate: Pick<AttachCandidateView, 'mine' | 'visibility'>): CandidateGroup {
  if (candidate.mine) return 'mine';
  if (candidate.visibility === 'gallery') return 'gallery';
  if (candidate.visibility === 'league') return 'league';
  return 'others';
}

const GROUP_ORDER: readonly CandidateGroup[] = ['mine', 'league', 'gallery', 'others'];

/** Candidates split into the picker groups, in display order; an empty group is left out. Input order is kept. */
export function groupCandidates<T extends Pick<AttachCandidateView, 'mine' | 'visibility'>>(
  candidates: readonly T[],
): { group: CandidateGroup; items: T[] }[] {
  const buckets = new Map<CandidateGroup, T[]>();
  for (const candidate of candidates) {
    const group = candidateGroup(candidate);
    const bucket = buckets.get(group);
    if (bucket === undefined) buckets.set(group, [candidate]);
    else bucket.push(candidate);
  }
  return GROUP_ORDER.flatMap((group) => {
    const items = buckets.get(group);
    return items === undefined ? [] : [{ group, items }];
  });
}

/** The error codes after which the league page must be read again, because the league itself changed. */
export const REFRESH_AFTER_CODES: ReadonlySet<string> = new Set([
  'format_season_started',
  'format_attach_manual_phases',
  'format_season_not_custom',
]);
