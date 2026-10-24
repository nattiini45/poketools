/**
 * The format drift report on `/admin/data`: every state of the props-driven view in both languages, and the
 * page placing the report inside the site-admin guard. Effects do not run under `renderToStaticMarkup`, so the
 * on-demand fetch is covered by the idle state (nothing loads) and by the route test.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { FormatDriftReport as FormatDriftData } from '@/lib/admin/format-drift';
import type { TiebreakerStep } from '@/types/format-rules';

vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return { getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en') };
});
vi.mock('@/components/shared/SiteAdminGuard', () => ({
  default: function SiteAdminGuard({ children }: { children?: ReactNode }) {
    return children ?? null;
  },
}));
vi.mock('../AdminDataTools', () => ({
  default: function AdminDataTools() {
    return null;
  },
}));

import AdminDataPage from '../page';
import SiteAdminGuard from '@/components/shared/SiteAdminGuard';
import FormatDriftReport, { FormatDriftReportView } from '../FormatDriftReport';

const PACK: TiebreakerStep[] = ['match_points', 'evolution_points', 'kill_difference', 'head_to_head', 'decision_match'];
const L1 = '5e150000-0000-4000-8000-000000000001';
const L2 = '5e150000-0000-4000-8000-000000000002';

const rule = (count: number, perGroup = false) => ({ type: 'top_n' as const, count, per_group: perGroup });

function report(overrides: Partial<FormatDriftData> = {}): FormatDriftData {
  return {
    generatedAt: '2026-10-24T10:00:00.000Z',
    packChain: PACK,
    tiebreaker: {
      checked: 3,
      cases: [
        {
          seasonId: L1,
          seasonName: 'Spring Cup',
          archived: true,
          isTest: false,
          stored: ['head_to_head', 'match_points'],
          pack: PACK,
        },
      ],
    },
    advancement: {
      leaguesChecked: 2,
      pairsChecked: 3,
      consistentPairs: 1,
      cases: [
        {
          seasonId: L2,
          seasonName: 'Autumn Open',
          archived: false,
          isTest: true,
          kind: 'source_only',
          source: { id: 'ph-1', name: 'Groups', stageOrder: 0, status: 'completed', rule: rule(4) },
          target: { id: 'ph-2', name: 'Playoffs', stageOrder: 1, status: 'upcoming', rule: null },
        },
        {
          seasonId: L2,
          seasonName: 'Autumn Open',
          archived: false,
          isTest: true,
          kind: 'both_differ',
          source: { id: 'ph-2', name: 'Playoffs', stageOrder: 1, status: 'upcoming', rule: rule(2, true) },
          target: { id: 'ph-3', name: 'Finals', stageOrder: 2, status: 'upcoming', rule: rule(1) },
        },
      ],
    },
    truncated: { formatRules: false, phases: false },
    ...overrides,
  };
}

const empty = report({
  tiebreaker: { checked: 2, cases: [] },
  advancement: { leaguesChecked: 2, pairsChecked: 1, consistentPairs: 1, cases: [] },
});

const view = (state: Parameters<typeof FormatDriftReportView>[0]['state'], data?: FormatDriftData, locale: 'en' | 'de' = 'en') =>
  renderWithI18n(<FormatDriftReportView state={state} report={data} />, { locale });

describe('FormatDriftReportView', () => {
  it('idle: offers Run report and shows no data', () => {
    const html = view({ status: 'idle' });
    expect(html).toContain('Format drift report');
    expect(html).toContain('Run report');
    expect(html).not.toContain('Spring Cup');
    expect(html).not.toContain('This report only reads');
  });

  it('loading: disables the button and says it is running', () => {
    const html = view({ status: 'loading' });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Running…<\/button>/);
  });

  it('failed: shows the fallback error text and a Retry button', () => {
    const html = view({ status: 'failed', error: { error: 'Failed to build the format drift report' } });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Failed to build the format drift report');
    expect(html).toContain('>Retry</button>');
  });

  it('failed: renders a catalogued error code in the viewer language', () => {
    const html = view({ status: 'failed', error: { code: 'network_error' } }, undefined, 'de');
    expect(html).toContain('role="alert"');
    expect(html).toContain('>Erneut versuchen</button>');
    expect(html).not.toContain('network_error');
  });

  it('loaded: lists both findings with links to the league tabs and the phase pages', () => {
    const html = view({ status: 'loaded' }, report());

    expect(html).toContain(`href="/admin/leagues/${L1}?tab=rules"`);
    expect(html).toContain(`href="/admin/leagues/${L2}?tab=phases"`);
    expect(html).toContain(`href="/admin/leagues/${L2}/phases/ph-1"`);
    expect(html).toContain(`href="/admin/leagues/${L2}/phases/ph-2"`);
    expect(html).toContain(`href="/admin/leagues/${L2}/phases/ph-3"`);
    expect(html).toContain('Spring Cup');
    expect(html).toContain('Autumn Open');
    expect(html).toContain('Archived');
    expect(html).toContain('Test');
  });

  it('loaded: numbers phases from 1 although stage_order is stored from 0', () => {
    const html = view({ status: 'loaded' }, report());

    expect(html).toMatch(/>1\. Groups</);
    expect(html).toMatch(/>2\. Playoffs</);
    expect(html).toMatch(/>3\. Finals</);
    expect(html).not.toMatch(/>0\. /);
  });

  it('loaded: shows rules as top N, top N per group or none', () => {
    const html = view({ status: 'loaded' }, report());
    expect(html).toContain('top 4');
    expect(html).toContain('top 2 per group');
    expect(html).toContain('top 1');
    expect(html).toContain('none');
  });

  it('loaded: shows the stored and pack chains with the rules-page step labels', () => {
    const html = view({ status: 'loaded' }, report());
    expect(html).toContain('Stored');
    expect(html).toContain('Pack chain');
    expect(html).toContain('Head to head');
    expect(html).toContain('Match points');
    expect(html).toContain('Evolution points');
    expect(html).toContain('Decision match');
  });

  it('loaded: states that the report is read-only and what the engine really uses', () => {
    const html = view({ status: 'loaded' }, report());
    expect(html).toContain('changes nothing');
    expect(html).toContain('tiebreaker chain');
    expect(html).toContain('target phase');
  });

  it('loaded: summary counts', () => {
    const html = view({ status: 'loaded' }, report());
    expect(html).toContain('3 leagues with format rules checked');
    expect(html).toContain('1 differs from the pack chain');
    expect(html).toContain('3 phase pairs with a rule checked');
    expect(html).toContain('1 consistent');
    expect(html).toContain('2 mismatching');
  });

  it('loaded: an all-empty report says no differences were found in both lists', () => {
    const html = view({ status: 'loaded' }, empty);
    expect(html).toContain('every stored order matches the pack chain');
    expect(html).toContain('no advancement rule sits on the wrong side of a phase pair');
    expect(html).not.toContain('Spring Cup');
  });

  it('loaded: a truncated read shows a partial-report warning, a complete one does not', () => {
    const partial = view({ status: 'loaded' }, report({ truncated: { formatRules: false, phases: true } }));
    expect(partial).toContain('The report is partial');
    expect(partial).toContain('10,000');
    expect(view({ status: 'loaded' }, report())).not.toContain('The report is partial');
  });

  it('renders the German report without English fallbacks, with real umlauts', () => {
    const html = view({ status: 'loaded' }, report({ truncated: { formatRules: true, phases: false } }), 'de');

    expect(html).toContain('Format-Drift-Bericht');
    expect(html).toContain('Bericht erstellen');
    expect(html).toContain('Top 4');
    expect(html).toContain('Top 2 je Gruppe');
    expect(html).toContain('keine');
    expect(html).toContain('Quellphase');
    expect(html).toContain('Zielphase');
    expect(html).toContain('Formatregeln geprüft');
    expect(html).toContain('Der Bericht ist unvollständig');
    expect(html).toContain('Evolutionspunkte');
    expect(html).toContain('Archiviert');
    expect(html).not.toMatch(/Ã|Â|�/);
    // A missing catalog key renders the key itself.
    expect(html).not.toMatch(/data\.formatDrift|formatRules\.tiebreaker/);
    expect(html).not.toContain('Run report');
    expect(html).not.toContain('Pack chain');
  });

  it('renders the German empty and failed states', () => {
    expect(view({ status: 'loaded' }, empty, 'de')).toContain('Keine Abweichungen gefunden');
    expect(view({ status: 'failed', error: null }, undefined, 'de')).toContain(
      'Der Format-Drift-Bericht konnte nicht erstellt werden',
    );
  });

  it('the stateful default export starts idle and loads nothing on render', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const html = renderWithI18n(<FormatDriftReport />);
    vi.unstubAllGlobals();

    expect(html).toContain('Run report');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('/admin/data page', () => {
  function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
    const found: ReactElement<Record<string, unknown>>[] = [];
    const walk = (n: ReactNode): void => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (isValidElement<Record<string, unknown>>(n)) {
        if (n.type === type) found.push(n);
        walk(n.props.children as ReactNode);
        if (n.props.action) walk(n.props.action as ReactNode);
      }
    };
    walk(node);
    return found;
  }

  it('renders the drift report inside the site-admin guard', async () => {
    const tree = await AdminDataPage();
    const [guard] = find(tree, SiteAdminGuard);

    expect(guard).toBeDefined();
    expect(find(guard.props.children as ReactNode, FormatDriftReport)).toHaveLength(1);
  });
});
