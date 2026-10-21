/**
 * The league groups editor's requests (editor-requests.ts) with a fake fetch: what each button sends, how every
 * answer maps (a refusal keeps its code, no answer is the editor's own failure key) and when the editor re-reads
 * its data (after a rename and after a refusal).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  clearWrite,
  editorLoadUpdate,
  loadEditor,
  runEditorWrite,
  type EditorWriteSink,
  placeWrite,
  reloadAfter,
  renameWrite,
  sendEditorWrite,
  splitWrite,
  type EditorFetch,
} from '../editor-requests';
import type { LeagueGroupsEditorDTO } from '@/types/league-groups-editor';

const SEASON = '5eaf0000-0000-4000-8000-000000000001';
const DTO: LeagueGroupsEditorDTO = {
  groups: [{ id: 'g-a', name: 'Group A', sort_order: 1, player_ids: ['p1', 'p2'], locked: false }],
  participants: [
    { id: 'p1', name: 'Ash', seed: 1 },
    { id: 'p2', name: 'Brock', seed: 2 },
  ],
  replaceLocked: false,
  scheduleLocked: false,
};

function answering(body: unknown) {
  return vi.fn<EditorFetch>(async () => ({ json: async () => body }));
}

describe('what each control sends', () => {
  it('split by seed and remove: PUT on the league groups', () => {
    expect(splitWrite(SEASON, 3)).toEqual({
      url: `/api/seasons/${SEASON}/groups`,
      method: 'PUT',
      body: { mode: 'serpentine', group_count: 3 },
      failKey: 'saveFailed',
    });
    expect(clearWrite(SEASON)).toMatchObject({ method: 'PUT', body: { mode: 'clear' }, failKey: 'saveFailed' });
  });

  it('move / place: PATCH members; rename: PATCH the group (ids encoded)', () => {
    expect(placeWrite(SEASON, 'p1', 'g-b')).toEqual({
      url: `/api/seasons/${SEASON}/groups/members`,
      method: 'PATCH',
      body: { player_id: 'p1', group_id: 'g-b' },
      failKey: 'moveFailed',
    });
    expect(renameWrite(SEASON, 'g/a', 'Nord')).toEqual({
      url: `/api/seasons/${SEASON}/groups/g%2Fa`,
      method: 'PATCH',
      body: { name: 'Nord' },
      failKey: 'renameFailed',
    });
  });

  it('sends JSON with the method and body', async () => {
    const fetchFn = answering({ success: true, data: DTO });
    await sendEditorWrite(fetchFn, splitWrite(SEASON, 2));
    expect(fetchFn).toHaveBeenCalledWith(`/api/seasons/${SEASON}/groups`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'serpentine', group_count: 2 }),
    });
  });
});

describe('answers', () => {
  it('a saved PUT or move applies the fresh DTO; nothing to reload', async () => {
    const outcome = await sendEditorWrite(answering({ success: true, data: DTO }), placeWrite(SEASON, 'p1', 'g-a'));
    expect(outcome).toEqual({ kind: 'saved', data: DTO });
    expect(reloadAfter(outcome)).toBe(false);
  });

  it('a saved rename answers the group only: the editor reloads', async () => {
    const outcome = await sendEditorWrite(
      answering({ success: true, data: { id: 'g-a', name: 'Nord', sort_order: 1 } }),
      renameWrite(SEASON, 'g-a', 'Nord'),
    );
    expect(outcome).toEqual({ kind: 'saved', data: null });
    expect(reloadAfter(outcome)).toBe(true);
  });

  it('a refusal keeps its code and params, and the editor reloads (the lock may be new)', async () => {
    const outcome = await sendEditorWrite(
      answering({ success: false, error: 'This league already has rounds…', code: 'SEASON_GROUPS_SCHEDULED' }),
      splitWrite(SEASON, 2),
    );
    expect(outcome).toEqual({
      kind: 'refused',
      error: { error: 'This league already has rounds…', code: 'SEASON_GROUPS_SCHEDULED' },
    });
    expect(reloadAfter(outcome)).toBe(true);
  });

  it('no answer, or an answer that is no API result, is the write’s own failure key; no reload; the cause is logged', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = new TypeError('Failed to fetch');
    const offline = vi.fn<EditorFetch>(async () => {
      throw cause;
    });
    const failed = await sendEditorWrite(offline, placeWrite(SEASON, 'p1', 'g-a'));
    expect(failed).toEqual({ kind: 'failed', key: 'moveFailed' });
    expect(reloadAfter(failed)).toBe(false);
    expect(await sendEditorWrite(answering('<html>'), clearWrite(SEASON))).toEqual({ kind: 'failed', key: 'saveFailed' });
    const badJson = vi.fn<EditorFetch>(async () => ({
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }));
    expect(await sendEditorWrite(badJson, renameWrite(SEASON, 'g-a', 'X'))).toEqual({ kind: 'failed', key: 'renameFailed' });
    expect(logged).toHaveBeenCalledTimes(3);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('failed'), cause);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('no API result'), '<html>');
    logged.mockRestore();
  });

  it('load: the DTO, a coded refusal, or loadFailed (its cause logged)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await loadEditor(answering({ success: true, data: DTO }), SEASON)).toEqual({ kind: 'loaded', data: DTO });
    expect(await loadEditor(answering({ success: false, error: 'Forbidden', code: 'forbidden' }), SEASON)).toEqual({
      kind: 'refused',
      error: { error: 'Forbidden', code: 'forbidden' },
    });
    expect(await loadEditor(answering({ success: true, data: { groups: 'x' } }), SEASON)).toEqual({
      kind: 'failed',
      key: 'loadFailed',
    });
    const offline = vi.fn<EditorFetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await loadEditor(offline, SEASON)).toEqual({ kind: 'failed', key: 'loadFailed' });
    expect(logged).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('no editor DTO'), { groups: 'x' });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('failed'), expect.any(TypeError));
    logged.mockRestore();
  });
});

/** A sink that records every state change in order (what the component's setters receive). */
function recordingSink() {
  const events: unknown[] = [];
  const sink: EditorWriteSink = {
    begin: () => {
      events.push('begin');
    },
    saved: (data) => {
      events.push(['saved', data]);
    },
    failed: (error) => {
      events.push(['failed', error]);
    },
    reload: async (keepError) => {
      events.push(['reload', { keepError }]);
    },
  };
  return { sink, events };
}

describe('one write as the editor runs it (runEditorWrite; the stateful part, no DOM)', () => {
  it('a saved split applies the fresh DTO and does not reload', async () => {
    const { sink, events } = recordingSink();
    expect(await runEditorWrite(answering({ success: true, data: DTO }), splitWrite(SEASON, 2), sink)).toBe(true);
    expect(events).toEqual(['begin', ['saved', DTO]]);
  });

  it('a saved rename (no DTO in the answer) reloads and clears the shown error', async () => {
    const { sink, events } = recordingSink();
    const ok = await runEditorWrite(
      answering({ success: true, data: { id: 'g-a', name: 'Gold' } }),
      renameWrite(SEASON, 'g-a', 'Gold'),
      sink,
    );
    expect(ok).toBe(true);
    expect(events).toEqual(['begin', ['saved', null], ['reload', { keepError: false }]]);
  });

  it('a refused write shows the refusal, then reloads keeping it (the fresh lock state explains it)', async () => {
    const { sink, events } = recordingSink();
    const refusal = { success: false, error: 'locked', code: 'SEASON_GROUP_LOCKED' };
    const ok = await runEditorWrite(answering(refusal), placeWrite(SEASON, 'p1', 'g-a'), sink);
    expect(ok).toBe(false);
    expect(events).toEqual([
      'begin',
      ['failed', { api: expect.objectContaining({ code: 'SEASON_GROUP_LOCKED' }) }],
      ['reload', { keepError: true }],
    ]);
  });

  it('a write without an answer shows its own failure key and does not reload', async () => {
    const { sink, events } = recordingSink();
    const offline = vi.fn<EditorFetch>(async () => {
      throw new TypeError('offline');
    });
    expect(await runEditorWrite(offline, clearWrite(SEASON), sink)).toBe(false);
    expect(events).toEqual(['begin', ['failed', { key: 'saveFailed' }]]);
  });
});

describe('a load as the editor applies it (editorLoadUpdate)', () => {
  const TWO_GROUPS: LeagueGroupsEditorDTO = {
    ...DTO,
    groups: [...DTO.groups, { id: 'g-b', name: 'Group B', sort_order: 2, player_ids: [], locked: false }],
  };

  it('a fresh DTO replaces the data and clears the error; the split count follows two or more groups', () => {
    expect(editorLoadUpdate({ kind: 'loaded', data: DTO }, false)).toEqual({ data: DTO, error: null });
    expect(editorLoadUpdate({ kind: 'loaded', data: TWO_GROUPS }, false)).toEqual({
      data: TWO_GROUPS,
      error: null,
      groupCount: 2,
    });
  });

  it('the reload after a refusal keeps the refusal: fresh data, error untouched', () => {
    expect(editorLoadUpdate({ kind: 'loaded', data: DTO }, true)).toEqual({ data: DTO });
    expect(editorLoadUpdate({ kind: 'failed', key: 'loadFailed' }, true)).toEqual({});
  });

  it('a failed first load shows its refusal or loadFailed', () => {
    const api = { error: 'nope', code: 'INVALID_SEASON_ID' };
    expect(editorLoadUpdate({ kind: 'refused', error: api }, false)).toEqual({ error: { api } });
    expect(editorLoadUpdate({ kind: 'failed', key: 'loadFailed' }, false)).toEqual({ error: { key: 'loadFailed' } });
  });
});
