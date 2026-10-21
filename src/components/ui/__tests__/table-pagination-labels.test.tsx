/**
 * Table's pagination chrome in another language: the range line, the page
 * size picker and the page buttons' accessible names come from `labels`,
 * with the English every table has always shown as the default.
 *
 * Rendered through react-dom/server (vitest 'node' env); `next/link` is a
 * plain anchor.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
      createElement('a', { href, ...rest }, children as never),
  };
});

import { renderWithI18n } from '@/test/i18n';
import Table, { DEFAULT_TABLE_PAGINATION_LABELS, TablePagination, type TablePaginationLabels } from '../Table';

const GERMAN: TablePaginationLabels = {
  showing: '{start}–{end} von {total}',
  rows: 'Zeilen',
  rowsPerPage: 'Zeilen pro Seite',
  pagination: 'Seitennavigation',
  previousPage: 'Vorherige Seite',
  nextPage: 'Nächste Seite',
  page: 'Seite {page}',
};

/** Visible text, tags dropped and whitespace collapsed. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function ariaLabels(html: string): string[] {
  return [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
}

describe('TablePagination labels', () => {
  const props = { page: 2, totalPages: 3, perPage: 20 as const, totalItems: 45 };

  it('keeps the English chrome by default', () => {
    const html = renderToStaticMarkup(<TablePagination {...props} />);
    expect(text(html)).toContain('Showing 21–40 of 45');
    expect(text(html)).toContain('Rows');
    expect(ariaLabels(html)).toEqual(
      expect.arrayContaining(['Rows per page', 'Pagination', 'Previous page', 'Next page', 'Page 1', 'Page 3']),
    );
  });

  it('fills the counts into the given words', () => {
    const html = renderToStaticMarkup(<TablePagination {...props} labels={GERMAN} />);
    expect(text(html)).toContain('21–40 von 45');
    expect(text(html)).toContain('Zeilen');
    expect(text(html)).not.toMatch(/Showing|Rows/);
    expect(ariaLabels(html)).toEqual(
      expect.arrayContaining(['Zeilen pro Seite', 'Seitennavigation', 'Vorherige Seite', 'Nächste Seite', 'Seite 2']),
    );
    expect(ariaLabels(html).join('|')).not.toMatch(/Page|Rows|Pagination/);
  });

  it('speaks the viewer language without labels (ui.table)', () => {
    const html = renderWithI18n(<TablePagination {...props} />, { locale: 'de' });
    expect(text(html)).toContain('21–40 von 45');
    expect(text(html)).toContain('Zeilen');
    expect(ariaLabels(html)).toEqual(
      expect.arrayContaining(['Zeilen pro Seite', 'Seitennavigation', 'Vorherige Seite', 'Nächste Seite', 'Seite 3']),
    );
    expect(text(html)).not.toMatch(/Showing|Rows/);
  });

  it('an explicit labels prop still wins over the viewer language', () => {
    const html = renderWithI18n(<TablePagination {...props} labels={DEFAULT_TABLE_PAGINATION_LABELS} />, {
      locale: 'de',
    });
    expect(text(html)).toContain('Showing 21–40 of 45');
  });

  it('server-mode page links carry the labels too', () => {
    const html = renderToStaticMarkup(
      <TablePagination {...props} labels={GERMAN} pageHrefs={{ 1: '?page=1', 2: '?page=2', 3: '?page=3' }} />,
    );
    expect(html).toContain('href="?page=1"');
    expect(ariaLabels(html)).toEqual(expect.arrayContaining(['Vorherige Seite', 'Seite 3']));
  });
});

describe('Table labels', () => {
  const columns = [{ key: 'name', header: 'Name' }];
  const data = [{ name: 'Garchomp' }, { name: 'Pikachu' }];

  it('passes them to both pagination bars of the client engine', () => {
    const html = renderToStaticMarkup(
      <Table columns={columns} data={data} keyExtractor={(row) => row.name} labels={GERMAN} />,
    );
    expect(text(html).match(/1–2 von 2/g)).toHaveLength(2);
    expect(html).not.toContain('Showing');
  });

  it('renders German chrome under a German provider', () => {
    const html = renderWithI18n(<Table columns={columns} data={data} keyExtractor={(row) => row.name} />, {
      locale: 'de',
    });
    expect(text(html).match(/1–2 von 2/g)).toHaveLength(2);
  });

  it('renders English without labels', () => {
    const html = renderToStaticMarkup(<Table columns={columns} data={data} keyExtractor={(row) => row.name} />);
    expect(text(html).match(/Showing 1–2 of 2/g)).toHaveLength(2);
  });
});
