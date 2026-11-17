import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhaseReportStandings } from '../kale/phase-fact-pack';

const h = vi.hoisted(() => ({ generate: vi.fn(), log: vi.fn() }));
vi.mock('../phase-report-generator', () => ({ generatePhaseReportAsync: h.generate }));
vi.mock('@/lib/logger', () => ({ logger: { error: h.log } }));
import { bindPhaseReportTrigger } from '../phase-trigger';

const standings: PhaseReportStandings = vi.fn(async () => ({ current: [], previous: null, currentByes: [], previousByes: [], scoring: '' }));
const publish = vi.fn(async () => {});
beforeEach(() => { vi.resetAllMocks(); });

describe('native report trigger publication gate', () => {
  it('publishes only the successfully settled new artifact', async () => {
    const record = { id: 'report' }; h.generate.mockResolvedValue({ kind: 'generated', report: record });
    const trigger = bindPhaseReportTrigger(standings, publish);
    expect(trigger('phase', 'round', 'round_recap')).toBeUndefined();
    await vi.waitFor(() => expect(publish).toHaveBeenCalledExactlyOnceWith(record));
    expect(h.generate).toHaveBeenCalledWith('phase', 'round', 'round_recap', standings);
  });

  it.each(['disabled', 'pending', 'superseded', 'cached'])('does not publish %s outcomes', async kind => {
    h.generate.mockResolvedValue({ kind, report: { id: 'existing' } });
    bindPhaseReportTrigger(standings, publish)('phase', 'round', 'round_recap');
    await Promise.resolve(); await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
  });

  it('logs a publication failure with its distinct original cause', async () => {
    const error = new Error('Native cache expiry unavailable'); publish.mockRejectedValueOnce(error);
    h.generate.mockResolvedValue({ kind: 'generated', report: { id: 'report' } });
    bindPhaseReportTrigger(standings, publish)('phase', 'round', 'round_forecast');
    await vi.waitFor(() => expect(h.log).toHaveBeenCalledWith('ai/phase-trigger', 'Phase report trigger failed',
      expect.objectContaining({ error, phaseId: 'phase', roundId: 'round', reportType: 'round_forecast' })));
  });
});
