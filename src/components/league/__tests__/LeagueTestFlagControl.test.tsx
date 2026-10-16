/**
 * The site-admin test-league checkbox: its label and state as rendered
 * (react-dom/server, vitest 'node' env), and the request it sends.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import LeagueTestFlagControl, { TEST_LEAGUE_LABEL, TestFlagSaveError, saveTestFlag } from '../LeagueTestFlagControl';

describe('LeagueTestFlagControl', () => {
  it('renders the labelled checkbox reflecting the current flag', () => {
    const on = renderToStaticMarkup(<LeagueTestFlagControl seasonId="s1" isTestSeason />);
    const off = renderToStaticMarkup(<LeagueTestFlagControl seasonId="s1" isTestSeason={false} />);

    expect(TEST_LEAGUE_LABEL).toBe('Test league — excluded from public lists and all-time stats');
    expect(on).toContain(TEST_LEAGUE_LABEL);
    expect(on).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(off).not.toMatch(/<input[^>]*checked=""/);
  });

  it('renders the label and hint in German', () => {
    const html = renderWithI18n(<LeagueTestFlagControl seasonId="s1" isTestSeason />, { locale: 'de' });

    expect(html).toContain('Testliga – nicht in öffentlichen Listen und Gesamtstatistiken');
    expect(html).toContain('Die Liga bleibt über ihren eigenen Link erreichbar.');
    expect(html).not.toContain(TEST_LEAGUE_LABEL);
  });
});

describe('saveTestFlag', () => {
  it('PATCHes only is_test_season to the league', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ json: async () => ({ success: true, data: {} }) });

    await saveTestFlag('s1', true, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith('/api/seasons/s1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_test_season: true }),
    });
  });

  it("throws the route's own message (e.g. the site-admin 403)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ success: false, error: 'Only site admins can change the test-league flag' }),
    });

    await expect(saveTestFlag('s1', false, fetchImpl)).rejects.toThrow(
      'Only site admins can change the test-league flag',
    );
  });

  it('keeps the code and params of the failure for the localized inline error', async () => {
    const body = { success: false, error: 'Not authenticated', code: 'unauthenticated' };
    const fetchImpl = vi.fn().mockResolvedValue({ json: async () => body });

    const err = await saveTestFlag('s1', true, fetchImpl).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TestFlagSaveError);
    expect((err as TestFlagSaveError).result).toMatchObject({ error: 'Not authenticated', code: 'unauthenticated' });
  });
});
