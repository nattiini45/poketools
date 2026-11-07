/**
 * Reads the `subject` of a check (a JSON document the engine built: ids and counts) into the few facts a sentence
 * needs. The subject is data of a stored row, so every member is checked: a row of a newer or unknown shape, or a
 * source this UI has no copy for, becomes `generic` and is shown with the rule label, never with a guess.
 * Pure and client-safe.
 */
import type { TeamAuditCause, TeamAuditReason } from '@/lib/format-engine/runtime/team-audit';
import type { CheckView } from '@/lib/format-engine/runtime/view-types';
import type { Json } from '@/types/database';

type Obj = { [key: string]: Json | undefined };

const isObj = (value: Json | undefined): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: Json | undefined): string | null => (typeof value === 'string' && value !== '' ? value : null);
const num = (value: Json | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const list = (value: Json | undefined): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [];

/** An issue of a team-audit subject: a validation code with its params (rendered through the teambuilder catalog). */
export interface AuditIssue {
  code: string;
  params: Record<string, string | number>;
}

export const TEAM_AUDIT_REASONS = ['rules', 'observed_mismatch', 'no_registered_team', 'audit_unavailable'] as const;
export type TeamAuditReasonCode = (typeof TEAM_AUDIT_REASONS)[number];

export const TEAM_AUDIT_CAUSES = ['ruleset_missing', 'team_rows_duplicate', 'read_failed'] as const;
export type TeamAuditCauseCode = (typeof TEAM_AUDIT_CAUSES)[number];

/**
 * Compile-time two-way ties to the server unions (type-only imports, erased at build, so the file stays client-safe):
 * a reason or cause the server adds without a line here, or one kept here that the server dropped, fails `tsc`
 * instead of silently losing its sentence in `describeCheck`.
 */
type Assert<T extends true> = T;
export type TeamAuditCodesMatchServer = [
  Assert<[Exclude<TeamAuditReason, TeamAuditReasonCode>] extends [never] ? true : false>,
  Assert<[Exclude<TeamAuditReasonCode, TeamAuditReason>] extends [never] ? true : false>,
  Assert<[Exclude<TeamAuditCause, TeamAuditCauseCode>] extends [never] ? true : false>,
  Assert<[Exclude<TeamAuditCauseCode, TeamAuditCause>] extends [never] ? true : false>,
];

export type CheckDescription =
  | { kind: 'unresolved_outcome'; matchId: string; players: string[] }
  | { kind: 'standings_tie'; stage: string | null; players: string[] }
  | { kind: 'pairing_rematch'; stage: string | null; round: number | null; count: number }
  | { kind: 'pairing_forbidden'; stage: string | null; round: number | null; count: number }
  | {
      kind: 'deadline_missed';
      stage: string | null;
      round: number | null;
      matchId: string | null;
      players: string[];
      action: string | null;
      reason: string | null;
      /** The server left the waiting giver out (a hidden relation, the viewer plays): say "a player". */
      giverHidden?: boolean;
    }
  | {
      kind: 'team_audit';
      matchId: string | null;
      round: number | null;
      player: string | null;
      reasons: TeamAuditReasonCode[];
      cause: TeamAuditCauseCode | null;
      issues: AuditIssue[];
      offTeam: string[];
      editedAfterPlay: boolean;
      /**
       * The server left the planned team's details out (`team_hidden`: the viewer is neither its owner nor a site admin).
       * `issues` and `offTeam` are then empty or bare, so the sentence says "hidden" instead of listing nothing.
       */
      teamHidden?: boolean;
    }
  | { kind: 'generic' };

function issuesOf(value: Json | undefined): AuditIssue[] {
  if (!Array.isArray(value)) return [];
  const out: AuditIssue[] = [];
  for (const item of value) {
    if (!isObj(item)) continue;
    const code = text(item.code);
    if (code === null) continue;
    const params: Record<string, string | number> = {};
    if (isObj(item.params)) {
      for (const [name, param] of Object.entries(item.params)) {
        if (typeof param === 'string' || (typeof param === 'number' && Number.isFinite(param))) params[name] = param;
      }
    }
    out.push({ code, params });
  }
  return out;
}

const oneOf = <T extends string>(allowed: readonly T[], value: Json | undefined): T | null =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;

/** What a check says, by source. Anything that does not read as expected is `generic`. */
export function describeCheck(check: Pick<CheckView, 'source' | 'subject'>): CheckDescription {
  const subject = check.subject;
  if (!isObj(subject)) return { kind: 'generic' };
  switch (check.source) {
    case 'unresolved_outcome': {
      const matchId = text(subject.match_id);
      return matchId === null ? { kind: 'generic' } : { kind: 'unresolved_outcome', matchId, players: list(subject.players) };
    }
    case 'standings_tie': {
      const players = list(subject.players);
      return players.length === 0 ? { kind: 'generic' } : { kind: 'standings_tie', stage: text(subject.stage), players };
    }
    case 'pairing_rematch': {
      const count = num(subject.rematches);
      return count === null ? { kind: 'generic' } : { kind: 'pairing_rematch', stage: text(subject.stage), round: num(subject.round), count };
    }
    case 'pairing_forbidden': {
      const count = num(subject.forbidden);
      return count === null ? { kind: 'generic' } : { kind: 'pairing_forbidden', stage: text(subject.stage), round: num(subject.round), count };
    }
    case 'deadline_missed': {
      const playerId = text(subject.player_id);
      const players = playerId === null ? list(subject.players) : [playerId];
      const matchId = text(subject.match_id);
      const action = text(subject.action);
      if (matchId === null && action === null) return { kind: 'generic' };
      return {
        kind: 'deadline_missed',
        stage: text(subject.stage),
        round: num(subject.round),
        matchId,
        players,
        action,
        reason: text(subject.reason),
        ...(subject.giver_masked === true ? { giverHidden: true } : {}),
      };
    }
    case 'team_audit': {
      const reasons = list(subject.reasons).flatMap((reason) => {
        const known = oneOf(TEAM_AUDIT_REASONS, reason);
        return known === null ? [] : [known];
      });
      if (reasons.length === 0) return { kind: 'generic' };
      return {
        kind: 'team_audit',
        matchId: text(subject.match_id),
        round: num(subject.round),
        player: text(subject.player_id),
        reasons,
        cause: oneOf(TEAM_AUDIT_CAUSES, subject.cause),
        issues: issuesOf(subject.issues),
        offTeam: list(subject.off_team),
        editedAfterPlay: subject.edited_after_play === true,
        ...(subject.team_hidden === true ? { teamHidden: true } : {}),
      };
    }
    default:
      return { kind: 'generic' };
  }
}

/** The match a check is about, for the "Open match" link, or null. */
export function matchIdOf(description: CheckDescription): string | null {
  switch (description.kind) {
    case 'unresolved_outcome':
      return description.matchId;
    case 'deadline_missed':
    case 'team_audit':
      return description.matchId;
    default:
      return null;
  }
}
