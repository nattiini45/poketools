import { expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import MatchAnalysisCard from '../MatchAnalysisCard';

const content = {
  summary: '',
  turning_point: '',
  mvp: { pokemon: '', player: '', reasoning: '' },
  game_breakdowns: [],
  meta_observations: '',
  what_if: '',
};

it.each(['pending', 'failed'] as const)('a read-only %s analysis cannot retry through a legacy route', status => {
  const html = renderWithI18n(
    <MatchAnalysisCard analysis={{ status, analysis: content, created_at: '2026-11-01T00:00:00Z' }} isAdmin />,
  );
  expect(html).not.toContain('<button');
});

it('does not offer to generate an analysis without a legacy match ID', () => {
  expect(renderWithI18n(<MatchAnalysisCard analysis={null} />)).toBe('');
  expect(renderWithI18n(<MatchAnalysisCard analysis={null} matchId="legacy-match" />)).toContain('<button');
});
