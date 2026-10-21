import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { createHttpTokenSource, parseOverviewList, type TokenSource } from '@/components/draft-tokens/token-source';
import type { LineId, TokenOverviewDTO } from '@/types/draft-queue';
import TokenAdminSummary, { loadTokenRows, TokenRowCells, type TokenRow } from '../TokenAdminSummary';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/admin' }));

const SEASON = 'season 1';

function overview(playerId: string, n: number): TokenOverviewDTO {
  return {
    season_id: SEASON,
    player_id: playerId,
    initial_draft_complete: true,
    redraft_complete: false,
    draft_kill: {
      window: 'open',
      cutoff_at: null,
      cost: 3,
      max: 2,
      owned: n % 3,
      unspent_points: 5,
      lines: [],
    },
    comeback: { earned: n + 10, spent: 0, unspent: n, history: [], spend_open: false, earn_window: 'season' },
    cosmo: n % 2 === 0 ? { line_id: 'cosmog--cosmog' as LineId, tokens: n + 100, matchdays_brought: [] } : null,
    lines: [],
  };
}

const PARTICIPANTS = Array.from({ length: 16 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}` }));

function renderRow(row: TokenRow): string {
  return renderWithI18n(
    <table>
      <tbody>
        <tr>
          <TokenRowCells row={row} />
        </tr>
      </tbody>
    </table>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TokenAdminSummary batched load (BE #25b)', () => {
  it('loads 16 participants with exactly one fetch on /tokens, never /tokens/me', async () => {
    // Player p15 has no entry in the batch: it renders the empty state.
    const overviews = PARTICIPANTS.slice(0, 15).map((p, i) => overview(p.id, i));
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, data: { overviews } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const rows = await loadTokenRows(
      createHttpTokenSource(SEASON),
      PARTICIPANTS.map((p) => p.id),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls).toEqual(['/api/seasons/season%201/tokens']);
    expect(urls.some((u) => u.includes('/tokens/me'))).toBe(false);

    PARTICIPANTS.slice(0, 15).forEach((p, i) => {
      const row = rows[p.id];
      expect(row).toEqual({ kind: 'ready', data: overviews[i] });
      const html = renderRow(row);
      expect(html).toContain(`>${i % 3}/2<`);
      expect(html).toContain(`${i} unspent · ${i + 10} earned`);
      expect(html).toContain(i % 2 === 0 ? `>${i + 100}<` : '>–<');
    });
    expect(rows.p15).toEqual({ kind: 'empty' });
    expect(renderRow(rows.p15).match(/>–</g)).toHaveLength(3);
  });

  it('indexes by player_id, not by array order', async () => {
    const source: TokenSource = {
      overview: vi.fn(),
      buyDraftKill: vi.fn(),
      spendComeback: vi.fn(),
      overviewAll: async () => ({ ok: true, data: [overview('p1', 7), overview('p0', 3)] }),
    };
    const rows = await loadTokenRows(source, ['p0', 'p1']);
    expect(rows.p0).toEqual({ kind: 'ready', data: overview('p0', 3) });
    expect(rows.p1).toEqual({ kind: 'ready', data: overview('p1', 7) });
    expect(source.overview).not.toHaveBeenCalled();
  });

  it('shows the existing error state when the batched request fails', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: false, code: 'FORBIDDEN' }), { status: 403 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const rows = await loadTokenRows(
      createHttpTokenSource(SEASON),
      PARTICIPANTS.map((p) => p.id),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const p of PARTICIPANTS) expect(rows[p.id]).toEqual({ kind: 'error' });
    expect(renderRow(rows.p0)).toContain('Could not load');
  });

  it('rejects a malformed batch payload as an error', async () => {
    expect(parseOverviewList({ overviews: [overview('p0', 1)] })).toHaveLength(1);
    expect(parseOverviewList({ overviews: [{ player_id: 'p0' }] })).toBeNull();
    expect(parseOverviewList([overview('p0', 1)])).toBeNull();
  });

  it('falls back to per-player overview for sources without overviewAll', async () => {
    const source: TokenSource = {
      overview: vi.fn(async (id?: string) => ({ ok: true as const, data: overview(id ?? 'x', 1) })),
      buyDraftKill: vi.fn(),
      spendComeback: vi.fn(),
    };
    const rows = await loadTokenRows(source, ['p0', 'p1']);
    expect(source.overview).toHaveBeenCalledTimes(2);
    expect(rows.p1).toEqual({ kind: 'ready', data: overview('p1', 1) });
  });

  it('the component loads through loadTokenRows, not one overview per participant', () => {
    const src = readFileSync(resolve(__dirname, '../TokenAdminSummary.tsx'), 'utf8');
    const component = src.slice(src.indexOf('export default function TokenAdminSummary'));
    expect(component).toMatch(/loadTokenRows\(/);
    expect(component).not.toMatch(/\.overview\(/);
  });

  it('renders the loading state before the batch arrives (no dark slab)', () => {
    const html = renderWithI18n(
      <TokenAdminSummary
        seasonId={SEASON}
        participants={PARTICIPANTS}
        comebackSpendOpen={false}
        hasRedraft
        source={{ overview: vi.fn(), buyDraftKill: vi.fn(), spendComeback: vi.fn(), overviewAll: vi.fn() }}
      />,
    );
    expect(html.match(/Loading balances…/g)).toHaveLength(16);
    expect(html).not.toMatch(/bg-(black|gray-9|slate-9|zinc-9|neutral-9)/);
  });
});
