import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhaseMatchServiceEffects } from '../match-services';
import { giftDef, stateFor } from '@/lib/format-engine/runtime/__tests__/helpers';

const h = vi.hoisted(() => ({ matches: vi.fn<(effects: PhaseMatchServiceEffects) => object>(), enrollment: vi.fn(),
  enroll: vi.fn(), canAdminister: vi.fn(), release: vi.fn(), teams: vi.fn(), wiki: vi.fn(), auditFactory: vi.fn(),
  audit: vi.fn(), report: vi.fn(), standings: vi.fn(), completion: vi.fn(), dispute: vi.fn(), stage: vi.fn(), publisher: vi.fn(), publish: vi.fn() }));
vi.mock('@/lib/auth/phase-access', () => ({ canAdministerPhaseAccess: h.canAdminister }));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({ releasePhaseTeamsFromMatches: h.release }));
vi.mock('@/lib/team/phase-services', () => ({ createPhaseTeamServices: h.teams }));
vi.mock('@/lib/wiki/native-phase-services', () => ({ createNativePhaseWikiServices: h.wiki }));
vi.mock('@/lib/ai/phase-trigger', () => ({ bindPhaseReportTrigger: h.report }));
vi.mock('../match-services', () => ({ createPhaseMatchServices: h.matches }));
vi.mock('../enrollment-services', () => ({ createNativePhaseEnrollment: h.enrollment }));
vi.mock('../team-audit', () => ({ createNativePhaseTeamAudit: h.auditFactory }));
vi.mock('../report-standings', () => ({ loadPhaseReportStandings: h.standings }));
vi.mock('../report-publication', () => ({ createPhaseReportPublisher: h.publisher }));
vi.mock('../announcements', () => ({ announcePhaseMatchCompletion: h.completion,
  announcePhaseMatchDispute: h.dispute, announceNativeKitStageCompletion: h.stage }));

import { createNativePhaseServices } from '../services';

const invalidation = { invalidateMatch: vi.fn(async () => {}), invalidateSeason: vi.fn(), invalidateWiki: vi.fn(async () => {}) };
beforeEach(() => {
  vi.resetAllMocks(); h.enrollment.mockReturnValue({ enroll: h.enroll });
  h.matches.mockReturnValue({ native: true }); h.auditFactory.mockReturnValue(h.audit);
  h.release.mockResolvedValue(2);
  h.publisher.mockReturnValue(h.publish);
});

describe('dormant concrete phase service assembly', () => {
  it('binds actual native ancillary services while leaving cache activation explicit', async () => {
    createNativePhaseServices(invalidation);
    const effects = h.matches.mock.calls[0][0];
    expect(await effects.releaseTeams('match')).toBe(2);
    expect(h.release).toHaveBeenCalledExactlyOnceWith(['match']);
    expect(effects.announcements).toBe(h.completion); expect(effects.announceDispute).toBe(h.dispute);
    expect(effects.kit.enroll).toBe(h.enroll); expect(effects.kit.stageCompleted).toBe(h.stage);
    expect(h.report).toHaveBeenCalledExactlyOnceWith(h.standings, h.publish);
    await effects.revalidate('phase', 'match');
    expect(invalidation.invalidateMatch).toHaveBeenCalledWith('phase', 'match');
    expect(h.canAdminister).not.toHaveBeenCalled(); expect(h.audit).not.toHaveBeenCalled();
  });

  it('preserves the cron audit retry policy and expires the native phase owning new checks', async () => {
    createNativePhaseServices(invalidation);
    const effects = h.matches.mock.calls[0][0];
    const def = giftDef();
    const context = { seasonId: 'league', seed: 'synthetic', revision: 1, def, state: stateFor(def), phases: [], tunableIssues: [] };
    const input = { phase: { id: 'phase', season_id: 'league' }, matchId: 'match', roundId: 'round',
      player1Id: 'one', player2Id: 'two', winnerId: 'one', auditRetry: 'never' as const };
    await effects.kit.auditMatchTeams(input, 3, context);
    expect(h.audit).toHaveBeenCalledExactlyOnceWith({ ...input, generation: 3, context, retry: 'never' });
    const invalidate = h.auditFactory.mock.calls[0][0]; invalidate('league');
    expect(invalidation.invalidateSeason).toHaveBeenCalledExactlyOnceWith('league', ['phase']);
  });
});
