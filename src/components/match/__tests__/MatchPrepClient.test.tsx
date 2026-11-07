/** @vitest-environment jsdom */
/**
 * MatchPrepClient: the plan-mode editor is given the match's tournament and season as well as the match, so its live
 * check can resolve the round of the match and its validation panel can show the season's pools.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const editor = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));

vi.mock('@/i18n/client', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    useDataLocale: () => 'en',
    useT: (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en'),
  };
});
vi.mock('next/link', () => ({ default: () => null }));
vi.mock('@/components/match/ScoutingReportCard', () => ({ default: () => null }));
vi.mock('@/components/teambuilder/v3/editor/TeamsEditor', () => ({
  default: (props: Record<string, unknown>) => {
    editor.props = props;
    return null;
  },
}));

import MatchPrepClient from '../MatchPrepClient';

const MATCH = '00000000-0000-4000-8000-000000000004';
const TOURNAMENT = '00000000-0000-4000-8000-000000000003';
const SEASON = '00000000-0000-4000-8000-000000000002';

describe('MatchPrepClient', () => {
  it('mounts the plan editor with the match, its tournament and its season', () => {
    render(
      <MatchPrepClient
        matchId={MATCH}
        tournamentId={TOURNAMENT}
        seasonId={SEASON}
        rulesetId="ruleset-1"
        opponentName="Gary"
      />,
    );

    expect(editor.props).toMatchObject({
      mode: 'plan',
      matchId: MATCH,
      tournamentId: TOURNAMENT,
      seasonId: SEASON,
      rulesetId: 'ruleset-1',
    });
  });
});
