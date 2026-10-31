import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import PlanPanel from '../PlanPanel';
import type { PlanView } from '../types';

const view = (overrides: Partial<PlanView> = {}): PlanView => ({
  id: 'p1',
  mode: 'create',
  status: 'drafting',
  revision: 3,
  code: 'abcdef01',
  title: 'Gen 9 OU league',
  contentLocale: 'en',
  ready: true,
  assumptions: [{ key: 'league.language', source: 'inferred', confirmed: false, value: { kind: 'word', group: 'languages', value: 'de' } }],
  blockers: [],
  warnings: [],
  sections: [
    {
      section: 'league',
      state: 'ready',
      blockers: 0,
      rows: [
        { label: 'name', value: { kind: 'text', text: '<b>Spring</b> OU' } },
        { label: 'formatType', value: { kind: 'enum', group: 'formatType', value: 'singles' } },
        { label: 'startDate', value: { kind: 'date', value: '2026-11-02' } },
      ],
      items: [],
    },
    {
      section: 'phases',
      state: 'engine_gap',
      blockers: 1,
      rows: [],
      items: [
        { title: 'Regular season', rows: [{ label: 'bracket', value: { kind: 'phase', bracket: 'round_robin', bestOf: 1, doubles: false } }] },
        { title: 'Playoffs', rows: [{ label: 'bracket', value: { kind: 'phase', bracket: 'single_elim', bestOf: 3, doubles: true } }] },
      ],
    },
    { section: 'roster', state: 'needs_input', blockers: 1, rows: [{ label: 'matched', value: { kind: 'matched', resolved: 9, total: 12 } }, { label: 'open', value: { kind: 'number', value: 3 } }], items: [] },
  ],
  ...overrides,
});

describe('PlanPanel', () => {
  it('shows an empty plan as a hint', () => {
    expect(renderWithI18n(<PlanPanel plan={null} />)).toContain('The plan fills in as you describe what you want.');
    expect(renderWithI18n(<PlanPanel plan={null} />, { locale: 'de' })).toContain('Der Plan füllt sich, während du beschreibst, was du willst.');
  });

  it('says an unreadable stored plan needs setting up again, instead of the empty hint', () => {
    const html = renderWithI18n(<PlanPanel plan={null} unreadable />);
    expect(html).toContain('This plan can no longer be read.');
    expect(html).not.toContain('The plan fills in as you describe what you want.');
  });

  it('shows the sections with their chips, in English', () => {
    const out = renderWithI18n(<PlanPanel plan={view()} />);
    expect(out).toContain('Gen 9 OU league');
    expect(out).toContain('Revision 3');
    expect(out).toContain('Plan code abcdef01');
    expect(out).toContain('Drafting');
    for (const text of ['League', 'Phases', 'Roster', 'Ready', 'Engine gap', 'Needs input']) expect(out).toContain(text);
    expect(out).toContain('Singles');
    expect(out).toContain('Round robin, best of 1');
    expect(out).toContain('Single elimination, best of 3, doubles');
    expect(out).toContain('2 Nov 2026');
    expect(out).toContain('9 of 12');
    expect(out).toContain('Regular season');
  });

  it('shows the same plan in German, with dates and numbers formatted for the locale', () => {
    const out = renderWithI18n(<PlanPanel plan={view()} />, { locale: 'de' });
    for (const text of ['Liga', 'Phasen', 'Kader', 'Bereit', 'Von der Engine nicht abgedeckt', 'Angabe nötig', 'In Arbeit', 'Plan-Code abcdef01', '9 von 12']) expect(out, text).toContain(text);
    expect(out).toContain('2. Nov. 2026');
    expect(out).toContain('Jeder gegen jeden, Best-of-1');
    expect(out).not.toContain('2026-11-02');
  });

  it('escapes stored text: a name cannot inject markup', () => {
    const out = renderWithI18n(<PlanPanel plan={view()} />);
    expect(out).not.toContain('<b>Spring</b>');
    expect(out).toContain('&lt;b&gt;Spring&lt;/b&gt; OU');
  });

  it('says what blocks a build in plain words, from codes and params', () => {
    const blocked = view({
      ready: false,
      blockers: [
        { code: 'roster_unresolved', section: 'roster', path: '/slots/roster/entries', params: { count: 3 } },
        { code: 'plan_incomplete', section: 'plan', path: '/slots/league', params: { missing: 'league' } },
        { code: 'double_round_robin_unsupported', section: 'phases', path: '/slots/phases/0/bracket_type', params: { legs: 2, supported: 1 } },
        { code: 'a_code_from_the_future', section: 'plan', path: '/slots', params: {} },
      ],
    });
    const en = renderWithI18n(<PlanPanel plan={blocked} />);
    expect(en).toContain('Before this can be built');
    expect(en).toContain('3 roster entries are not matched to a player yet.');
    expect(en).toContain('The plan still needs its League section.');
    expect(en).toContain('A double round robin is not supported by the engine yet.');
    // An unknown code falls back to a generic line, never to the raw code.
    expect(en).toContain('Something in the plan needs attention.');
    expect(en).not.toContain('a_code_from_the_future');

    const de = renderWithI18n(<PlanPanel plan={blocked} />, { locale: 'de' });
    expect(de).toContain('3 Kader-Einträge sind noch keinem Spieler zugeordnet.');
    expect(de).toContain('Dem Plan fehlt noch der Abschnitt „Liga“.');
  });

  it('says nothing blocks a build when nothing does, and marks the plan read-only', () => {
    const out = renderWithI18n(<PlanPanel plan={view()} />);
    expect(out).toContain('Nothing blocks a build.');
    expect(out).toContain('To change the plan, tell the assistant what should be different.');
    expect(out).not.toMatch(/<(input|textarea|select)/);
  });

  it('lists assumptions with where they came from and whether they are confirmed', () => {
    const out = renderWithI18n(<PlanPanel plan={view()} />);
    expect(out).toContain('Assumptions');
    expect(out).toContain('league.language');
    expect(out).toContain('German');
    expect(out).toContain('Inferred from what you wrote');
    expect(out).toContain('Not confirmed');
  });

  it('keeps a warning apart from the blockers', () => {
    const out = renderWithI18n(<PlanPanel plan={view({ warnings: [{ code: 'league_name_in_use', section: 'league', path: '/slots/league/name', params: {} }] })} />);
    expect(out).toContain('A league with this name was created recently.');
    expect(out).toContain('Nothing blocks a build.');
  });
});
