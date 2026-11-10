/**
 * The queue-engine draft machines are enforced by SQL (the `draft_*` RPCs under `draft__lock`); their TypeScript
 * definitions (`pool-phase-state.ts`, `slot-state.ts`) are what docs, UI and agents read. This reads the latest
 * definition of every function in `supabase/migrations` and holds the two together: who writes each column, which
 * values, and the guard each writer checks before it moves a row. No database.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MachineSpec } from '@/lib/state-machine/machine';
import {
  DRAFT_PHASE_STATUS,
  draftPoolPauseMachine,
  draftPoolPhaseMachine,
  redraftSubmissionWindowMachine,
} from '../pool-phase-state';
import { draftPoolStatusMachine } from '../pool-status-state';
import { draftSlotMachine, RETIRED_SLOT_STATUSES } from '../slot-state';
import { draftKillTokenWindowMachine } from '../token-window-state';
import { latestFunctionBody, latestFunctionDefinition, latestFunctionRegion, liveFunctionNames } from './sql-function-body';

const MACHINES: MachineSpec<string, string>[] = [
  draftPoolPhaseMachine.spec,
  draftPoolPauseMachine.spec,
  redraftSubmissionWindowMachine.spec,
  draftSlotMachine.spec,
  draftKillTokenWindowMachine.spec,
];

/** `fn` → the migration file each machine names for it. */
function sqlWriters(spec: MachineSpec<string, string>): { fn: string; file: string; to: string; event: string }[] {
  return spec.transitions.flatMap((t) =>
    t.writers
      .filter((w) => w.includes('#'))
      .map((w) => {
        const [file, fn] = w.split('#');
        return { fn, file: path.basename(file), to: t.to, event: t.event };
      }),
  );
}

/** The SET list of every `UPDATE <table> SET ... WHERE|;` in `text`. */
function setLists(text: string, table: string): string[] {
  const re = new RegExp(`UPDATE\\s+(?:public\\.)?${table}\\s+SET\\b([\\s\\S]*?)(?:\\bWHERE\\b|;)`, 'gi');
  return [...text.matchAll(re)].map((m) => m[1]);
}

/** The value `column` is assigned in a SET list: a quoted literal without quotes, `NULL`, another expression, or null when not assigned. */
function assigned(setList: string, column: string): string | null {
  const m = new RegExp(`(?:^|,)\\s*${column}\\s*=\\s*('(\\w+)'|[^,]+)`, 'i').exec(setList);
  if (!m) return null;
  return m[2] ?? m[1].trim();
}

/**
 * The latest text of every live function: its body up to `END $$;`, or for a body that ends otherwise
 * (`LANGUAGE sql`) the region up to the next definition.
 */
const regions = new Map(
  liveFunctionNames(/./).map((fn) => {
    try {
      return [fn, latestFunctionBody(fn)] as const;
    } catch {
      return [fn, latestFunctionRegion(fn).text] as const;
    }
  }),
);

/** Every live function whose latest definition assigns `column` of `table`, with the values it assigns. */
function assignmentsOf(table: string, column: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [fn, text] of regions) {
    const values = setLists(text, table)
      .map((s) => assigned(s, column))
      .filter((v): v is string => v !== null);
    if (values.length > 0) out.set(fn, values);
  }
  return out;
}

/** Live functions (other than `fn` itself) whose latest definition calls `fn(`. */
function callersOf(fn: string): string[] {
  return [...regions.entries()]
    .filter(([name, text]) => name !== fn && new RegExp(`\\b${fn}\\s*\\(`).test(text))
    .map(([name]) => name)
    .sort();
}

const bodies = new Map<string, string>();
const body = (fn: string): string => {
  if (!bodies.has(fn)) bodies.set(fn, latestFunctionBody(fn));
  return bodies.get(fn) as string;
};
const fromOf = (spec: MachineSpec<string, string>, event: string) =>
  [...(spec.transitions.find((t) => t.event === event)?.from ?? [])].sort();

describe('draft machines: every SQL writer is named by the migration that holds its latest definition', () => {
  it.each(MACHINES.flatMap((spec) => sqlWriters(spec).map((w) => [`${spec.id} ${w.event}: ${w.fn}`, w] as const)))(
    '%s',
    (_label, w) => {
      expect(latestFunctionDefinition(w.fn).file).toBe(w.file);
    },
  );
});

describe('draft_pool.phase ↔ SQL', () => {
  const phaseWrites = assignmentsOf('draft_pools', 'phase');

  it('only the machine\'s writers assign draft_pools.phase, and only the targets the machine gives them', () => {
    const expected = new Map<string, Set<string>>();
    for (const w of sqlWriters(draftPoolPhaseMachine.spec)) {
      if (!phaseWrites.has(w.fn)) continue; // a caller (redraft_publish, draft__tick) writes through another writer
      expected.set(w.fn, (expected.get(w.fn) ?? new Set()).add(w.to));
    }
    const actual = new Map([...phaseWrites].map(([fn, values]) => [fn, new Set(values)] as const));
    expect(actual).toEqual(expected);
    expect([...actual.keys()].sort()).toEqual([
      'draft__activate_next',
      'draft_admin_void_pick',
      'draft_end',
      'draft_start',
      'redraft__publish_locked',
    ]);
  });

  it('every phase write sets the status twin DRAFT_PHASE_STATUS gives it', () => {
    expect(Object.keys(DRAFT_PHASE_STATUS).sort()).toEqual([...draftPoolPhaseMachine.spec.states].sort());
    for (const [fn, text] of regions) {
      for (const set of setLists(text, 'draft_pools')) {
        const phase = assigned(set, 'phase');
        const status = assigned(set, 'status');
        if (phase === null && status === null) continue;
        expect({ fn, phase, status }).toEqual({
          fn,
          phase,
          status: DRAFT_PHASE_STATUS[phase as keyof typeof DRAFT_PHASE_STATUS],
        });
      }
    }
  });

  it('the legacy sync trigger maps every legacy status to a phase whose twin is that status', () => {
    const m = /NEW\.phase := CASE NEW\.status WHEN 'pending' THEN '(\w+)' WHEN 'in_progress' THEN '(\w+)' ELSE '(\w+)' END/.exec(
      body('draft_pools_sync_legacy_phase'),
    );
    expect(m).not.toBeNull();
    const phaseOf = { pending: m?.[1], in_progress: m?.[2], complete: m?.[3] } as const;
    for (const status of draftPoolStatusMachine.spec.states) {
      expect(DRAFT_PHASE_STATUS[phaseOf[status] as keyof typeof DRAFT_PHASE_STATUS]).toBe(status);
    }
  });

  it('draft_create_pool inserts an Initial in setup and a Redraft in submissions (the initial states), with their twins', () => {
    const inserts = [...body('draft_create_pool').matchAll(/INSERT INTO public\.draft_pools[\s\S]*?VALUES\s*\(([\s\S]*?)\)\s*RETURNING/g)].map(
      (m) => m[1],
    );
    expect(inserts).toHaveLength(2);
    const pairs = inserts.map((values) => {
      const m = /'(\w+)', 'queue', '(initial|redraft)', v_mode, '(\w+)'/.exec(values);
      expect(m, values).not.toBeNull();
      return { status: m?.[1], kind: m?.[2], phase: m?.[3] };
    });
    expect(pairs).toEqual([
      { status: 'pending', kind: 'initial', phase: 'setup' },
      { status: 'in_progress', kind: 'redraft', phase: 'submissions' },
    ]);
    expect(pairs.map((p) => p.phase).sort()).toEqual([...draftPoolPhaseMachine.spec.initial].sort());
    for (const p of pairs) expect(DRAFT_PHASE_STATUS[p.phase as keyof typeof DRAFT_PHASE_STATUS]).toBe(p.status);
  });

  it('start: draft_start leaves only setup', () => {
    const guards = [...body('draft_start').matchAll(/IF v_pool\.phase <> '(\w+)' THEN RAISE EXCEPTION 'DRAFT_ALREADY_STARTED'/g)];
    expect(guards.map((m) => m[1])).toEqual(fromOf(draftPoolPhaseMachine.spec, 'start'));
  });

  it('publish: redraft__publish_locked leaves only submissions; the admin RPC and the tick reach it only through it', () => {
    const guards = [
      ...body('redraft__publish_locked').matchAll(/p_pool\.phase <> '(\w+)' THEN\s+RAISE EXCEPTION 'SUBMISSIONS_ALREADY_PUBLISHED'/g),
    ];
    expect(guards.map((m) => m[1])).toEqual(fromOf(draftPoolPhaseMachine.spec, 'publish'));
    expect(callersOf('redraft__publish_locked')).toEqual(['draft__tick', 'redraft_publish']);
  });

  it('abort / cancel_submissions: draft_end cancels exactly from the branches the machine lists', () => {
    const text = body('draft_end');
    const branches = [...text.matchAll(/(?:ELS)?IF v_pool\.phase = '(\w+)' THEN([\s\S]*?)(?=ELSIF v_pool\.phase|ELSE\s+RAISE)/g)];
    const cancelling = branches.filter((m) => /SET phase = 'cancelled'/.test(m[2])).map((m) => m[1]);
    expect(cancelling).toEqual(['drafting', 'submissions']);
    expect(fromOf(draftPoolPhaseMachine.spec, 'abort')).toEqual(['drafting']);
    expect(fromOf(draftPoolPhaseMachine.spec, 'cancel_submissions')).toEqual(['submissions']);
    expect(draftPoolPhaseMachine.sourcesOf('cancelled').sort()).toEqual([...cancelling].sort());
    // A running Redraft is not aborted (the abort event is Initial-only).
    expect(branches[0][2]).toMatch(/IF v_pool\.kind <> 'initial' THEN RAISE EXCEPTION 'DRAFT_ABORT_NOT_ALLOWED'/);
  });

  it('reopen: draft_admin_void_pick moves only a complete pool back to drafting, paused', () => {
    const text = body('draft_admin_void_pick');
    const m = /IF v_pool\.phase = '(\w+)' THEN\s+UPDATE public\.draft_pools\s+SET phase = 'drafting'[^;]*paused_at = now\(\)/.exec(text);
    expect(m?.[1]).toBe('complete');
    expect(fromOf(draftPoolPhaseMachine.spec, 'reopen')).toEqual(['complete']);
    // Anything but a paused drafting pool or a complete one is refused before any write.
    expect(text).toMatch(/IF v_pool\.phase = 'drafting' THEN\s+IF v_pool\.paused_at IS NULL THEN RAISE EXCEPTION 'CORRECTION_REQUIRES_PAUSE'/);
    expect(text).toMatch(/ELSIF v_pool\.phase <> 'complete' THEN\s+RAISE EXCEPTION 'DRAFT_NOT_ACTIVE'/);
  });

  it('complete: draft__activate_next runs only for a drafting pool (every caller checks or has just set drafting)', () => {
    expect(fromOf(draftPoolPhaseMachine.spec, 'complete')).toEqual(['drafting']);
    const guards: Record<string, RegExp> = {
      // Through draft_confirm_pick (guarded below) or the void's replacement pick (after the reopen to drafting).
      draft__commit_pick: /./,
      draft__resolve_timeouts: /EXIT WHEN NOT FOUND OR v_pool\.phase <> 'drafting'/,
      // Through draft_set_paused (guarded below).
      draft__resume: /./,
      draft_start: /SET phase = 'drafting'[\s\S]*draft__activate_next\(/,
      redraft__publish_locked: /SET phase = 'drafting'[\s\S]*draft__activate_next\(/,
      redraft_admin_restore_drop: /IF v_pool\.phase <> 'drafting' OR v_pool\.paused_at IS NULL THEN\s+RAISE EXCEPTION 'CORRECTION_REQUIRES_PAUSE'/,
    };
    expect(callersOf('draft__activate_next')).toEqual(Object.keys(guards).sort());
    for (const [fn, guard] of Object.entries(guards)) expect(body(fn), fn).toMatch(guard);

    expect(callersOf('draft__commit_pick')).toEqual(['draft_admin_void_pick', 'draft_confirm_pick']);
    expect(body('draft_confirm_pick')).toMatch(/IF v_pool\.phase <> 'drafting' THEN RAISE EXCEPTION 'DRAFT_NOT_ACTIVE'/);
    const voidText = body('draft_admin_void_pick');
    expect(voidText.indexOf("SET phase = 'drafting'")).toBeLessThan(voidText.indexOf('draft__commit_pick('));
    expect(callersOf('draft__resume')).toEqual(['draft_set_paused']);
    expect(body('draft_set_paused')).toMatch(/IF v_pool\.phase <> 'drafting' THEN RAISE EXCEPTION 'DRAFT_NOT_ACTIVE'/);
  });
});

describe('draft_pool.pause ↔ SQL', () => {
  const pauseWrites = assignmentsOf('draft_pools', 'paused_at');
  /** Clear the columns when a pool enters or leaves drafting; not a move of the pause machine. */
  const ENTRY_EXIT_CLEARS = ['draft_end', 'draft_start', 'redraft__publish_locked'];

  it('only the machine\'s writers pause a pool', () => {
    const pausing = [...pauseWrites].filter(([, v]) => v.some((x) => x.toUpperCase() !== 'NULL')).map(([fn]) => fn).sort();
    const named = sqlWriters(draftPoolPauseMachine.spec).filter((w) => w.to === 'paused').map((w) => w.fn);
    expect(pausing).toEqual([...new Set(named)].sort());
  });

  it('only the machine\'s writers and the entry/exit clears resume a pool', () => {
    const clearing = [...pauseWrites].filter(([, v]) => v.some((x) => x.toUpperCase() === 'NULL')).map(([fn]) => fn).sort();
    const named = new Set(sqlWriters(draftPoolPauseMachine.spec).filter((w) => w.to === 'running').map((w) => w.fn));
    expect(clearing.filter((fn) => !named.has(fn) && !ENTRY_EXIT_CLEARS.includes(fn))).toEqual([]);
    expect(clearing).toEqual(expect.arrayContaining([...ENTRY_EXIT_CLEARS, 'draft__resume', 'draft__activate_next']));
  });

  it('guards: pause needs a running pool, resume a paused one, the recycle bin freezes only running drafting pools', () => {
    expect(fromOf(draftPoolPauseMachine.spec, 'pause')).toEqual(['running']);
    expect(body('draft_set_paused')).toMatch(/IF v_pool\.paused_at IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_PAUSED'/);
    expect(fromOf(draftPoolPauseMachine.spec, 'resume')).toEqual(['paused']);
    expect(body('draft_set_paused')).toMatch(/IF v_pool\.paused_at IS NULL THEN RAISE EXCEPTION 'NOT_PAUSED'[\s\S]*draft__resume\(/);
    expect(fromOf(draftPoolPauseMachine.spec, 'freeze')).toEqual(['running']);
    expect(body('league_trash_delete')).toMatch(/engine = 'queue' AND phase = 'drafting' AND paused_at IS NULL LOOP/);
  });
});

describe('draft_slot.status ↔ SQL', () => {
  const slotWrites = assignmentsOf('draft_slots', 'status');

  it('only the machine\'s writers move a slot, and only to the states the machine gives them', () => {
    const expected = new Map<string, Set<string>>();
    for (const w of sqlWriters(draftSlotMachine.spec)) {
      if (!slotWrites.has(w.fn)) continue; // draft_confirm_pick picks through draft__commit_pick
      expected.set(w.fn, (expected.get(w.fn) ?? new Set()).add(w.to));
    }
    expect(new Map([...slotWrites].map(([fn, v]) => [fn, new Set(v)] as const))).toEqual(expected);
  });

  it('no function writes a retired status, and every insert starts pending', () => {
    for (const values of slotWrites.values()) {
      for (const v of values) expect(RETIRED_SLOT_STATUSES).not.toContain(v);
    }
    for (const [fn, text] of regions) {
      for (const m of text.matchAll(/INSERT INTO public\.draft_slots\s*\(([^)]*)\)([^;]*);/g)) {
        if (!/\bstatus\b/.test(m[1])) continue; // column default 'pending'
        expect({ fn, pending: /'pending'/.test(m[2]) }).toEqual({ fn, pending: true });
        for (const s of [...RETIRED_SLOT_STATUSES, 'active', 'done', 'timed_out']) expect(m[2]).not.toContain(`'${s}'`);
      }
    }
  });

  it('guards: activation takes a pending slot, a timeout and a requeue an active one, a pick the active slot', () => {
    expect(fromOf(draftSlotMachine.spec, 'activate')).toEqual(['pending']);
    expect(body('draft__activate_next')).toMatch(/WHERE draft_pool_id = p_pool_id AND status = 'pending' ORDER BY sort_key LIMIT 1 FOR UPDATE/);
    expect(fromOf(draftSlotMachine.spec, 'time_out')).toEqual(['active']);
    expect(body('draft__resolve_timeouts')).toMatch(/status = 'active' AND deadline_at IS NOT NULL AND deadline_at <= now\(\)/);
    expect(fromOf(draftSlotMachine.spec, 'requeue')).toEqual(['active']);
    expect(body('draft_admin_void_pick')).toMatch(
      /FROM public\.draft_slots WHERE draft_pool_id = p_pool_id AND status = 'active' FOR UPDATE;\s+IF FOUND THEN\s+UPDATE public\.draft_slots\s+SET status = 'pending'/,
    );
    expect(fromOf(draftSlotMachine.spec, 'activate_replacement')).toEqual(['pending']);
    expect(body('draft_admin_void_pick')).toMatch(/'normal', 'pending', v_src\.id\)\s+RETURNING id INTO v_r;/);
    expect(body('draft_admin_void_pick')).toMatch(/SET status = 'active'[^;]*WHERE id = v_r /);
    expect(fromOf(draftSlotMachine.spec, 'pick')).toEqual(['active']);
    expect(body('draft_confirm_pick')).toMatch(/FROM public\.draft_slots WHERE draft_pool_id = p_pool_id AND status = 'active' FOR UPDATE/);
  });
});

describe('redraft.submission_window ↔ SQL', () => {
  it('locks when the deadline is reached: the snapshot and the submission RPC agree on >=', () => {
    expect(body('draft__build_snapshot')).toMatch(
      /p_pool\.submission_deadline_at IS NOT NULL AND now\(\) >= p_pool\.submission_deadline_at\s+THEN 'locked' ELSE 'submissions' END/,
    );
    expect(body('redraft_set_submission')).toMatch(
      /IF v_pool\.phase <> 'submissions' OR v_pool\.submission_deadline_at IS NULL OR v_now >= v_pool\.submission_deadline_at THEN\s+RAISE EXCEPTION 'SUBMISSION_LOCKED'/,
    );
  });

  it('the deadline moves only while the Redraft is in submissions', () => {
    expect(fromOf(redraftSubmissionWindowMachine.spec, 'move_deadline')).toEqual(['locked']);
    expect(body('draft_configure')).toMatch(/IF v_pool\.phase <> 'submissions' THEN RAISE EXCEPTION 'DRAFT_ALREADY_STARTED'/);
  });
});
