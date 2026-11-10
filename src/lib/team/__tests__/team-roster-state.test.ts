import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  canWriteTeam,
  resolveTeamWriteVerdict,
  teamLockState,
  teamRosterMachine,
  type TeamClosure,
  type TeamLockState,
  type TeamRosterActor,
  type TeamWriteOp,
} from '../team-roster-state';

const LOCKS: TeamLockState[] = ['open', 'match_completed', 'closed', 'closed_planned', 'locked'];

describe('teamLockState (precedence: manual lock, closure, completed match)', () => {
  it.each([
    [{ locked: true, linkedToMatch: true, closure: 'league_closed', matchCompleted: true }, 'locked'],
    [{ locked: false, linkedToMatch: true, closure: 'tournament_archived', matchCompleted: true }, 'closed'],
    [{ locked: false, linkedToMatch: false, closure: 'tournament_completed', matchCompleted: false }, 'closed_planned'],
    [{ locked: false, linkedToMatch: true, closure: null, matchCompleted: true }, 'match_completed'],
    [{ locked: false, linkedToMatch: true, closure: null, matchCompleted: false }, 'open'],
    [{ locked: false, linkedToMatch: false, closure: null, matchCompleted: false }, 'open'],
  ] as const)('%o is %s', (facts, state) => {
    expect(teamLockState(facts)).toBe(state);
  });
});

describe('teamRosterMachine: who may edit and delete in each lock state', () => {
  // The legal moves pinned by the route characterization tests (src/app/api/teams/[id]/__tests__/route.test.ts),
  // the match-prep route and the query module.
  const table: Record<TeamLockState, Record<TeamWriteOp, TeamRosterActor[]>> = {
    open: { edit: ['owner', 'participant', 'admin'], delete: ['owner', 'admin'] },
    match_completed: { edit: ['admin'], delete: ['admin'] },
    closed: { edit: ['participant', 'admin'], delete: ['admin'] },
    closed_planned: { edit: ['admin'], delete: ['owner', 'admin'] },
    locked: { edit: [], delete: ['admin'] },
  };

  it.each(LOCKS)('%s', (state) => {
    for (const op of ['edit', 'delete'] as const) {
      const allowed = (['owner', 'participant', 'admin'] as const).filter((actor) => canWriteTeam(state, op, actor));
      expect({ op, allowed }).toEqual({ op, allowed: table[state][op] });
    }
  });

  it('a site admin may edit every lock state but the manual lock, and delete every one', () => {
    expect(LOCKS.filter((s) => canWriteTeam(s, 'edit', 'admin'))).toEqual(['open', 'match_completed', 'closed', 'closed_planned']);
    expect(LOCKS.filter((s) => canWriteTeam(s, 'delete', 'admin'))).toEqual(LOCKS);
  });

  it('nothing leaves deleted', () => {
    expect(teamRosterMachine.transitionsFrom('deleted')).toEqual([]);
  });
});

describe('resolveTeamWriteVerdict reads only the facts that can change the answer', () => {
  const run = (input: {
    op: TeamWriteOp;
    actor: TeamRosterActor;
    locked?: boolean;
    linkedToMatch: boolean;
    closure?: TeamClosure | null;
    matchCompleted?: boolean;
  }) => {
    const loadClosure = vi.fn(async () => input.closure ?? null);
    const loadMatchCompleted = vi.fn(async () => input.matchCompleted ?? false);
    const verdict = resolveTeamWriteVerdict({
      op: input.op,
      actor: input.actor,
      locked: input.locked ?? false,
      linkedToMatch: input.linkedToMatch,
      loadClosure,
      loadMatchCompleted,
    });
    return { verdict, loadClosure, loadMatchCompleted };
  };

  it('a manual lock refuses before any read', async () => {
    const { verdict, loadClosure, loadMatchCompleted } = run({ op: 'edit', actor: 'admin', locked: true, linkedToMatch: true });
    expect(await verdict).toEqual({ ok: false, state: 'locked', closure: null });
    expect(loadClosure).not.toHaveBeenCalled();
    expect(loadMatchCompleted).not.toHaveBeenCalled();
  });

  it('an admin edit or delete reads nothing', async () => {
    for (const op of ['edit', 'delete'] as const) {
      const { verdict, loadClosure, loadMatchCompleted } = run({ op, actor: 'admin', linkedToMatch: true, closure: 'league_closed', matchCompleted: true });
      expect(await verdict).toEqual({ ok: true });
      expect(loadClosure).not.toHaveBeenCalled();
      expect(loadMatchCompleted).not.toHaveBeenCalled();
    }
  });

  it("an owner's delete of a team linked to no match reads nothing", async () => {
    const { verdict, loadClosure } = run({ op: 'delete', actor: 'owner', linkedToMatch: false, closure: 'league_closed' });
    expect(await verdict).toEqual({ ok: true });
    expect(loadClosure).not.toHaveBeenCalled();
  });

  it('a closure refuses the owner with its reason, before the match is read', async () => {
    const { verdict, loadMatchCompleted } = run({ op: 'edit', actor: 'owner', linkedToMatch: true, closure: 'tournament_archived', matchCompleted: true });
    expect(await verdict).toEqual({ ok: false, state: 'closed', closure: 'tournament_archived' });
    expect(loadMatchCompleted).not.toHaveBeenCalled();
  });

  it("an owner's edit of a planned team reads the closure but not the match", async () => {
    const { verdict, loadClosure, loadMatchCompleted } = run({ op: 'edit', actor: 'owner', linkedToMatch: false });
    expect(await verdict).toEqual({ ok: true });
    expect(loadClosure).toHaveBeenCalledTimes(1);
    expect(loadMatchCompleted).not.toHaveBeenCalled();
  });

  it('a completed match refuses the owner after both reads', async () => {
    const { verdict, loadClosure, loadMatchCompleted } = run({ op: 'delete', actor: 'owner', linkedToMatch: true, matchCompleted: true });
    expect(await verdict).toEqual({ ok: false, state: 'match_completed', closure: null });
    expect(loadClosure).toHaveBeenCalledTimes(1);
    expect(loadMatchCompleted).toHaveBeenCalledTimes(1);
  });
});

// The SQL side of the machine (no migration in this change): the trigger teams_completed_match_lock refuses every
// roster write of a row linked to a completed match unless it is an admin correction, and the correction functions
// write by id only (the manual lock is the TypeScript writers' job). The last CREATE OR REPLACE of each function wins.
describe('team.roster parity with the SQL writers', () => {
  const dir = path.join(process.cwd(), 'supabase', 'migrations');
  const lastDefinition = (fn: string): string => {
    const head = `CREATE OR REPLACE FUNCTION public.${fn}(`;
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    let body = '';
    for (const file of files) {
      const text = readFileSync(path.join(dir, file), 'utf8')
        .split('\n')
        .map((line) => line.replace(/--.*$/, ''))
        .join('\n');
      const at = text.lastIndexOf(head);
      if (at === -1) continue;
      body = text.slice(at, text.indexOf('END $$;', at));
    }
    expect(body, `${fn} is defined in supabase/migrations`).not.toBe('');
    return body;
  };

  it('teams_completed_match_lock refuses a completed match row unless the write is a correction (admin only in the machine)', () => {
    const body = lastDefinition('teams_completed_match_lock');
    expect(body).toMatch(/IF OLD\.match_id IS NULL THEN\s+RETURN/);
    const correction = body.indexOf("current_setting('poketools.team_correction', true) IS NOT DISTINCT FROM 'on'");
    const refusal = body.search(/IF v_status = 'completed' THEN\s+RAISE EXCEPTION 'TEAM_MATCH_COMPLETED'/);
    expect(correction).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(correction);

    expect(teamRosterMachine.sourcesOf('match_completed', 'owner')).toEqual([]);
    expect(teamRosterMachine.sourcesOf('match_completed', 'participant')).toEqual([]);
    expect(teamRosterMachine.sourcesOf('match_completed', 'admin')).toEqual(['match_completed']);
    expect(teamRosterMachine.sourcesOf('deleted', 'owner')).not.toContain('match_completed');
    expect(teamRosterMachine.sourcesOf('deleted', 'admin')).toContain('match_completed');
  });

  it.each([
    ['team_correct_update', /UPDATE public\.teams\s+SET[^;]*WHERE id = p_team_id;/],
    ['team_correct_delete', /DELETE FROM public\.teams WHERE id = p_team_id;/],
  ])('%s writes by id only and only after setting the correction flag', (fn, write) => {
    const body = lastDefinition(fn);
    expect(body).toMatch(write);
    expect(body.indexOf("set_config('poketools.team_correction', 'on', true)")).toBeLessThan(body.search(write));
    expect(body).not.toMatch(/locked/);
  });

  it('every transition the correction functions write is open to the admin', () => {
    const corrected = teamRosterMachine.spec.transitions.filter((t) => t.writers.some((w) => w.includes('#team_correct_')));
    expect(corrected.length).toBeGreaterThan(0);
    for (const t of corrected) expect(t.actors).toContain('admin');
  });
});
