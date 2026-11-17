import { beforeEach, describe, expect, it, vi } from 'vitest';

const q = vi.hoisted(() => ({
  requireCreator: vi.fn(), getPhaseCastSessionById: vi.fn(), listPhaseCastSessions: vi.fn(),
  createPhaseCastSession: vi.fn(), updatePhaseCastSession: vi.fn(), deletePhaseCastSession: vi.fn(), clearPhaseCastSessionsMatchPointer: vi.fn(),
  loadPhaseCastMatch: vi.fn(),
}));
vi.mock('@/lib/auth/helpers', () => q);
vi.mock('@/lib/supabase/queries/phase-cast-sessions', () => q);
vi.mock('../phase-populate', () => q);

import { createPhaseCastServices } from '../phase-session-services';
import { SOLO_PLAYER2_DEFAULT_NAME } from '../solo-defaults';

const ID = '00000000-0000-4000-8000-000000000001';
const PHASE = '00000000-0000-4000-8000-000000000002';
const actor = { playerId: 'owner', name: 'Fixture caster', avatarUrl: null, isAdmin: false, isResourceAdmin: false };
const session = { id: ID, owner_id: 'owner', phase_id: PHASE, status: 'draft' };

beforeEach(() => {
  vi.resetAllMocks();
  q.requireCreator.mockResolvedValue(actor);
  q.getPhaseCastSessionById.mockResolvedValue(session);
  q.createPhaseCastSession.mockResolvedValue(session);
  q.updatePhaseCastSession.mockResolvedValue(session);
  q.deletePhaseCastSession.mockResolvedValue(true);
});

describe('native cast service authority', () => {
  it('requires a live creator before any session read', async () => {
    q.requireCreator.mockRejectedValue(new Error('Creator required'));
    await expect(createPhaseCastServices().get(ID)).rejects.toThrow('Creator required');
    expect(q.getPhaseCastSessionById).not.toHaveBeenCalled();
  });

  it('rejects malformed ids without a storage lookup', async () => {
    await expect(createPhaseCastServices().get('bad')).rejects.toMatchObject({ code: 'INVALID_SESSION_ID' });
    expect(q.getPhaseCastSessionById).not.toHaveBeenCalled();
  });

  it('does not give a phase or league organizer another creator’s private session', async () => {
    q.requireCreator.mockResolvedValue({ ...actor, playerId: 'organizer', isResourceAdmin: true });
    await expect(createPhaseCastServices().get(ID)).rejects.toMatchObject({ code: 'cast_session_forbidden', statusCode: 403 });
    await expect(createPhaseCastServices().update(ID, { name: 'Changed' })).rejects.toMatchObject({ code: 'cast_session_forbidden' });
    expect(q.updatePhaseCastSession).not.toHaveBeenCalled();
    await expect(createPhaseCastServices().populate(ID, PHASE)).rejects.toMatchObject({ code: 'cast_session_forbidden' });
    expect(q.loadPhaseCastMatch).not.toHaveBeenCalled();
  });

  it('allows the owner and site-admin correction with distinct actors', async () => {
    const services = createPhaseCastServices();
    await services.update(ID, { status: 'live' });
    expect(q.updatePhaseCastSession).toHaveBeenCalledWith(session, { status: 'live' }, 'owner');
    q.requireCreator.mockResolvedValue({ ...actor, playerId: 'admin', isAdmin: true });
    await services.update(ID, { status: 'live' });
    expect(q.updatePhaseCastSession).toHaveBeenCalledWith(session, { status: 'live' }, 'admin');
  });

  it('distinguishes missing sessions from lost edit/delete fences', async () => {
    const services = createPhaseCastServices();
    q.getPhaseCastSessionById.mockResolvedValue(null);
    await expect(services.get(ID)).rejects.toMatchObject({ code: 'cast_session_not_found', statusCode: 404 });
    q.getPhaseCastSessionById.mockResolvedValue(session);
    q.updatePhaseCastSession.mockResolvedValue(null);
    q.deletePhaseCastSession.mockResolvedValue(false);
    await expect(services.update(ID, { name: 'Changed' })).rejects.toMatchObject({ code: 'cast_session_changed', statusCode: 409 });
    await expect(services.delete(ID)).rejects.toMatchObject({ code: 'cast_session_changed', statusCode: 409 });
  });

  it('preserves live-owner solo defaults without granting a different owner id', async () => {
    await createPhaseCastServices().create({ phase_id: PHASE, mode: 'solo' });
    expect(q.createPhaseCastSession).toHaveBeenCalledWith('owner', expect.objectContaining({
      phase_id: PHASE, mode: 'solo', player1_id: 'owner', player1_name: actor.name,
      player2_id: null, player2_name: SOLO_PLAYER2_DEFAULT_NAME,
    }));
  });
});
