/**
 * The phase overview editor: a completed phase shows the locked notice and a disabled form (reopen
 * it to change the settings), and a refused save is thrown as `PhaseSaveError` so `PhaseForm` shows
 * it once (the editor has no error alert of its own). Rendered with react-dom/server in the node env;
 * `capture` keeps the element tree the editor returned so its save handler can be called.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { LeaguePhase } from '@/types/season';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { default: PhaseOverviewEditor } = await import('../PhaseOverviewEditor');
const { default: PhaseForm, PhaseSaveError } = await import('../PhaseForm');

type El = ReactElement<Record<string, unknown>>;

function phase(status: LeaguePhase['status']): LeaguePhase {
  return {
    id: 'ph1',
    season_id: 's1',
    name: 'Groups',
    description: '',
    bracket_type: 'round_robin',
    ruleset_id: 'rs-1',
    ruleset_name: 'Gen 9 RU',
    best_of_default: 3,
    bo_overrides: {},
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    status,
    stage_order: 1,
    advancement_rule: null,
    enrollment_source: null,
    participant_count: 0,
    rounds_total: 0,
    rounds_completed: 0,
    archived: false,
    created_at: '',
    updated_at: '',
  };
}

const LOCKED_NOTICE = 'This phase is completed, so its settings are locked. Reopen it to change them.';

function find(node: ReactNode, match: (el: El) => boolean): El | undefined {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = find(n as ReactNode, match);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (match(node)) return node;
  return find(node.props.children as ReactNode, match);
}

/** Renders the editor on the server and returns the element tree its body returned. */
function capture(status: LeaguePhase['status']): ReactNode {
  let tree: ReactNode = null;
  function Probe() {
    tree = PhaseOverviewEditor({ seasonId: 's1', phase: phase(status), rulesets: [] });
    return tree;
  }
  renderToStaticMarkup(<Probe />);
  return tree;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PhaseOverviewEditor locked state', () => {
  it('shows the locked notice and a disabled form for a completed phase', () => {
    const html = renderWithI18n(<PhaseOverviewEditor seasonId="s1" phase={phase('completed')} rulesets={[]} />);

    expect(html).toContain(LOCKED_NOTICE);
    expect(html).toMatch(/<fieldset disabled=""/);
  });

  it.each(['upcoming', 'active'] as const)('shows no notice and an enabled form for a %s phase', (status) => {
    const html = renderWithI18n(<PhaseOverviewEditor seasonId="s1" phase={phase(status)} rulesets={[]} />);

    expect(html).not.toContain(LOCKED_NOTICE);
    expect(html).not.toContain('<fieldset disabled');
  });

  it('renders the notice in German', () => {
    const html = renderWithI18n(<PhaseOverviewEditor seasonId="s1" phase={phase('completed')} rulesets={[]} />, {
      locale: 'de',
    });

    expect(html).toContain('Diese Phase ist abgeschlossen, daher sind ihre Einstellungen gesperrt.');
    expect(html).not.toContain(LOCKED_NOTICE);
  });

  it('locks the bracket type of an active phase only through the existing bracket lock', () => {
    const tree = capture('active');
    const form = find(tree, (el) => el.type === PhaseForm);

    expect(form?.props.lockBracketType).toBe(true);
    expect(form?.props.locked).toBe(false);
  });
});

describe('PhaseOverviewEditor save', () => {
  it('throws a refusal as PhaseSaveError and shows no error of its own', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => ({ success: false, error: 'Taken', code: 'PHASE_NAME_TAKEN' }) })),
    );
    const form = find(capture('upcoming'), (el) => el.type === PhaseForm);
    const onSubmit = form?.props.onSubmit as (data: unknown) => Promise<void>;

    await expect(onSubmit({ name: 'Groups' })).rejects.toBeInstanceOf(PhaseSaveError);
    await expect(onSubmit({ name: 'Groups' })).rejects.toMatchObject({ api: { code: 'PHASE_NAME_TAKEN' } });
    expect(router.refresh).not.toHaveBeenCalled();

    const html = renderWithI18n(<PhaseOverviewEditor seasonId="s1" phase={phase('upcoming')} rulesets={[]} />);
    expect(html).not.toContain('role="alert"');
  });

  it('refreshes the route after a successful save', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ success: true, data: {} }) }));
    vi.stubGlobal('fetch', fetchMock);
    const form = find(capture('upcoming'), (el) => el.type === PhaseForm);
    const onSubmit = form?.props.onSubmit as (data: unknown) => Promise<void>;

    await onSubmit({ name: 'Groups' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/seasons/s1/phases/ph1');
    expect(init.method).toBe('PATCH');
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
