/**
 * The warning a take-back carries when it reverts a result in a format phase whose stage has already ended
 * (`resetMatch`, `reopenMatch`, `deleteGame`, `editGame`): the operation succeeded and nothing is reopened
 * automatically, but the players who advanced to the next phase on the strength of that result stay advanced, so
 * the admin is told which ones. Pure and client-safe; the read behind it is `loadStageEndedWarning`
 * (`src/lib/match/stage-ended.ts`).
 */
import type { ApiErrorLike } from '@/i18n/api-errors';

/** The players one next phase took from the ended phase, in the order they were advanced. */
export interface StageEndedAdvance {
  phase_id: string;
  phase_name: string;
  players: { id: string; name: string }[];
}

export interface StageEndedWarning {
  /** The phase whose stage already ended. */
  phase_id: string;
  phase_name: string;
  /**
   * The phases the ended phase advanced players into (empty when it advanced nobody, e.g. a final stage or an edge still
   * waiting for the admin). `null` when the advancement could not be read (logged): never the same as "nobody advanced".
   */
  advanced: StageEndedAdvance[] | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAdvance(raw: unknown): StageEndedAdvance | null {
  if (!isRecord(raw) || typeof raw.phase_id !== 'string' || typeof raw.phase_name !== 'string') return null;
  if (!Array.isArray(raw.players)) return null;
  const players: StageEndedAdvance['players'] = [];
  for (const player of raw.players) {
    if (!isRecord(player) || typeof player.id !== 'string' || typeof player.name !== 'string') return null;
    players.push({ id: player.id, name: player.name });
  }
  return { phase_id: raw.phase_id, phase_name: raw.phase_name, players };
}

/** The warning of a response's `stage_already_ended` field; null when the field is absent or malformed. */
export function parseStageEndedWarning(raw: unknown): StageEndedWarning | null {
  if (!isRecord(raw) || typeof raw.phase_id !== 'string' || typeof raw.phase_name !== 'string') return null;
  if (raw.advanced === null) return { phase_id: raw.phase_id, phase_name: raw.phase_name, advanced: null };
  if (!Array.isArray(raw.advanced)) return null;
  const advanced: StageEndedAdvance[] = [];
  for (const item of raw.advanced) {
    const parsed = parseAdvance(item);
    if (parsed === null) return null;
    advanced.push(parsed);
  }
  return { phase_id: raw.phase_id, phase_name: raw.phase_name, advanced };
}

/** `Playoffs: Ash, Misty; Finals: Brock`: player and phase names as they are stored, separators neutral. */
function describeAdvanced(advanced: readonly StageEndedAdvance[]): string {
  return advanced
    .filter((entry) => entry.players.length > 0)
    .map((entry) => `${entry.phase_name}: ${entry.players.map((player) => player.name).join(', ')}`)
    .join('; ');
}

/**
 * The flat params of the warning, for a response that is an error and cannot carry the structured field (the reopen's
 * `match_reopen_incomplete`). `stage_advanced` is absent when the advancement could not be read, empty when nobody
 * advanced.
 */
export function stageEndedParams(warning: StageEndedWarning): Record<string, string> {
  return {
    stage_phase: warning.phase_name,
    ...(warning.advanced === null ? {} : { stage_advanced: describeAdvanced(warning.advanced) }),
  };
}

/** The catalogue warning for flat params made by `stageEndedParams`; null when they carry none. */
export function stageEndedApiWarning(params: Readonly<Record<string, string | number>> | null | undefined): ApiErrorLike | null {
  const phase = params?.stage_phase;
  if (typeof phase !== 'string') return null;
  const advanced = params?.stage_advanced;
  if (typeof advanced !== 'string') return { code: 'admin_game_stage_already_ended_unlisted', params: { phase } };
  if (advanced === '') return { code: 'admin_game_stage_already_ended_nobody', params: { phase } };
  return { code: 'admin_game_stage_already_ended', params: { phase, advanced } };
}

/** The catalogue warning of a response's `stage_already_ended` field. */
export function stageEndedWarningToApi(warning: StageEndedWarning): ApiErrorLike {
  return stageEndedApiWarning(stageEndedParams(warning)) as ApiErrorLike;
}
