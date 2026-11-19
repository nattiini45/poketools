import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSupabase } from '@/lib/__tests__/helpers/supabase-mock';

const h = vi.hoisted(() => ({ from: vi.fn(), mode: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: h.from } }));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: h.mode }));

import { getApprovedEntityNotes } from '../wiki-entity-notes';
import { GET as moveDetails } from '@/app/api/wiki/moves/[name]/route';
import { GET as itemDetails } from '@/app/api/wiki/items/[name]/route';
import { GET as abilityDetails } from '@/app/api/wiki/abilities/[name]/route';

const legacy = createMockSupabase();
const native = createMockSupabase();
const owners = createMockSupabase();
const phase = '11111111-1111-4111-8111-111111111111';
const tournament = '22222222-2222-4222-8222-222222222222';
const league = '33333333-3333-4333-8333-333333333333';
const when = '2026-11-19T12:00:00.123455+00:00';
const later = '2026-11-19T12:00:00.123456+00:00';
const common = {
  entity_type: 'move', entity_name: 'Tackle', approved: true, content: 'Synthetic note',
  created_at: when, updated_at: when, players: { name: 'Sample Trainer', discord_id: 'private-player' },
  author_id: 'private-author', approved_by: 'private-admin', rejected_by: 'private-admin',
  rejection_reason: 'private-reason', moderation_flags: ['private-flag'],
  rejected_at: null, resubmission_blocked_at: null,
};
const nativeNote = { ...common, id: 'a', phase_id: phase, created_at: later };
const retainedNote = { ...common, id: 'z', scope_type: 'tournament', scope_id: tournament };

beforeEach(() => {
  h.from.mockReset();
  h.mode.mockReset();
  for (const store of [legacy, native, owners]) store.__reset();
  h.from.mockImplementation((table: string) => {
    if (table === 'wiki_notes') return legacy;
    if (table === 'phase_wiki_notes') return native;
    if (table === 'league_phases') return owners;
    throw new Error(`Unexpected read: ${table}`);
  });
  h.mode.mockResolvedValue('phase');
});

describe('approved entity wiki notes after phase cutover', () => {
  it.each(['legacy', 'frozen_legacy'])('keeps the exact legacy note payload and no native reads in %s mode', async mode => {
    h.mode.mockResolvedValue(mode);
    legacy.__setResult([retainedNote]);
    const { notes, cacheable } = await getApprovedEntityNotes('move', 'Tackle');
    expect(cacheable).toBe(true);
    expect(notes).toEqual([{
      id: 'z', entity_type: 'move', entity_name: 'Tackle', content: 'Synthetic note', approved: true,
      scope_type: 'tournament', scope_id: tournament, author_id: 'private-author', author_name: 'Sample Trainer',
      approved_by: 'private-admin', rejected_by: 'private-admin', rejection_reason: 'private-reason',
      moderation_flags: ['private-flag'], rejected_at: null, created_at: when, updated_at: when,
    }]);
    expect(h.from).toHaveBeenCalledExactlyOnceWith('wiki_notes');
    expect(legacy.limit).toHaveBeenCalledWith(500);
  });

  it.each(['phase', 'frozen_phase'])('retains standalone, league and global notes but hides retired copies in %s mode', async mode => {
    h.mode.mockResolvedValue(mode);
    native.__setResult([
      nativeNote,
      { ...nativeNote, id: 'blocked', resubmission_blocked_at: when },
      { ...nativeNote, id: 'rejected', rejected_at: when },
      { ...nativeNote, id: 'not-approved', approved: false },
    ]);
    legacy.__setResult([
      { ...retainedNote, id: 'a', scope_id: phase },
      { ...retainedNote, id: 'retired-without-visible-target', scope_id: phase },
      retainedNote,
      { ...retainedNote, id: 'y', scope_type: 'league', scope_id: league },
      { ...retainedNote, id: 'x', scope_type: 'global', scope_id: null },
    ]);
    owners.__setResult([{ id: phase }]);
    const { notes, cacheable } = await getApprovedEntityNotes('move', 'Tackle');
    expect(cacheable).toBe(false);
    expect(notes.map(note => note.id)).toEqual(['a', 'z', 'y', 'x']);
    expect(notes[0]).toEqual({
      id: 'a', phase_id: phase, entity_type: 'move', entity_name: 'Tackle', content: 'Synthetic note',
      author_name: 'Sample Trainer', created_at: later, updated_at: when,
    });
    expect(notes[1]).toMatchObject({ scope_type: 'tournament', scope_id: tournament, approved: true });
    expect(JSON.stringify(notes)).not.toMatch(/private-|author_id|approved_by|rejected_at|resubmission_blocked/);
    expect(owners.in).toHaveBeenCalledExactlyOnceWith('id', [phase, tournament]);
    expect(native.eq).toHaveBeenCalledWith('entity_type', 'move');
    expect(native.eq).toHaveBeenCalledWith('entity_name', 'Tackle');
    expect(native.eq).toHaveBeenCalledWith('approved', true);
    expect(native.is).toHaveBeenCalledWith('resubmission_blocked_at', null);
    expect(native.limit).toHaveBeenCalledExactlyOnceWith(500);
    expect(legacy.range).toHaveBeenCalledExactlyOnceWith(0, 499);
  });

  it('refills a filtered legacy page and caps the merged newest-first list at 500', async () => {
    native.__setResult([nativeNote]);
    owners.__setResult([{ id: phase }]);
    const oldest = '2026-11-18T12:00:00Z';
    vi.mocked(legacy.range as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, index) => ({ ...retainedNote, id: `retired-${index}`, scope_id: phase })), error: null })
      .mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, index) => ({
        ...retainedNote, id: `legacy-${String(index).padStart(3, '0')}`, created_at: oldest,
      })), error: null });
    const { notes } = await getApprovedEntityNotes('move', 'Tackle');
    expect(notes).toHaveLength(500);
    expect(notes[0]?.id).toBe('a');
    expect(notes.at(-1)?.id).toBe('legacy-001');
    expect(legacy.range).toHaveBeenCalledWith(500, 999);
    expect(notes.some(note => note.id.startsWith('retired'))).toBe(false);
  });

  it('does not fall back to unscoped legacy when mode or native ownership cannot be read', async () => {
    h.mode.mockRejectedValueOnce(new Error('mode unavailable'));
    expect(await getApprovedEntityNotes('move', 'Tackle')).toEqual({ notes: [], cacheable: false });
    expect(h.from).not.toHaveBeenCalled();
    legacy.__setResult([retainedNote]);
    owners.__setError(new Error('ownership unavailable'));
    expect(await getApprovedEntityNotes('move', 'Tackle')).toEqual({ notes: [], cacheable: false });
    expect(legacy.limit).not.toHaveBeenCalled();
  });

  it('can share the mode already selected by a species render', async () => {
    expect(await getApprovedEntityNotes('pokemon', 'Pikachu', 'legacy')).toEqual({ notes: [], cacheable: true });
    expect(h.mode).not.toHaveBeenCalled();
    expect(h.from).toHaveBeenCalledExactlyOnceWith('wiki_notes');
  });

  it.each([
    ['move', 'Tackle', moveDetails],
    ['item', 'Choice Band', itemDetails],
    ['ability', 'Intimidate', abilityDetails],
  ] as const)('serves native notes at the existing anonymous %s URL without edge caching', async (type, name, get) => {
    native.__setResult([{ ...nativeNote, entity_type: type, entity_name: name }]);
    const request = new NextRequest(`http://localhost/api/wiki/${type === 'ability' ? 'abilities' : `${type}s`}/${encodeURIComponent(name)}`);
    const response = await get(request, { params: Promise.resolve({ name }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ success: true, data: {
      [type]: { name }, notes: [{ id: 'a', phase_id: phase, entity_type: type, entity_name: name }],
    } });
  });
});
