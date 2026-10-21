/**
 * `GameChangeAlerts` offers the admin data tools only to a site admin (their
 * actions are site-admin APIs); a tournament or league admin gets an
 * "ask a site admin" note instead. Rendered with `renderToStaticMarkup`
 * (vitest 'node' env).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import GameChangeAlerts from '@/components/match/GameChangeAlerts';

const uncounted = { code: 'admin_game_left_uncounted' };
const recheck = [{ code: 'admin_game_evolution_recheck_failed' }];

describe('GameChangeAlerts', () => {
  it('links the data tools for a site admin', () => {
    const html = renderToStaticMarkup(<GameChangeAlerts error={uncounted} isSiteAdmin />);
    expect(html).toContain('href="/admin/data"');
    expect(html).toContain('Open admin data tools');
    expect(html).not.toContain('Ask a site admin');
  });

  it('tells a resource admin to ask a site admin instead of linking the tools', () => {
    const html = renderToStaticMarkup(<GameChangeAlerts error={uncounted} isSiteAdmin={false} />);
    expect(html).not.toContain('/admin/data');
    expect(html).toContain('Ask a site admin');
  });

  it('applies the same rule to a warning of a saved change, in German', () => {
    const html = renderWithI18n(<GameChangeAlerts warnings={recheck} isSiteAdmin={false} />, { locale: 'de' });
    expect(html).not.toContain('/admin/data');
    expect(html).toContain('Bitte einen Seiten-Admin');
  });

  it('offers a reload for a partial match reset', () => {
    const html = renderToStaticMarkup(
      <GameChangeAlerts error={{ code: 'admin_match_reset_partial', params: { count: 2 } }} isSiteAdmin={false} />,
    );
    expect(html).toContain('Reload page');
    expect(html).toContain('2 games were already removed');
  });
});
