/**
 * The shared top of both create pages: the title, one line of help per kind, and the League / Tournament links between
 * the two pages. Async server components: awaited here, then rendered to markup.
 */
import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ locale: 'en' as 'en' | 'de' }));

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return { getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, mocks.locale) };
});

vi.mock('../CompetitionKindSwitch', () => ({ default: function CompetitionKindSwitchStub() { return null; } }));

import NewCompetitionHeader from '../NewCompetitionHeader';
import StubSwitch from '../CompetitionKindSwitch';

/** The real switch, which the header test replaces with a stub (an async component cannot render inside a sync render). */
async function realSwitch(current: 'league' | 'tournament') {
  const { default: CompetitionKindSwitch } = await vi.importActual<typeof import('../CompetitionKindSwitch')>('../CompetitionKindSwitch');
  return renderToStaticMarkup(await CompetitionKindSwitch({ current }));
}

beforeEach(() => {
  mocks.locale = 'en';
});

function findByType(node: ReactNode, type: unknown): ReactNode[] {
  const found: ReactNode[] = [];
  const visit = (n: ReactNode): void => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (isValidElement<{ children?: ReactNode }>(n)) {
      if (n.type === type) found.push(n);
      visit(n.props.children);
    }
  };
  visit(node);
  return found;
}

describe('CompetitionKindSwitch (the real one)', () => {
  it('links the league and the tournament create pages and marks the current one', async () => {
    const out = await realSwitch('league');

    expect(out).toContain('aria-label="Kind of competition"');
    expect(out).toMatch(/<a href="\/admin\/leagues\/new" aria-current="page"[^>]*>.*League.*<\/a>/s);
    expect(out).toMatch(/<a href="\/admin\/tournaments\/new"(?![^>]*aria-current)[^>]*>.*Tournament.*<\/a>/s);
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('marks the tournament page when that is the current one', async () => {
    const out = await realSwitch('tournament');

    expect(out).toMatch(/<a href="\/admin\/tournaments\/new" aria-current="page"/);
    expect(out).not.toMatch(/<a href="\/admin\/leagues\/new" aria-current/);
  });

  it('is in German under de', async () => {
    mocks.locale = 'de';
    const out = await realSwitch('league');

    expect(out).toContain('Art des Wettbewerbs');
    expect(out).toContain('Liga');
    expect(out).toContain('Turnier');
  });
});

describe('NewCompetitionHeader', () => {
  it.each([
    ['league', 'Pick a starting point. Everything it needs is created in one go, and you can change it afterwards.'],
    ['tournament', 'A tournament stands on its own: one bracket or one set of rounds, without league phases.'],
  ] as const)('titles the page and says what a %s is', async (kind, intro) => {
    const tree = await NewCompetitionHeader({ kind });
    const out = renderToStaticMarkup(tree);

    expect(out).toContain('<h1');
    expect(out).toContain('New competition');
    expect(out).toContain(intro);
    expect(findByType(tree, StubSwitch)).toHaveLength(1);
    expect((findByType(tree, StubSwitch)[0] as { props: { current: string } }).props.current).toBe(kind);
  });

  it('renders what the page puts under the switch', async () => {
    const out = renderToStaticMarkup(await NewCompetitionHeader({ kind: 'league', children: <p>extra</p> }));
    expect(out).toContain('<p>extra</p>');
  });

  it('is in German under de', async () => {
    mocks.locale = 'de';
    const out = renderToStaticMarkup(await NewCompetitionHeader({ kind: 'tournament' }));

    expect(out).toContain('Neuer Wettbewerb');
    expect(out).toContain('Ein Turnier steht für sich');
  });
});
