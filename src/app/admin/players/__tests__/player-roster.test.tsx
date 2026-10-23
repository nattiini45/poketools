/**
 * `PlayerRoster` renders its first (pre-fetch) state from the `admin-core`
 * namespace: English verbatim, German in a de provider.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import Table, { type Column } from '@/components/ui/Table';
import { PLAYER_SORT_COLUMNS } from '@/lib/players/player-sort';
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

/**
 * The roster hands its sort state to the shared table in server mode
 * (`clientEngine={false}`). `PlayerRoster` itself only renders its table after
 * its fetch (no effects run in a static render), so this renders the shared
 * `Table` in that mode with the orderable column set; that the roster's own
 * sortable column keys belong to `PLAYER_SORT_COLUMNS` is checked at compile
 * time (`key: '…' satisfies PlayerSortColumn` in `PlayerRoster.tsx`).
 */
describe('Table server-side sort (the roster mode)', () => {
  const columns: Column<{ id: string }>[] = [
    ...PLAYER_SORT_COLUMNS.map((key) => ({ key, header: key, sortable: true })),
    { key: 'actions', header: 'actions' },
  ];
  const render = (sort: { key: string; direction: 'asc' | 'desc' } | null) =>
    renderToStaticMarkup(
      <Table columns={columns} data={[]} keyExtractor={(row) => row.id} clientEngine={false} sort={sort} onSort={() => {}} />,
    );

  it('renders a sort button for every orderable column and none for the actions column', () => {
    const html = render(null);

    for (const key of PLAYER_SORT_COLUMNS) {
      expect(html).toContain(`<span>${key}</span>`);
    }
    expect(html.match(/<button/g)).toHaveLength(PLAYER_SORT_COLUMNS.length);
    expect(html.match(/aria-sort="none"/g)).toHaveLength(PLAYER_SORT_COLUMNS.length);
  });

  it('marks the column of the server sort state with its direction', () => {
    const html = render({ key: 'ps_username', direction: 'desc' });

    expect(html.match(/aria-sort="descending"/g)).toHaveLength(1);
    expect(html.match(/aria-sort="none"/g)).toHaveLength(PLAYER_SORT_COLUMNS.length - 1);
  });
});
