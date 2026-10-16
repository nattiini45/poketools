/**
 * TeamImporter renders /api/import-team failures through the teams and
 * tournaments catalogs, so a 404 `ruleset_not_found` shows in the viewer's
 * language instead of the API's English text.
 */
import { describe, it, expect } from 'vitest';
import { TEAM_IMPORTER_ERROR_CATALOGS } from '../TeamImporter';
import { apiFailure, useTeambuilderErrorText } from '../v3/hooks/useTeambuilderErrorText';
import { renderWithI18n } from '@/test/i18n';

const RULESET_404 = { success: false, error: 'Ruleset not found', code: 'ruleset_not_found' };

function Probe({ body }: { body: unknown }) {
  const errorText = useTeambuilderErrorText(...TEAM_IMPORTER_ERROR_CATALOGS);
  return <p>{errorText(apiFailure(body, 'importFailed'))}</p>;
}

describe('TeamImporter error catalogs', () => {
  it('renders ruleset_not_found in German', () => {
    const html = renderWithI18n(<Probe body={RULESET_404} />, { locale: 'de' });
    expect(html).toContain('Regelwerk nicht gefunden.');
    expect(html).not.toContain('Ruleset not found');
  });

  it('renders ruleset_not_found in English', () => {
    expect(renderWithI18n(<Probe body={RULESET_404} />)).toContain('Ruleset not found');
  });
});
