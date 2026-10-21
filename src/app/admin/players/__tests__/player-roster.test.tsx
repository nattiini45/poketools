/**
 * `PlayerRoster` renders its first (pre-fetch) state from the `admin-core`
 * namespace: English verbatim, German in a de provider.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import PlayerRoster from '../PlayerRoster';

describe('PlayerRoster i18n', () => {
  it('English loading state without a provider', () => {
    expect(renderToStaticMarkup(<PlayerRoster canManageCreators={false} />)).toContain('Loading players...');
  });

  it('German loading state', () => {
    expect(renderWithI18n(<PlayerRoster canManageCreators={false} />, { locale: 'de' })).toContain(
      'Spieler werden geladen …',
    );
  });
});
