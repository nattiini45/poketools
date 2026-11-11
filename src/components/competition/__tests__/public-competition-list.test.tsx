import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PublicCompetitionList, {
  parseCompetitionStatusFilter,
  type CompetitionListItem,
  type CompetitionStatusFilter,
} from '@/components/competition/PublicCompetitionList';

const item = (id: string, status: CompetitionListItem['status']): CompetitionListItem => ({
  id,
  href: `/leagues/${id}`,
  name: `League ${id}`,
  status,
  statusLabel: status,
  meta: ['Singles', 'Gen 9 OU'],
  stats: ['4 players'],
});

const render = (filter: CompetitionStatusFilter, items: CompetitionListItem[]) =>
  renderToStaticMarkup(
    <PublicCompetitionList
      items={items}
      icon="poke-ball"
      basePath="/leagues"
      filter={filter}
      filterLabel="Filter by status"
      filterLabels={{ all: 'All', active: 'Active', upcoming: 'Upcoming', completed: 'Finished' }}
      emptyText="No leagues yet."
      emptyFilteredText="No leagues with this status."
      showAllLabel="Show all leagues"
    />,
  );

describe('parseCompetitionStatusFilter', () => {
  it('accepts the three statuses and falls back to all', () => {
    expect(parseCompetitionStatusFilter('active')).toBe('active');
    expect(parseCompetitionStatusFilter('upcoming')).toBe('upcoming');
    expect(parseCompetitionStatusFilter('completed')).toBe('completed');
    expect(parseCompetitionStatusFilter(['completed', 'active'])).toBe('completed');
    expect(parseCompetitionStatusFilter(undefined)).toBe('all');
    expect(parseCompetitionStatusFilter('archived')).toBe('all');
  });
});

describe('PublicCompetitionList', () => {
  const items = [item('a', 'active'), item('b', 'active'), item('c', 'upcoming')];

  it('shows only the selected status and marks its tab as current', () => {
    const html = render('upcoming', items);
    expect(html).toContain('League c');
    expect(html).not.toContain('League a');
    expect(html).toMatch(/<a[^>]*href="\/leagues\?status=upcoming"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/leagues\?status=upcoming"/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('links the All tab to the bare path and counts every status', () => {
    const html = render('all', items);
    expect(html).toContain('href="/leagues"');
    for (const name of ['League a', 'League b', 'League c']) expect(html).toContain(name);
    expect(html).toMatch(/Active<span[^>]*>2<\/span>/);
    expect(html).toMatch(/Finished<span[^>]*>0<\/span>/);
  });

  it('an empty status keeps the tabs and offers the way back to the whole list', () => {
    const html = render('completed', items);
    expect(html).toContain('No leagues with this status.');
    expect(html).toContain('Show all leagues');
    expect(html).toContain('aria-label="Filter by status"');
  });

  it('a list with no competition at all shows the plain empty sentence without tabs', () => {
    const html = render('all', []);
    expect(html).toContain('No leagues yet.');
    expect(html).not.toContain('Filter by status');
  });
});
