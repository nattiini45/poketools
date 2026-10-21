/**
 * RoundManager's expanded round: a failed round-detail fetch used to leave
 * the matches unset, so the panel said "No matches in this round." for a
 * round that has matches. Rendered through react-dom/server (vitest 'node'
 * env, no DOM); the fetch runs against a fake.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fetchRoundMatches, ROUND_MATCHES_LOAD_FAILED, RoundMatchesPanel } from '../RoundManager';
import { renderWithI18n } from '@/test/i18n';
import { toPublicMatch } from '@/lib/match/public-match';
import { fullMatchRow } from '@/lib/match/__tests__/private-match-fields';

const MATCH = toPublicMatch(fullMatchRow({ id: 'm-1', player_1_name: 'Alice', player_2_name: 'Bob' }));

function jsonFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
}

describe('fetchRoundMatches', () => {
  it('returns the matches of a loaded round', async () => {
    const fetchImpl = jsonFetch(200, { success: true, data: { id: 'r-1', matches: [MATCH] } });

    const result = await fetchRoundMatches('t-1', 'r-1', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith('/api/tournaments/t-1/rounds/r-1');
    expect(result).toEqual({ ok: true, matches: [MATCH] });
  });

  it('returns an error response as an error, with its message', async () => {
    const fetchImpl = jsonFetch(404, { success: false, error: 'Round does not belong to this tournament' });

    expect(await fetchRoundMatches('t-1', 'r-1', fetchImpl)).toEqual({
      ok: false,
      error: 'Round does not belong to this tournament',
    });
  });

  it('returns a network failure or a non-JSON body as an error', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const html = vi.fn(async () => new Response('<html>500</html>', { status: 500 })) as unknown as typeof fetch;

    expect(await fetchRoundMatches('t-1', 'r-1', offline)).toEqual({ ok: false, error: 'Failed to load matches' });
    expect(await fetchRoundMatches('t-1', 'r-1', html)).toEqual({ ok: false, error: 'Failed to load matches' });
  });
});

describe('RoundMatchesPanel', () => {
  const render = (props: Partial<Parameters<typeof RoundMatchesPanel>[0]>) =>
    renderToStaticMarkup(
      <RoundMatchesPanel loading={false} error={null} matches={undefined} onRetry={() => {}} {...props} />,
    );

  it('shows a failed load as an error with a retry, not as an empty round', () => {
    const html = render({ error: 'Failed to fetch round' });
    const text = textOf(html);

    expect(html).toContain('role="alert"');
    expect(text).toContain("Could not load this round's matches: Failed to fetch round");
    expect(text).toContain('Retry');
    expect(text).not.toContain('No matches in this round.');
  });

  it('shows an empty round as empty', () => {
    expect(textOf(render({ matches: [] }))).toBe('No matches in this round.');
  });

  it('shows the loading state while fetching', () => {
    expect(textOf(render({ loading: true, error: 'stale' }))).toBe('Loading matches...');
  });

  it('lists the matches, linked to their admin pages', () => {
    const html = render({ matches: [MATCH] });

    expect(textOf(html)).toContain('Alice vs Bob');
    expect(html).toContain('href="/admin/matches/m-1"');
  });
});

describe('RoundMatchesPanel — German viewer', () => {
  const render = (props: Partial<Parameters<typeof RoundMatchesPanel>[0]>) =>
    renderWithI18n(
      <RoundMatchesPanel loading={false} error={null} matches={undefined} onRetry={() => {}} {...props} />,
      { locale: 'de' },
    );

  it('shows the loading, empty and retry states in German', () => {
    expect(textOf(render({ loading: true }))).toBe('Spiele werden geladen …');
    expect(textOf(render({ matches: [] }))).toBe('Keine Spiele in dieser Runde.');
    expect(textOf(render({ error: 'Round does not belong to this tournament' }))).toContain('Erneut versuchen');
  });

  it('translates the failed-request fallback but keeps an uncoded server message', () => {
    const offline = textOf(render({ error: ROUND_MATCHES_LOAD_FAILED }));
    expect(offline).toContain('Die Spiele dieser Runde konnten nicht geladen werden: Die Spiele konnten nicht geladen werden.');
    expect(offline).not.toContain('Failed to load matches');
    expect(textOf(render({ error: 'Round does not belong to this tournament' }))).toContain(
      'Round does not belong to this tournament',
    );
  });

  it('translates a coded server error from the tournaments catalog', () => {
    const text = textOf(render({ error: 'Round not found', errorCode: 'INVALID_ROUND_ID' }));
    expect(text).toContain('Runde nicht gefunden.');
    expect(text).not.toContain('Round not found');
  });

  it('labels the match status chip from the enums', () => {
    const text = textOf(render({ matches: [MATCH] }));
    expect(text).toContain('Alice vs. Bob');
    expect(text).toContain('Beendet');
  });
});

describe('fetchRoundMatches — error codes', () => {
  it('keeps the server code next to the English message', async () => {
    const fetchImpl = jsonFetch(404, { success: false, error: 'Round not found', code: 'INVALID_ROUND_ID' });
    expect(await fetchRoundMatches('t-1', 'r-1', fetchImpl)).toEqual({
      ok: false,
      error: 'Round not found',
      code: 'INVALID_ROUND_ID',
    });
  });
});
