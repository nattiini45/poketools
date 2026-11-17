import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ auth: vi.fn(), superadmin: vi.fn(), phase: vi.fn(), create: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: h.auth, isSuperadmin: h.superadmin,
  AuthError: class extends Error {},
}));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: h.phase }));
vi.mock('@/lib/supabase/queries/phase-wiki-notes', () => ({ phaseWikiStorage: { createNote: h.create, listNotes: h.list } }));
import { createNativePhaseWikiServices } from '../native-phase-services';

const phase = '20000000-0000-4000-8000-000000000001';
const invalidate = vi.fn(async () => {});
const services = createNativePhaseWikiServices(invalidate);

beforeEach(() => {
  vi.resetAllMocks();
  h.auth.mockResolvedValue({ player: { playerId: 'author', isAdmin: false, isResourceAdmin: true } });
  h.phase.mockResolvedValue({ id: phase }); h.superadmin.mockReturnValue(false);
  h.create.mockResolvedValue({ id: 'note', phase_id: phase }); h.list.mockResolvedValue([]);
});

describe('concrete dormant native wiki bindings', () => {
  it('uses the live ordinary player for authorship and expires the owning phase after writing', async () => {
    const note = { entity_type: 'pokemon' as const, entity_name: 'Pikachu', content: 'A useful synthetic observation.' };
    await services.create(phase, note);
    expect(h.auth).toHaveBeenCalledOnce(); expect(h.phase).toHaveBeenCalledWith(phase);
    expect(h.create).toHaveBeenCalledWith(phase, 'author', note, expect.any(Array));
    expect(invalidate).toHaveBeenCalledExactlyOnceWith(phase);
  });

  it('does not give a phase/resource administrator site-wide wiki moderation', async () => {
    await expect(services.moderationQueue(phase)).rejects.toMatchObject({ code: 'forbidden', statusCode: 403 });
    expect(h.list).not.toHaveBeenCalled();
    h.auth.mockResolvedValue({ player: { playerId: 'moderator', isAdmin: true } });
    await services.moderationQueue(phase);
    expect(h.list).toHaveBeenCalledWith(phase, false);
  });

  it('checks actual public phase existence and propagates failed visibility reads', async () => {
    h.phase.mockResolvedValue(null);
    await expect(services.approved(phase, { type: 'pokemon', name: 'Pikachu' })).rejects.toMatchObject({ code: 'PHASE_NOT_FOUND' });
    const error = new Error('Native phase lookup unavailable'); h.phase.mockRejectedValue(error);
    await expect(services.approved(phase, { type: 'pokemon', name: 'Pikachu' })).rejects.toBe(error);
    expect(h.list).not.toHaveBeenCalled();
  });

  it('fails the live guard before any phase or note read', async () => {
    const error = new Error('Live authorization unavailable'); h.auth.mockRejectedValue(error);
    await expect(services.moderationQueue(phase)).rejects.toBe(error);
    expect(h.phase).not.toHaveBeenCalled(); expect(h.list).not.toHaveBeenCalled();
  });
});
