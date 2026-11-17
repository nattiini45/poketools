import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutoConfirmHandler, type AutoConfirmMatch, type AutoConfirmStorage } from '../auto-confirm';
import { phaseMatchMachine } from '@/lib/league-phase/phase-match-state';
import { logAuditEvent } from '@/lib/audit/log';

vi.mock('@/lib/match/finalize', () => ({
  finalizeMatchCompletion: vi.fn(() => { throw new Error('Legacy finalize must not run'); }),
  healMatchFinalization: vi.fn(() => { throw new Error('Legacy heal must not run'); }),
  findMatchesNeedingAdmin: vi.fn(() => { throw new Error('Legacy history must not be read'); }),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(() => { throw new Error('Legacy matches must not be read'); }),
  listMatchesReadyForAutoConfirm: vi.fn(() => { throw new Error('Legacy worklist must not be read'); }),
  listMatchesNeedingFinalize: vi.fn(() => { throw new Error('Legacy heal list must not be read'); }),
  updateMatchStatus: vi.fn(() => { throw new Error('Legacy matches must not be written'); }),
}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

type Fixture = AutoConfirmMatch & { phase_id: string };
const row: Fixture = {
  id: 'fixture-match', phase_id: 'fixture-phase', status: 'pending_confirmation', winner_id: 'fixture-winner',
  notes: '', auto_confirm_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  player_1_name: 'Trainer One', player_2_name: 'Trainer Two',
};

function storage(): AutoConfirmStorage<Fixture> {
  return {
    machine: phaseMatchMachine,
    resourceType: 'phase_match',
    auditOwner: (match) => ({ phase_id: match.phase_id }),
    getMatchById: vi.fn(async () => row),
    listMatchesReadyForAutoConfirm: vi.fn(async () => [row]),
    listMatchesNeedingFinalize: vi.fn(async () => []),
    updateMatchStatus: vi.fn(async () => ({})),
    finalizeMatchCompletion: vi.fn(async () => ({ finalized: true, complete: true, failed_steps: [] })),
    healMatchFinalization: vi.fn(async () => ({ healed: true, failed_steps: [] })),
    findMatchesNeedingAdmin: vi.fn(async () => new Map()),
  };
}

function request(authorized = true) {
  return new Request('http://localhost/api/cron/auto-confirm', {
    headers: authorized ? { Authorization: 'Bearer fixture-cron-token' } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'fixture-cron-token');
});
afterEach(() => vi.unstubAllEnvs());

describe('owner-neutral auto-confirm maintenance', () => {
  it('authorizes before either worklist is read', async () => {
    const port = storage();
    expect((await createAutoConfirmHandler(port)(request(false))).status).toBe(401);
    expect(port.listMatchesReadyForAutoConfirm).not.toHaveBeenCalled();
    expect(port.listMatchesNeedingFinalize).not.toHaveBeenCalled();
  });

  it('confirms through the selected store and audits its real owner', async () => {
    const port = storage();
    const response = await createAutoConfirmHandler(port)(request());
    expect(response.status).toBe(200);
    expect(port.updateMatchStatus).toHaveBeenCalledWith('fixture-match', 'completed', 'fixture-winner', undefined,
      'Auto-confirmed after timeout.', 'pending_confirmation');
    expect(port.finalizeMatchCompletion).toHaveBeenCalledWith({
      match: { ...row, status: 'completed' }, winnerId: 'fixture-winner', previousStatus: 'pending_confirmation',
    });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      resource_type: 'phase_match', metadata: expect.objectContaining({ phase_id: 'fixture-phase' }),
    }));
  });

  it('does not finalize a completion that lost its status fence', async () => {
    const port = storage();
    vi.mocked(port.updateMatchStatus).mockResolvedValue(null);
    const response = await createAutoConfirmHandler(port)(request());
    expect((await response.json()).data.skipped_conflict).toBe(1);
    expect(port.finalizeMatchCompletion).not.toHaveBeenCalled();
  });

  it('reports needs-admin rows without spending a heal attempt', async () => {
    const port = storage();
    const completed: Fixture = { ...row, status: 'completed' };
    vi.mocked(port.listMatchesReadyForAutoConfirm).mockResolvedValue([]);
    vi.mocked(port.listMatchesNeedingFinalize).mockResolvedValueOnce([completed]);
    vi.mocked(port.findMatchesNeedingAdmin).mockResolvedValue(new Map([[row.id, 'ratings_missing']]));
    const response = await createAutoConfirmHandler(port)(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data.needsAdmin).toEqual([row.id]);
    expect(port.healMatchFinalization).not.toHaveBeenCalled();
  });
});
