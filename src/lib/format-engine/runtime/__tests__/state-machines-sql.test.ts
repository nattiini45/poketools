/**
 * The format runtime machines are written by SQL functions (action submissions and windows, challenges, checks,
 * relation reveals). These static checks (no database) read the last CREATE OR REPLACE of each writer from
 * supabase/migrations and hold its guards equal to the TypeScript definitions, so a migration that widens a guard, or a
 * definition that drifts from the SQL, fails here. The behaviour itself is proved by the local-stack suites
 * (format-runtime.local, format-challenges.local).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEASON_FORMAT_ENGINES } from '@/lib/format-studio/library-types';
import { seasonFormatEngineMachine } from '@/lib/format-studio/engine-state';
import type { Machine } from '@/lib/state-machine/machine';
import { actionSubmissionMachine, actionWindowMachine } from '../action-state';
import { formatChallengeMachine } from '../challenge-state';
import { formatCheckMachine } from '../check-state';
import { relationRevealMachine } from '../relation-state';
import { CHALLENGE_STATES, SUBMISSION_STATES } from '../view-types';

const DIR = path.join(process.cwd(), 'supabase', 'migrations');
const FILES = readdirSync(DIR).filter((name) => name.endsWith('.sql')).sort();
const uncommented = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
const SQL = FILES.map((name) => ({ name, text: uncommented(readFileSync(path.join(DIR, name), 'utf8')) }));

/** The body of the last CREATE OR REPLACE of a function across the migrations, and the file it is in. */
function lastDefinition(fn: string): { file: string; body: string } {
  const head = `CREATE OR REPLACE FUNCTION public.${fn}(`;
  for (let i = SQL.length - 1; i >= 0; i -= 1) {
    const start = SQL[i].text.lastIndexOf(head);
    if (start === -1) continue;
    const end = SQL[i].text.indexOf('$$;', SQL[i].text.indexOf('$$', start) + 2);
    return { file: SQL[i].name, body: SQL[i].text.slice(start, end) };
  }
  throw new Error(`no definition of ${fn}`);
}

/** The single-quoted literals of a SQL list (`'a', 'b'`), sorted. */
const literals = (list: string): string[] => [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]).sort();

/** The source states of the transitions a SQL function performs, for one actor, sorted. */
function sourcesBy<S extends string, A extends string>(machine: Machine<S, A>, fn: string, actor: A): S[] {
  const from = machine.spec.transitions
    .filter((t) => t.actors.includes(actor) && t.writers.some((w) => w.endsWith(`#${fn}`)))
    .flatMap((t) => t.from);
  return [...new Set(from)].sort();
}

const sorted = (values: readonly string[]): string[] => [...values].sort();
const checkConstraint = (name: string): string[] => {
  const match = SQL.map((f) => f.text.match(new RegExp(`CONSTRAINT ${name}\\s+CHECK \\((?:status|engine) IN \\(([^)]*)\\)\\)`))).find((m) => m !== null);
  if (!match) throw new Error(`no constraint ${name}`);
  return literals(match[1]);
};

describe('the declared states match the CHECK constraints and the TypeScript unions', () => {
  it.each([
    ['format_action_submissions_status_check', actionSubmissionMachine, SUBMISSION_STATES],
    ['format_challenges_status_check', formatChallengeMachine, CHALLENGE_STATES],
    ['format_checks_status_check', formatCheckMachine, ['open', 'confirmed', 'rejected']],
    ['season_formats_engine_check', seasonFormatEngineMachine, SEASON_FORMAT_ENGINES],
  ] as const)('%s', (constraint, machine, union) => {
    expect(checkConstraint(constraint)).toEqual(sorted(machine.spec.states));
    expect(sorted(union)).toEqual(sorted(machine.spec.states));
  });
});

describe('format_action_submissions.status', () => {
  it('format_action_save updates a draft only: a submitted row raises action_already_submitted, a locked one action_locked', () => {
    const { file, body } = lastDefinition('format_action_save');
    expect(file).toBe('20261109090000_format_action_save_draft_only.sql');
    const upsert = body.match(/DO UPDATE\s+SET ([^;]*?)\s+WHERE s\.status = 'draft'\s+RETURNING \* INTO v_row;/);
    expect(upsert).not.toBeNull();
    // The update never writes a status: a draft stays a draft, and nothing else is updated.
    expect(upsert?.[1]).not.toMatch(/status/);
    const refusal = body.slice(body.indexOf('IF NOT FOUND THEN'));
    expect(refusal).toMatch(/^IF NOT FOUND THEN\s+SELECT s\.status INTO v_status FROM public\.format_action_submissions s[^;]*;\s+IF v_status = 'submitted' THEN\s+RAISE EXCEPTION 'action_already_submitted' USING ERRCODE = 'P0001'[^;]*;\s+END IF;\s+RAISE EXCEPTION 'action_locked' USING ERRCODE = 'P0001'/);
    expect(actionSubmissionMachine.spec.terminal).toEqual(['locked']);
    expect(sourcesBy(actionSubmissionMachine, 'format_action_save', 'player')).toEqual(['draft']);
    expect(actionSubmissionMachine.nextStates('submitted', 'player')).not.toContain('draft');
  });

  it('format_action_submit refuses a locked row for everyone and anything but a draft for the deadline draw', () => {
    const { body } = lastDefinition('format_action_submit');
    expect(body).toMatch(/IF v_row\.status = 'locked' THEN\s+RAISE EXCEPTION 'action_locked'/);
    expect(body).toMatch(/IF p_only_if_unsubmitted AND v_row\.status <> 'draft' THEN\s+RAISE EXCEPTION 'action_already_submitted'/);
    expect(body).toMatch(/status = CASE WHEN p_lock THEN 'locked' ELSE 'submitted' END/);
    expect(sourcesBy(actionSubmissionMachine, 'format_action_submit', 'player')).toEqual(['draft', 'submitted']);
    expect(sourcesBy(actionSubmissionMachine, 'format_action_submit', 'system')).toEqual(['draft']);
    const targets = actionSubmissionMachine.spec.transitions.filter((t) => t.writers.some((w) => w.endsWith('#format_action_submit'))).map((t) => t.to);
    expect([...new Set(targets)].sort()).toEqual(['locked', 'submitted']);
  });

  it('the lock_action op locks submitted rows only', () => {
    const { body } = lastDefinition('format__apply_ops');
    const branch = body.slice(body.indexOf("ELSIF v_kind = 'lock_action' THEN"), body.indexOf('ELSE', body.indexOf("ELSIF v_kind = 'lock_action' THEN") + 10));
    expect(branch).toMatch(/UPDATE public\.format_action_submissions SET status = 'locked'[^;]*AND status = 'submitted';/);
    for (const actor of ['admin', 'system'] as const) {
      expect(sourcesBy(actionSubmissionMachine, 'format__apply_ops', actor)).toEqual(['submitted']);
    }
  });
});

describe('the action window flag', () => {
  it('open_action and lock_action upsert the flag with no guard, so the system may move from every state', () => {
    const { body } = lastDefinition('format__apply_ops');
    for (const [op, value] of [['open_action', 'open'], ['lock_action', 'locked']] as const) {
      const start = body.indexOf(`ELSIF v_kind = '${op}' THEN`);
      const branch = body.slice(start, body.indexOf('ELSIF', start + 10));
      expect(branch).toContain(`'action:' || (v_op ->> 'action'), '"${value}"')`);
      expect(branch).toMatch(/ON CONFLICT \(season_id, key\) DO UPDATE SET value = EXCLUDED\.value, updated_at = now\(\);/);
      expect(sorted(actionWindowMachine.sourcesOf(value, 'system'))).toEqual(sorted(actionWindowMachine.spec.states));
    }
  });

  it('an admin moves the window only to a state it is not in (action_state_unchanged otherwise)', () => {
    for (const to of ['open', 'locked'] as const) {
      expect(actionWindowMachine.sourcesOf(to, 'admin')).not.toContain(to);
      expect(sorted([...actionWindowMachine.sourcesOf(to, 'admin'), to])).toEqual(sorted(actionWindowMachine.spec.states));
    }
  });
});

describe('format_challenges.status', () => {
  it('respond and cancel refuse anything but an open challenge before they write', () => {
    for (const fn of ['format_challenge_respond', 'format_challenge_cancel']) {
      const { body } = lastDefinition(fn);
      const guard = body.indexOf("IF v_row.status <> 'open' THEN");
      expect(guard).toBeGreaterThan(-1);
      expect(body.slice(guard)).toMatch(/^[^;]*RAISE EXCEPTION 'challenge_not_open'/);
      expect(guard).toBeLessThan(body.indexOf('UPDATE public.format_challenges'));
    }
    expect(lastDefinition('format_challenge_cancel').file).toBe('20261108090000_format_notifications.sql');
    expect(sourcesBy(formatChallengeMachine, 'format_challenge_respond', 'defender')).toEqual(['open']);
    expect(sourcesBy(formatChallengeMachine, 'format_challenge_cancel', 'challenger')).toEqual(['open']);
    expect(sourcesBy(formatChallengeMachine, 'format_challenge_cancel', 'admin')).toEqual(['open']);
  });

  it('respond writes accepted, declined, expired and cancelled; cancel writes expired and cancelled', () => {
    const statuses = (fn: string) =>
      [...new Set([...lastDefinition(fn).body.matchAll(/UPDATE public\.format_challenges SET status = '([a-z]+)'/g)].map((m) => m[1]))].sort();
    expect(statuses('format_challenge_respond')).toEqual(['accepted', 'cancelled', 'declined', 'expired']);
    expect(statuses('format_challenge_cancel')).toEqual(['cancelled', 'expired']);
    expect(formatChallengeMachine.nextStates('open', 'defender').sort()).toEqual(['accepted', 'cancelled', 'declined', 'expired']);
    expect(formatChallengeMachine.nextStates('open', 'challenger').sort()).toEqual(['cancelled', 'expired']);
  });

  it('the sweeps of create and the cron expiry touch open challenges only', () => {
    const create = lastDefinition('format_challenge_create').body;
    const sweeps = [...create.matchAll(/UPDATE public\.format_challenges c SET status = '([a-z]+)'[^;]*;/g)];
    expect(sweeps.map((m) => m[1]).sort()).toEqual(['cancelled', 'expired']);
    for (const sweep of sweeps) expect(sweep[0]).toContain("x.status = 'open'");
    const expire = lastDefinition('format_challenges_expire').body;
    expect(expire).toMatch(/UPDATE public\.format_challenges c SET status = 'expired'[^;]*x\.status = 'open'[^;]*;/);
    expect(sourcesBy(formatChallengeMachine, 'format_challenge_create', 'system')).toEqual(['open']);
    expect(sourcesBy(formatChallengeMachine, 'format_challenges_expire', 'system')).toEqual(['open']);
  });

  it('round_delete cancels the accepted challenges of the matches it deletes, and no other', () => {
    const { file, body: del } = lastDefinition('round_delete');
    expect(file).toBe('20261109090000_format_action_save_draft_only.sql');
    const updates = del.match(/UPDATE public\.format_challenges[^;]*;/g) ?? [];
    expect(updates).toHaveLength(1);
    const update = updates[0] ?? '';
    expect(update).toMatch(/^UPDATE public\.format_challenges SET status = 'cancelled'/);
    expect(literals(update.slice(update.indexOf('WHERE')).match(/AND status = ('[^']*')/)?.[1] ?? '')).toEqual(
      sourcesBy(formatChallengeMachine, 'round_delete', 'system'),
    );
    expect(update).toMatch(/WHERE match_id IN \(SELECT m\.id FROM public\.matches m WHERE m\.round_id = p_round_id\) AND status = 'accepted';$/);
    // Every write of match_id in the challenge functions sets status 'accepted' with it, so the guard changes no outcome.
    for (const fn of ['format_challenge_create', 'format_challenge_respond', 'format_challenge_cancel', 'format_challenges_expire']) {
      for (const m of lastDefinition(fn).body.matchAll(/UPDATE public\.format_challenges[^;]*match_id = [^;]*;/g)) {
        expect(m[0]).toContain("status = 'accepted'");
      }
    }
    expect(sourcesBy(formatChallengeMachine, 'round_delete', 'system')).toEqual(['accepted']);
  });
});

describe('format_checks.status', () => {
  it('format_check_resolve moves an open check to a verdict only', () => {
    const { body } = lastDefinition('format_check_resolve');
    expect(literals(body.match(/p_status NOT IN \(([^)]*)\)/)?.[1] ?? '')).toEqual(sorted(formatCheckMachine.spec.terminal));
    expect(body).toMatch(/UPDATE public\.format_checks SET status = p_status[^;]*AND status = 'open';/);
    for (const actor of ['admin', 'system'] as const) expect(sourcesBy(formatCheckMachine, 'format_check_resolve', actor)).toEqual(['open']);
  });

  it('format_check_open inserts with the column default (open) and never updates a status', () => {
    const { body } = lastDefinition('format_check_open');
    expect(body).toMatch(/ON CONFLICT \(season_id, dedupe_key\) DO NOTHING/);
    expect(body).not.toMatch(/UPDATE public\.format_checks/);
    expect(formatCheckMachine.spec.initial).toEqual(['open']);
  });
});

describe('format_relation_links.revealed_at', () => {
  it('the reveal_relation op sets revealed_at only where it is still null', () => {
    const { body } = lastDefinition('format__apply_ops');
    expect(body).toMatch(/UPDATE public\.format_relation_links SET revealed_at = now\(\)\s+WHERE [^;]*AND revealed_at IS NULL;/);
    expect(relationRevealMachine.sourcesOf('revealed')).toEqual(['hidden']);
  });
});

describe('season_formats.engine', () => {
  it('no SQL function after the one-shot backfill switches the engine (the format substitute only bumps the revision)', () => {
    const backfill = FILES.indexOf('20261104100100_season_format_engine_backfill.sql');
    expect(backfill).toBeGreaterThan(-1);
    for (const { text } of SQL.slice(backfill + 1)) {
      for (const m of text.matchAll(/UPDATE public\.season_formats SET ([^;]*)/g)) expect(m[1]).not.toMatch(/\bengine = (?!engine\b)/);
    }
  });
});
