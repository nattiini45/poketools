import { afterEach, describe, expect, it, vi } from 'vitest';
import { toDraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import { DAWN, MISTY, snapshot } from '@/lib/draft-ui/__tests__/fixtures';
import { adminCall, auditQueryString, createAdminDraftActions, isStateVersion } from '../admin-actions';
import {
  adminRedraftSlots,
  auditChanges,
  auditValueText,
  availableLineIds,
  configChanges,
  configEditable,
  configFormFromSnapshot,
  correctionsAllowed,
  hasChanges,
  invalidConfigField,
  isoToLocalInput,
  localInputToIso,
  moveItem,
  penaltyStages,
  poolTabs,
  publishAllowed,
  reasonValid,
  restorableSlotFor,
} from '../admin-view';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { LineId } from '@/types/draft-queue';

describe('correctionsAllowed (BR-8)', () => {
  it('is false while the draft runs unpaused', () => {
    expect(correctionsAllowed({ paused: false, status: 'in_progress' })).toBe(false);
    expect(correctionsAllowed({ paused: false, status: 'pending' })).toBe(false);
  });
  it('is true when paused or complete', () => {
    expect(correctionsAllowed({ paused: true, status: 'in_progress' })).toBe(true);
    expect(correctionsAllowed({ paused: false, status: 'complete' })).toBe(true);
  });
});

describe('configEditable', () => {
  it('initial pools only in setup, redrafts only in their submission phase', () => {
    expect(configEditable({ kind: 'initial', phase: 'setup' })).toBe(true);
    expect(configEditable({ kind: 'initial', phase: 'drafting' })).toBe(false);
    expect(configEditable({ kind: 'redraft', phase: 'submissions' })).toBe(true);
    expect(configEditable({ kind: 'redraft', phase: 'drafting' })).toBe(false);
  });
});

describe('penaltyStages', () => {
  it('is bounded by the ladder: 0..len-1', () => {
    expect(penaltyStages([43_200, 21_600, 10_800, 5_400])).toEqual([0, 1, 2, 3]);
    expect(penaltyStages([600])).toEqual([0]);
    expect(penaltyStages([])).toEqual([]);
  });
});

describe('publishAllowed', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  const before = '2026-10-10T12:00:00Z';
  const after = '2026-10-08T12:00:00Z';

  it('is disabled before the deadline without force', () => {
    expect(publishAllowed({ phase: 'submissions', deadlineAt: before, nowMs: now, force: false, reason: '' })).toBe(false);
  });
  it('needs force and a reason before the deadline', () => {
    expect(publishAllowed({ phase: 'submissions', deadlineAt: before, nowMs: now, force: true, reason: 'x' })).toBe(false);
    expect(publishAllowed({ phase: 'submissions', deadlineAt: before, nowMs: now, force: true, reason: 'Cup break' })).toBe(true);
  });
  it('is enabled after the deadline', () => {
    expect(publishAllowed({ phase: 'locked', deadlineAt: after, nowMs: now, force: false, reason: '' })).toBe(true);
  });
  it('is never enabled once published', () => {
    expect(publishAllowed({ phase: 'drafting', deadlineAt: after, nowMs: now, force: true, reason: 'Again please' })).toBe(false);
    expect(publishAllowed({ phase: null, deadlineAt: null, nowMs: now, force: false, reason: '' })).toBe(false);
  });
});

describe('reasonValid', () => {
  it('trims and requires 3..500 characters', () => {
    expect(reasonValid('  ab ')).toBe(false);
    expect(reasonValid('abc')).toBe(true);
    expect(reasonValid('a'.repeat(501))).toBe(false);
  });
});

describe('moveItem', () => {
  it('swaps neighbours and ignores out-of-range moves', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

describe('datetime-local conversion', () => {
  it('round-trips through the local zone', () => {
    const iso = '2026-10-20T18:30:00.000Z';
    expect(localInputToIso(isoToLocalInput(iso))).toBe(iso);
    expect(isoToLocalInput(null)).toBe('');
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('not a date')).toBeNull();
  });
});

describe('settings form', () => {
  const dto = snapshot({ pool: { ...snapshot().pool, phase: 'setup', status: 'pending' } });

  it('prefills from the snapshot in seat order', () => {
    const form = configFormFromSnapshot(dto);
    expect(form).toMatchObject({
      mode: 'live',
      roster_size: '9',
      budget: '180',
      pick_seconds: '300',
      makeup_seconds: '150',
      extensions_enabled: true,
      redraft_max_lines: '3',
      participant_order: [DAWN, MISTY],
      token_purchase_closes_at: '',
    });
  });

  it('sends only the changed fields; an initial pool uses the config route', () => {
    const initial = configFormFromSnapshot(dto);
    expect(hasChanges(configChanges(initial, initial, 'initial'))).toBe(false);
    const changed = configChanges(initial, { ...initial, pick_seconds: '240', participant_order: [MISTY, DAWN] }, 'initial');
    expect(changed).toEqual({ config: { pick_seconds: 240, participant_order: [MISTY, DAWN] }, redraft: {} });
  });

  it('a redraft sends max lines and order through the redraft route', () => {
    const initial = configFormFromSnapshot(dto);
    const changed = configChanges(
      initial,
      { ...initial, redraft_max_lines: '2', participant_order: [MISTY, DAWN], makeup_seconds: '120' },
      'redraft',
    );
    expect(changed).toEqual({
      config: { makeup_seconds: 120 },
      redraft: { redraft_max_lines: 2, participant_order: [MISTY, DAWN] },
    });
  });

  it('a redraft clears max lines through the config route (the redraft route has no null)', () => {
    const initial = { ...configFormFromSnapshot(dto), redraft_max_lines: '3' };
    expect(configChanges(initial, { ...initial, redraft_max_lines: '' }, 'redraft')).toEqual({
      config: { redraft_max_lines: null },
      redraft: {},
    });
  });

  it('mirrors the backend config rules', () => {
    const form = configFormFromSnapshot(dto);
    expect(invalidConfigField(form, [43_200])).toBeNull();
    expect(invalidConfigField({ ...form, pick_seconds: '10' }, [43_200])).toBe('pick_seconds');
    expect(invalidConfigField({ ...form, makeup_seconds: '400' }, [43_200])).toBe('makeup_seconds');
    expect(invalidConfigField({ ...form, roster_size: 'x' }, [43_200])).toBe('roster_size');
    expect(invalidConfigField({ ...form, redraft_max_lines: '12' }, [43_200])).toBe('redraft_max_lines');
    expect(invalidConfigField({ ...form, mode: 'slow', pick_seconds: '300' }, [43_200])).toBe('pick_seconds');
  });

  it('a slow draft takes no make-up time: any value passes, the pick time still counts', () => {
    const slow = { ...configFormFromSnapshot(dto), mode: 'slow' as const, pick_seconds: '43200' };
    expect(invalidConfigField({ ...slow, makeup_seconds: '10' }, [43_200])).toBeNull();
    expect(invalidConfigField({ ...slow, makeup_seconds: '' }, [43_200])).toBeNull();
    expect(invalidConfigField({ ...slow, makeup_seconds: '10', pick_seconds: '300' }, [43_200])).toBe('pick_seconds');
    expect(invalidConfigField({ ...slow, mode: 'live', makeup_seconds: '10' }, [43_200])).toBe('makeup_seconds');
  });

  it('a make-up value edited in live mode is not sent once the form is switched to slow', () => {
    const initial = configFormFromSnapshot(dto);
    for (const makeup of ['10', '', '400000']) {
      const slow = { ...initial, mode: 'slow' as const, pick_seconds: '43200', makeup_seconds: makeup };
      expect(configChanges(initial, slow, 'initial').config).toEqual({ mode: 'slow', pick_seconds: 43_200 });
    }
    // Still sent while the field is visible (live mode).
    expect(configChanges(initial, { ...initial, makeup_seconds: '120' }, 'initial').config).toEqual({ makeup_seconds: 120 });
  });
});

describe('availableLineIds', () => {
  it('lists the catalog lines nobody owns', () => {
    const catalog = {
      listVersionId: 'l',
      bannedMoves: [],
      lines: [{ lineId: 'gastly--gengar' }, { lineId: 'abra--alakazam' }],
    } as unknown as DraftLineCatalog;
    const vm = toDraftViewModel(snapshot());
    expect(availableLineIds(catalog, vm.takenBy)).toEqual(['abra--alakazam']);
  });
});

describe('audit change column', () => {
  it('shows changed keys as pairs, at most 4, then +n', () => {
    const { pairs, more } = auditChanges(
      { a: 1, b: 2, c: 3, d: 4, e: 5, same: 'x' },
      { a: 2, b: 3, c: 4, d: 5, e: 6, same: 'x', f: true },
    );
    expect(pairs).toEqual([
      { key: 'a', from: '1', to: '2' },
      { key: 'b', from: '2', to: '3' },
      { key: 'c', from: '3', to: '4' },
      { key: 'd', from: '4', to: '5' },
    ]);
    expect(more).toBe(2);
  });
  it('handles missing sides and arrays', () => {
    expect(auditChanges(null, { paused: true }).pairs).toEqual([{ key: 'paused', from: '–', to: 'true' }]);
    expect(auditChanges(null, null)).toEqual({ pairs: [], more: 0 });
    expect(auditValueText(['a', 'b'])).toBe('a, b');
  });
});

describe('pool tabs', () => {
  it('numbers the redrafts in creation order', () => {
    expect(
      poolTabs([
        { id: 'i', kind: 'initial' },
        { id: 'r1', kind: 'redraft' },
        { id: 'r2', kind: 'redraft' },
      ]),
    ).toEqual([
      { id: 'i', kind: 'initial', redraftNo: 0, groupName: null },
      { id: 'r1', kind: 'redraft', redraftNo: 1, groupName: null },
      { id: 'r2', kind: 'redraft', redraftNo: 2, groupName: null },
    ]);
  });

  it('numbers the redrafts per league group and carries the group name', () => {
    expect(
      poolTabs([
        { id: 'ia', kind: 'initial', season_group_id: 'ga', season_group_name: 'Group A' },
        { id: 'ra', kind: 'redraft', season_group_id: 'ga', season_group_name: 'Group A' },
        { id: 'ib', kind: 'initial', season_group_id: 'gb', season_group_name: 'Group B' },
        { id: 'rb', kind: 'redraft', season_group_id: 'gb', season_group_name: 'Group B' },
      ]),
    ).toEqual([
      { id: 'ia', kind: 'initial', redraftNo: 0, groupName: 'Group A' },
      { id: 'ra', kind: 'redraft', redraftNo: 1, groupName: 'Group A' },
      { id: 'ib', kind: 'initial', redraftNo: 0, groupName: 'Group B' },
      { id: 'rb', kind: 'redraft', redraftNo: 1, groupName: 'Group B' },
    ]);
  });

  it('gives legacy-engine (pre-M2) pools no tab', () => {
    expect(
      poolTabs([
        { id: 'old', kind: 'initial', engine: 'legacy' },
        { id: 'r1', kind: 'redraft', engine: 'queue' },
      ]),
    ).toEqual([{ id: 'r1', kind: 'redraft', redraftNo: 1, groupName: null }]);
  });
});

describe('adminRedraftSlots', () => {
  it('is null while the snapshot carries no admin slot list', () => {
    expect(adminRedraftSlots(null)).toBeNull();
    expect(
      adminRedraftSlots({ phase: 'drafting', deadline_at: null, published_at: 'x', drops: [], viewer_slots: [] }),
    ).toBeNull();
  });
  it('maps the typed admin_slots list (pool admins, after publish)', () => {
    const redraft = {
      phase: 'drafting' as const,
      deadline_at: null,
      published_at: 'x',
      drops: [],
      viewer_slots: [],
      admin_slots: [
        {
          redraft_slot_id: 'rs1',
          player_id: DAWN,
          dropped_line_id: 'gastly--gengar',
          label: 'A',
          transferred_real_kills: 3,
          filled_by_pick_id: null,
        },
        {
          redraft_slot_id: 'rs2',
          player_id: DAWN,
          dropped_line_id: 'abra--alakazam',
          label: 'B',
          transferred_real_kills: 0,
          filled_by_pick_id: 'pk9',
        },
      ],
    };
    expect(adminRedraftSlots(redraft)).toEqual([
      { redraftSlotId: 'rs1', playerId: DAWN, lineId: 'gastly--gengar', label: 'A', filledByPickId: null },
      { redraftSlotId: 'rs2', playerId: DAWN, lineId: 'abra--alakazam', label: 'B', filledByPickId: 'pk9' },
    ]);
  });
  it('is an empty list (not null) when the published redraft has no slots', () => {
    expect(
      adminRedraftSlots({
        phase: 'drafting',
        deadline_at: null,
        published_at: 'x',
        drops: [],
        viewer_slots: [],
        admin_slots: [],
      }),
    ).toEqual([]);
  });
});

describe('adminCall', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const reply = (status: number, body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
    );

  it('passes on the snapshot a rule error carries', async () => {
    const fresh = snapshot();
    reply(409, { success: false, error: 'x', code: 'NOT_PAUSED', snapshot: fresh });
    const res = await adminCall('/api/x', 'POST', {}, isStateVersion);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('NOT_PAUSED');
      expect(res.snapshot?.state_version).toBe(fresh.state_version);
    }
  });
  it('ignores a malformed snapshot and has none on a plain error', async () => {
    reply(409, { success: false, code: 'NOT_PAUSED', snapshot: { state_version: 'nope' } });
    const bad = await adminCall('/api/x', 'POST', {}, isStateVersion);
    expect(!bad.ok && bad.snapshot).toBeFalsy();
    reply(500, { success: false, code: 'unknown_error' });
    const plain = await adminCall('/api/x', 'POST', {}, isStateVersion);
    expect(!plain.ok && 'snapshot' in plain).toBe(false);
  });
});

describe('createAdminDraftActions: Restore drop and void requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const capture = () => {
    const spy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ success: true, data: { state_version: 8 } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', spy);
    return spy;
  };

  it('restoreDrop posts BE #23 with the redraft slot id in the path', async () => {
    const spy = capture();
    const res = await createAdminDraftActions('pool-r', 'season-1').restoreDrop('rs-1', 'wrong drop');
    expect(res.ok).toBe(true);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('/api/drafts/pool-r/redraft/slots/rs-1/restore');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ reason: 'wrong drop' });
  });

  it('voidPick always requeues (BE #11 has no forfeit)', async () => {
    const spy = capture();
    const res = await createAdminDraftActions('pool-r', 'season-1').voidPick('pick-9', 'misclick');
    expect(res.ok).toBe(true);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('/api/drafts/pool-r/picks/pick-9/void');
    expect(JSON.parse(String(init?.body))).toEqual({ reason: 'misclick', requeue: true });
  });

  it('has no blocked-slot resolve call any more', () => {
    expect('resolveSlot' in createAdminDraftActions('pool-r', 'season-1')).toBe(false);
  });
});

describe('auditQueryString', () => {
  it('repeats action and keeps the cursor', () => {
    const q = new URLSearchParams(
      auditQueryString({ actions: ['paused', 'resumed'], player: DAWN, cursor: '42', limit: 50 }),
    );
    expect(q.getAll('action')).toEqual(['paused', 'resumed']);
    expect(q.get('player')).toBe(DAWN);
    expect(q.get('cursor')).toBe('42');
    expect(q.get('limit')).toBe('50');
  });
});

describe('restorableSlotFor (Restore drop -> BE #23 slot id)', () => {
  const slots = [
    { redraftSlotId: 'rs1', playerId: DAWN, lineId: 'gastly--gengar' as LineId, label: 'A', filledByPickId: null },
    { redraftSlotId: 'rs2', playerId: DAWN, lineId: 'abra--alakazam' as LineId, label: 'B', filledByPickId: 'pk1' },
  ];
  it('finds the open slot of the dropped line', () => {
    expect(restorableSlotFor(slots, { player_id: DAWN, line_id: 'gastly--gengar' })?.redraftSlotId).toBe('rs1');
  });
  it('is null for a filled slot, another player, or an unknown slot list', () => {
    expect(restorableSlotFor(slots, { player_id: DAWN, line_id: 'abra--alakazam' })).toBeNull();
    expect(restorableSlotFor(slots, { player_id: 'other', line_id: 'gastly--gengar' })).toBeNull();
    expect(restorableSlotFor(null, { player_id: DAWN, line_id: 'gastly--gengar' })).toBeNull();
  });
});
