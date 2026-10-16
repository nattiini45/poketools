/**
 * The rules plaque, #rules section, `?rules=gate` panel and #pulse draft CTA
 * follow the league's FORMAT, never whether a `format_rules` row exists.
 *
 * Only Evolution Point Buy seasons get a `format_rules` row, and a format
 * change can leave a stale one behind. The open preview fixtures still carry
 * the EPB row on a singles season, which is exactly that stale-row case: the
 * format branch must ignore it.
 *
 * The EPB branch is pinned with explicit literals (the painters' output before
 * the format branch existed), so EPB plaque textures and the pinned capture
 * references cannot drift.
 *
 * Rendered through react-dom/server (vitest 'node' env). `next/link` is a
 * plain anchor; the preview fixtures import the route-data module, whose
 * query modules import the Supabase client: a stub that throws on use.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  function Link({
    href,
    children,
    scroll: _scroll,
    prefetch: _prefetch,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
    scroll?: boolean;
    prefetch?: boolean | null;
    [key: string]: unknown;
  }) {
    return createElement('a', { ...rest, href }, children);
  }
  return { default: Link };
});

vi.mock('@/lib/supabase/client', () => ({
  get supabase(): never {
    throw new Error('section render must not reach Supabase');
  },
}));

import { createTranslator } from '@/i18n/core';
import { glossaryMessages } from '@/i18n/messages/glossary';
import RulesSection from '../RulesSection';
import RulesPanel from '../overlays/RulesPanel';
import PulseSection from '../PulseSection';
import EvoligaPulseSection from '../../evoliga/PulseSection';
import { buildThemeOverlayMaps } from '../overlays/ThemeOverlays';
import {
  currentStage,
  formatRulesRows,
  fullRulesSentence,
  NO_RULESET_SUFFIX,
  noRulesetSuffix,
  rulesCopyContext,
  rulesHubHref,
  rulesOfRecordName,
} from '../rules-context';
import type { RulesCopyContext, RulesCopyFn, ThemeRouteData, ThemeSectionCopy } from '../types';
import { plaqueCopy as sakuraPlaqueCopy } from '../../themes/sakura/content/paint';
import { plaqueCopy as mountainPlaqueCopy } from '../../themes/mountain/content/paint';
import { gatePlaqueCopy as cloudsPlaqueCopy } from '../../themes/clouds/content/paint';
import { sakuraSectionCopyFor } from '../../themes/sakura/sections/copy';
import { mountainSectionCopyFor } from '../../themes/mountain/sections/copy';
import { cloudsSectionCopyFor } from '../../themes/clouds/sections/copy';
import { toSakuraRouteData } from '../../themes/sakura/types';
import { toMountainRouteData } from '../../themes/mountain/types';
import { toCloudsRouteData } from '../../themes/clouds/types';
import {
  buildPreviewCloudsWorld,
  buildPreviewMountainWorld,
  buildPreviewSakuraWorld,
  type PreviewScenario,
} from '@/app/(public)/route-preview/fixtures';
import { epbPack } from '@/lib/format-pack';
import { stationDigestFacts } from '@/lib/route-world/station-digest';
import type { FormatRules } from '@/types/format-rules';
import type { SeasonFormatType } from '@/types/season';

// ─── Fixtures ─────────────────────────────────────────────────────────────

type Theme = 'sakura' | 'mountain' | 'clouds';
type Variant = 'epb' | 'open';

function themeData(theme: Theme, variant: Variant, scenario: PreviewScenario = 'populated'): ThemeRouteData {
  const data =
    theme === 'sakura'
      ? toSakuraRouteData(buildPreviewSakuraWorld(variant, scenario).data)
      : theme === 'mountain'
        ? toMountainRouteData(buildPreviewMountainWorld(variant, scenario).data)
        : toCloudsRouteData(buildPreviewCloudsWorld(variant, scenario).data);
  if (!data) throw new Error(`the ${theme} preview always carries a league row`);
  return data;
}

const COPY: Record<Theme, ThemeSectionCopy> = {
  sakura: sakuraSectionCopyFor('en'),
  mountain: mountainSectionCopyFor('en'),
  clouds: cloudsSectionCopyFor('en'),
};
const PAINTER: Record<Theme, RulesCopyFn> = {
  sakura: sakuraPlaqueCopy,
  mountain: mountainPlaqueCopy,
  clouds: cloudsPlaqueCopy,
};
const TITLE: Record<Theme, string> = {
  sakura: 'RULES OF THE PARK',
  mountain: 'RULES OF THE PASS',
  clouds: 'RULES OF THE ISLES',
};
const THEMES: Theme[] = ['sakura', 'mountain', 'clouds'];

/** A league moved to another format, keeping everything else (and any stale row). */
function withFormat(data: ThemeRouteData, format: SeasonFormatType, hasDraftPool = data.hasDraftPool): ThemeRouteData {
  return { ...data, league: { ...data.league, format_type: format }, hasDraftPool };
}

/** The EPB rules row the fixtures carry: the active format pack's defaults (the example pack here). */
function epbRules(): FormatRules {
  const rules = themeData('sakura', 'epb').formatRules;
  if (!rules) throw new Error('the EPB fixture carries a format_rules row');
  return rules;
}

/** A configured row that differs from the defaults in every painted number (stage-1 Tera is always free). */
function customRules(): FormatRules {
  const rules = epbRules();
  return {
    ...rules,
    draft_budget: 150,
    draft_picks: 8,
    banned_moves: ['Move A', 'Move B'],
  };
}

const EPB: RulesCopyContext = { format: 'evolution_point_buy', bestOf: 3 };
/** The painted default numbers: draft budget, lines per trainer and the banned-move count. */
const BUDGET = `${epbPack.defaults.draftBudget} pts`;
const PICKS = String(epbPack.defaults.draftPicks);
const BANNED = String(epbPack.defaults.bannedMoves.length);
const DEFAULTS_NOTE = 'No explicit rules configured — league defaults apply.';
const HUB_HREF = '/leagues/sakura-preview-season?tab=rules#league-hub';

function render(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>);
}

/** Visible text of static markup, whitespace squashed (entities decoded for the few React emits). */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((match) => match[1].replace(/&amp;/g, '&'));
}

const draftHrefs = (html: string) => hrefs(html).filter((href) => /\/draft(-room)?$/.test(href));

// ─── (a) EPB plaque copy is unchanged ─────────────────────────────────────

describe('plaque painters on Evolution Point Buy (the active pack defaults)', () => {
  const FIXTURE_ROWS: Record<Theme, [string, string][]> = {
    sakura: [
      ['Draft budget', BUDGET],
      ['Lines per trainer', PICKS],
      ['Tera — stage 1', 'Free Tera'],
      ['Banned moves', BANNED],
    ],
    mountain: [
      ['Draft budget', BUDGET],
      ['Lines each', PICKS],
      ['Tera — stage 1', 'Free Tera'],
      ['Banned moves', BANNED],
    ],
    clouds: [
      ['Draft budget', BUDGET],
      ['Lines per trainer', PICKS],
      ['Tera — stage 1', 'Free Tera'],
      ['Banned moves', BANNED],
    ],
  };
  const SAKURA_COMPACT: [string, string][] = [
    ['Draft', BUDGET],
    ['Lines', PICKS],
    ['Tera', 'Free Tera'],
    ['Banned', BANNED],
  ];

  it.each(THEMES)('%s: a configured row paints the row (no note)', (theme) => {
    const expected = {
      title: TITLE[theme],
      rulesetName: 'Park Standard',
      rows: FIXTURE_ROWS[theme],
      ...(theme === 'sakura' ? { compactRows: SAKURA_COMPACT } : {}),
      note: null,
    };
    expect(PAINTER[theme](epbRules(), 'Park Standard', EPB)).toStrictEqual(expected);
  });

  it.each(THEMES)('%s: no row (failed read or never seeded) paints the league defaults with the note', (theme) => {
    // No ruleset either: the plaque names the format's own rules, never an
    // invented 'League Standard' the hub's Rules tab contradicts (5A-3).
    const expected = {
      title: TITLE[theme],
      rulesetName: 'Evolution Point Buy',
      rows: FIXTURE_ROWS[theme],
      ...(theme === 'sakura' ? { compactRows: SAKURA_COMPACT } : {}),
      note: DEFAULTS_NOTE,
    };
    expect(PAINTER[theme](null, null, EPB)).toStrictEqual(expected);
  });

  it('every configured number flows through, in each theme’s own labels', () => {
    expect(sakuraPlaqueCopy(customRules(), 'X', EPB)).toStrictEqual({
      title: 'RULES OF THE PARK',
      rulesetName: 'X',
      rows: [
        ['Draft budget', '150 pts'],
        ['Lines per trainer', '8'],
        ['Tera — stage 1', 'Free Tera'],
        ['Banned moves', '2'],
      ],
      compactRows: [
        ['Draft', '150 pts'],
        ['Lines', '8'],
        ['Tera', 'Free Tera'],
        ['Banned', '2'],
      ],
      note: null,
    });
    expect(mountainPlaqueCopy(customRules(), 'X', EPB).rows).toStrictEqual([
      ['Draft budget', '150 pts'],
      ['Lines each', '8'],
      ['Tera — stage 1', 'Free Tera'],
      ['Banned moves', '2'],
    ]);
    expect(cloudsPlaqueCopy(customRules(), 'X', EPB).rows).toStrictEqual([
      ['Draft budget', '150 pts'],
      ['Lines per trainer', '8'],
      ['Tera — stage 1', 'Free Tera'],
      ['Banned moves', '2'],
    ]);
  });

  it.each(THEMES)('%s: the best-of never reaches an EPB plaque', (theme) => {
    for (const rules of [epbRules(), null]) {
      expect(PAINTER[theme](rules, 'X', { format: 'evolution_point_buy', bestOf: null })).toStrictEqual(
        PAINTER[theme](rules, 'X', { format: 'evolution_point_buy', bestOf: 5 }),
      );
    }
  });
});

// ─── (b) Non-EPB plaque copy: format and best-of only ─────────────────────

describe('plaque painters on every other format', () => {
  const FORMATS: [SeasonFormatType, string][] = [
    ['singles', 'Singles'],
    ['doubles', 'Doubles'],
    ['draft', 'Draft'],
  ];

  it.each(THEMES)('%s: format and best-of, no note, whatever row is (or is not) there', (theme) => {
    for (const [format, label] of FORMATS) {
      for (const rules of [epbRules(), customRules(), null]) {
        const copy = PAINTER[theme](rules, 'Park Standard', { format, bestOf: 3 });
        expect(copy).toStrictEqual({
          title: TITLE[theme],
          rulesetName: 'Park Standard',
          rows: [
            ['Format', label],
            ['Best of', '3'],
          ],
          ...(theme === 'sakura'
            ? {
                compactRows: [
                  ['Mode', label],
                  ['Best of', '3'],
                ],
              }
            : {}),
          note: null,
        });
        expect(JSON.stringify(copy)).not.toMatch(/Draft budget|Lines|Tera|Banned|pts|defaults/);
      }
    }
  });

  it.each(THEMES)('%s: no stage yet leaves the best-of out, and the ruleset falls back to the format (5A-3)', (theme) => {
    const copy = PAINTER[theme](epbRules(), null, { format: 'doubles', bestOf: null });
    expect(copy.rulesetName).toBe('Doubles');
    expect(copy.rows).toStrictEqual([['Format', 'Doubles']]);
    expect(copy.note).toBeNull();
  });

  it('formatRulesRows labels the sakura ledger line “Mode” (Format + Doubles nearly fills it)', () => {
    expect(formatRulesRows({ format: 'doubles', bestOf: 1 })).toStrictEqual({
      rows: [
        ['Format', 'Doubles'],
        ['Best of', '1'],
      ],
      compactRows: [
        ['Mode', 'Doubles'],
        ['Best of', '1'],
      ],
    });
  });
});

describe('rulesCopyContext', () => {
  const stage = (status: 'upcoming' | 'active' | 'completed', best_of_default: number) => ({
    status,
    best_of_default,
  });

  it('takes the active stage’s best-of (the stage the Pulse section names)', () => {
    expect(
      rulesCopyContext({
        league: { format_type: 'singles' },
        stages: [stage('completed', 1), stage('active', 3), stage('upcoming', 5)],
      }),
    ).toStrictEqual({ format: 'singles', bestOf: 3 });
  });

  it('falls back to the LAST stage — the one Pulse names — then to null without a stage (R10)', () => {
    // A finished league: Bo1 groups, Bo3 playoffs. Pulse names the playoffs,
    // so the plaques read Best-of 3, not the group stage's 1.
    const finished = [stage('completed', 1), stage('completed', 3)];
    expect(rulesCopyContext({ league: { format_type: 'singles' }, stages: finished })).toStrictEqual({
      format: 'singles',
      bestOf: 3,
    });
    expect(currentStage(finished)).toBe(finished[1]);
    expect(rulesCopyContext({ league: { format_type: 'doubles' }, stages: [] })).toStrictEqual({
      format: 'doubles',
      bestOf: null,
    });
    expect(currentStage([])).toBeNull();
  });

  it('a league that has not started reads its FIRST stage, not the playoffs created up front', () => {
    // Bo1 groups and Bo3 playoffs, both upcoming: the first matches played
    // are Bo1, so Pulse and every plaque name the group stage.
    const notStarted = [stage('upcoming', 1), stage('upcoming', 3)];
    expect(currentStage(notStarted)).toBe(notStarted[0]);
    expect(rulesCopyContext({ league: { format_type: 'singles' }, stages: notStarted })).toStrictEqual({
      format: 'singles',
      bestOf: 1,
    });
  });

  it('a league between stages reads the next stage to play, not the last one', () => {
    const between = [stage('completed', 1), stage('upcoming', 3), stage('upcoming', 5)];
    expect(currentStage(between)).toBe(between[1]);
    expect(rulesCopyContext({ league: { format_type: 'draft' }, stages: between })).toStrictEqual({
      format: 'draft',
      bestOf: 3,
    });
  });

  it('points the full rules at the league hub’s Rules tab', () => {
    expect(rulesHubHref('sakura-preview-season')).toBe(HUB_HREF);
  });
});

// ─── (c) #rules section and the ?rules=gate panel ─────────────────────────

function rulesSection(theme: Theme, data: ThemeRouteData): string {
  return render(<RulesSection data={data} copy={COPY[theme]} />);
}

function rulesPanel(theme: Theme, data: ThemeRouteData): string {
  return render(buildThemeOverlayMaps(data, COPY[theme].rulesCopy).rules.contents.gate);
}

const EPB_ONLY = [
  'Lines evolve through',
  'League defaults',
  'Configured for this league',
  'Draft budget',
  'Banned moves',
  'Tera',
  'Defaults',
];

describe.each(THEMES)('%s #rules and rules panel', (theme) => {
  it('the open fixture really is the stale-row case (singles season carrying the EPB row)', () => {
    const data = themeData(theme, 'open');
    expect(data.league.format_type).toBe('singles');
    expect(data.formatRules).not.toBeNull();
  });

  it.each([
    ['a stale row', 'populated'],
    ['no row', 'defaults'],
  ] as const)('non-EPB with %s: ruleset, format, best-of and the hub pointer only', (_label, scenario) => {
    const data = themeData(theme, 'open', scenario);
    const leagueId = data.league.id;
    const hub = `/leagues/${leagueId}?tab=rules#league-hub`;
    for (const html of [rulesSection(theme, data), rulesPanel(theme, data)]) {
      const body = text(html);
      for (const phrase of EPB_ONLY) expect(body).not.toContain(phrase);
      expect(body).toContain('Ruleset of record');
      expect(body).toContain(data.rulesetName ?? 'League Standard');
      expect(body).toMatch(/Format:? ?Singles/);
      expect(body).toMatch(/Best of:? ?3/);
      expect(body).toContain('Full rules');
      expect(body).toContain('Clauses, bans and custom rules for this league are in the league hub.');
      expect(hrefs(html)).toContain(hub);
    }
    expect(text(rulesSection(theme, data))).not.toContain(COPY[theme].rulesSpiritHeading);
  });

  it('a draft-format league names its format, not the EPB draft numbers', () => {
    const data = withFormat(themeData(theme, 'open'), 'draft');
    for (const html of [rulesSection(theme, data), rulesPanel(theme, data)]) {
      const body = text(html);
      expect(body).toMatch(/Format:? ?Draft/);
      for (const phrase of EPB_ONLY) expect(body).not.toContain(phrase);
    }
  });

  it('EPB keeps the draft rows, the evolution paragraph and the configured badge, with no hub pointer', () => {
    const data = themeData(theme, 'epb');
    const section = text(rulesSection(theme, data));
    expect(section).toContain('Configured for this league');
    expect(section).toContain('Lines evolve through');
    expect(section).toContain(COPY[theme].rulesSpiritHeading);
    expect(section).toContain(`Draft budget: ${BUDGET}`);
    expect(section).toContain('Defaults');
    expect(section).not.toContain('Full rules');
    const panel = text(rulesPanel(theme, data));
    expect(panel).toContain('Configured for this league');
    expect(panel).toContain('Draft budget');
    expect(panel).not.toContain('Full rules');
    for (const html of [rulesSection(theme, data), rulesPanel(theme, data)]) {
      expect(hrefs(html)).not.toContain(`/leagues/${data.league.id}?tab=rules#league-hub`);
    }
  });

  it('EPB without a row still says “League defaults” (the format decides, not the row)', () => {
    const data = themeData(theme, 'epb', 'defaults');
    expect(data.formatRules).toBeNull();
    for (const html of [rulesSection(theme, data), rulesPanel(theme, data)]) {
      const body = text(html);
      expect(body).toContain('League defaults');
      expect(body).toContain(DEFAULTS_NOTE);
      expect(body).toContain('Draft budget');
    }
  });
});

it('RulesPanel takes the context from its props, not from the row', () => {
  const html = render(
    <RulesPanel
      formatRules={epbRules()}
      rulesetName="Park Standard"
      rulesCopy={sakuraPlaqueCopy}
      context={{ format: 'doubles', bestOf: 1 }}
      leagueId="sakura-preview-season"
    />,
  );
  expect(text(html)).toContain('Doubles');
  expect(text(html)).not.toContain('Draft budget');
  expect(hrefs(html)).toEqual([HUB_HREF]);
});

describe('the section chrome follows the viewer (T19, i18n D11)', () => {
  it('a German viewer reads the #rules section and the gate panel in German', () => {
    const data = { ...themeData('sakura', 'open'), rulesetName: null };
    const section = text(render(<RulesSection data={data} copy={COPY.sakura} locale="de" />));
    expect(section).toContain('Geltendes Regelwerk');
    expect(section).toContain('Alle Regeln');
    expect(section).toContain('Zum Regeln-Tab');
    expect(section).toContain(noRulesetSuffix('de').trim());
    expect(section).toContain(fullRulesSentence(null, 'de'));
    const panel = text(
      render(buildThemeOverlayMaps(data, COPY.sakura.rulesCopy, { locale: 'de' }).rules.contents.gate),
    );
    expect(panel).toContain('Geltendes Regelwerk');
    expect(buildThemeOverlayMaps(data, COPY.sakura.rulesCopy, { locale: 'de' }).rules.titles.gate).toBe('Regelwerk');
  });

  it.each(['en', 'de'] as const)(
    'the EPB spirit paragraph takes the token names from the glossary (%s, i18n-core §10.4)',
    (locale) => {
      const glossary = createTranslator(glossaryMessages, locale);
      const section = text(
        render(<RulesSection data={themeData('sakura', 'epb')} copy={COPY.sakura} locale={locale} />),
      );
      for (const key of ['token.draftKill', 'token.comeback', 'token.cosmo'] as const) {
        expect(section).toContain(glossary(key));
      }
      expect(section).not.toMatch(/\{(draftKill|comeback|cosmo)\}/);
      expect(section).not.toContain('knocks');
    },
  );

  it('the format helpers name the format and best-of in the viewer’s language', () => {
    expect(formatRulesRows({ format: 'singles', bestOf: 3 }, 'de')).toStrictEqual({
      rows: [
        ['Format', 'Einzel'],
        ['Best-of', '3'],
      ],
      compactRows: [
        ['Modus', 'Einzel'],
        ['Best-of', '3'],
      ],
    });
    expect(rulesOfRecordName(null, { format: 'doubles', bestOf: null }, 'de')).toBe('Doppel');
    expect(noRulesetSuffix('en')).toBe(NO_RULESET_SUFFIX);
  });

  it('the shared Pulse section renders German chrome around the theme copy', () => {
    const data = themeData('sakura', 'epb');
    const pulse = text(render(<PulseSection data={data} copy={COPY.sakura} locale="de" />));
    expect(pulse).toContain(`${COPY.sakura.place} · Liga-Puls`);
    expect(pulse).toContain('Tabellenspitze');
    expect(pulse).toContain('Zum Draft-Raum');
    expect(pulse).not.toContain('Top of the table');
  });
});

// ─── (c2) No ruleset: truthful copy, the hub's own finding (5A-3) ─────────

describe.each(THEMES)('%s with no ruleset', (theme) => {
  const unnamed = (variant: Variant) => ({ ...themeData(theme, variant), rulesetName: null });

  it('non-EPB names the format, says no ruleset is assigned and promises no clauses', () => {
    const data = unnamed('open');
    for (const html of [rulesSection(theme, data), rulesPanel(theme, data)]) {
      const body = text(html);
      expect(body).not.toContain('League Standard');
      expect(body).not.toContain('derived from the season');
      expect(body).toContain(`Singles${NO_RULESET_SUFFIX}`);
      expect(body).toContain(fullRulesSentence(null));
      expect(body).not.toContain(fullRulesSentence('x'));
    }
  });

  it('EPB names Evolution Point Buy and says no ruleset is assigned; with a name, nothing changes', () => {
    const data = unnamed('epb');
    for (const html of [rulesSection(theme, data), rulesPanel(theme, data)]) {
      const body = text(html);
      expect(body).not.toContain('League Standard');
      expect(body).not.toContain('derived from the season');
      expect(body).toContain(`Evolution Point Buy${NO_RULESET_SUFFIX}`);
    }
    const named = themeData(theme, 'epb');
    expect(text(rulesSection(theme, named))).not.toContain(NO_RULESET_SUFFIX.trim());
    expect(rulesOfRecordName('Park Standard', EPB)).toBe('Park Standard');
  });
});

describe('the non-EPB plaque note describes the format plaque (R18e)', () => {
  it.each(THEMES)('%s', (theme) => {
    const body = text(rulesSection(theme, themeData(theme, 'open')));
    expect(body).toContain(COPY[theme].rulesFormatNote);
    expect(body).not.toContain(COPY[theme].rulesPlaqueNote);
    expect(COPY[theme].rulesFormatNote).toMatch(/format and best-of/);
    expect(COPY[theme].rulesFormatNote).not.toMatch(/bracket|rung/);
    // EPB keeps its ledger note.
    expect(text(rulesSection(theme, themeData(theme, 'epb')))).toContain(COPY[theme].rulesPlaqueNote);
  });
});

describe('station digest rules fact', () => {
  it('reports a draft budget for EPB only, never from a stale row on another format', () => {
    expect(stationDigestFacts(buildPreviewSakuraWorld('epb').data).rules.draftBudget).toBe(epbPack.defaults.draftBudget);
    const open = buildPreviewSakuraWorld('open').data;
    expect(open.formatRules?.draft_budget).toBe(epbPack.defaults.draftBudget);
    expect(stationDigestFacts(open).rules).toStrictEqual({
      rulesetName: open.rulesetName,
      draftBudget: null,
      format: 'singles',
    });
  });
});

// ─── (d0) Pulse and the rules surfaces name the same stage (R10) ───────────

describe('Pulse names the stage the rules surfaces read', () => {
  it('a finished league names its last stage on the English masthead, as on the plaza', () => {
    const data = themeData('sakura', 'open');
    const stages = data.stages.map((s, i) => ({ ...s, status: 'completed' as const, name: `Stage ${i + 1}` }));
    const html = render(<PulseSection data={{ ...data, stages }} copy={COPY.sakura} />);
    expect(stages.length).toBeGreaterThan(0);
    expect(text(html)).toContain(`Stage ${stages.length} ·`);
    expect(currentStage(stages)?.name).toBe(`Stage ${stages.length}`);
  });

  it('a league that has not started names its first stage and takes its best-of, on every surface', () => {
    const data = themeData('sakura', 'open');
    expect(data.stages.length).toBeGreaterThan(0);
    // Group stage Bo1 first, playoffs Bo3 created up front; nothing started.
    const groups = { ...data.stages[0], status: 'upcoming' as const, name: 'Group Stage', best_of_default: 1 };
    const playoffs = { ...data.stages[0], id: 'playoffs-stage', status: 'upcoming' as const, name: 'Playoffs', best_of_default: 3 };
    const notStarted = { ...data, stages: [groups, playoffs] };

    const pulse = text(render(<PulseSection data={notStarted} copy={COPY.sakura} />));
    expect(pulse).toContain('Group Stage ·');
    expect(pulse).not.toContain('Playoffs');

    const plaza = text(
      render(
        <EvoligaPulseSection
          league={notStarted.league}
          stages={notStarted.stages}
          standings={notStarted.standings}
          fixtures={notStarted.fixtures}
          hasDraftPool={notStarted.hasDraftPool}
          locale="de"
        />,
      ),
    );
    expect(plaza).toContain('Aktuelle Etappe Group Stage');

    const context = rulesCopyContext({ league: notStarted.league, stages: notStarted.stages });
    expect(context.bestOf).toBe(1);
    expect(formatRulesRows(context).rows).toContainEqual(['Best of', '1']);
    for (const theme of THEMES) {
      for (const body of [text(rulesSection(theme, notStarted)), text(rulesPanel(theme, notStarted))]) {
        expect(body).toMatch(/Best of:? ?1/);
        expect(body).not.toMatch(/Best of:? ?3/);
      }
    }
  });
});

// ─── (d) #pulse draft CTA follows the format ──────────────────────────────

describe('Pulse draft CTA', () => {
  const sakura = (variant: Variant) => themeData('sakura', variant);

  function sharedPulse(data: ThemeRouteData): string {
    return render(<PulseSection data={data} copy={COPY.sakura} />);
  }

  function evoligaPulse(data: ThemeRouteData): string {
    return render(
      <EvoligaPulseSection
        league={data.league}
        stages={data.stages}
        standings={data.standings}
        fixtures={data.fixtures}
        hasDraftPool={data.hasDraftPool}
        locale="de"
      />,
    );
  }

  it.each([
    ['shared', sharedPulse, 'Open the draft room'],
    ['EvoLiga', evoligaPulse, 'Draft-Raum'],
  ] as const)('%s: EPB with a pool opens the draft arena', (_name, pulse, label) => {
    const data = sakura('epb');
    expect(data.hasDraftPool).toBe(true);
    const html = pulse(data);
    expect(draftHrefs(html)).toEqual(['/leagues/sakura-preview-season/draft-room']);
    expect(text(html)).toContain(label);
  });

  it.each([
    ['shared', sharedPulse, 'Open the draft room'],
    ['EvoLiga', evoligaPulse, 'Draft-Raum'],
  ] as const)('%s: a draft-format league with a pool opens /draft, never the EPB-only arena', (_name, pulse, label) => {
    const html = pulse(withFormat(sakura('open'), 'draft', true));
    expect(draftHrefs(html)).toEqual(['/leagues/sakura-preview-season/draft']);
    expect(text(html)).toContain(label);
  });

  it.each([
    ['shared', sharedPulse, 'Open the draft room'],
    ['EvoLiga', evoligaPulse, 'Draft-Raum'],
  ] as const)('%s: singles or doubles with a pool row shows no CTA', (_name, pulse, label) => {
    for (const format of ['singles', 'doubles'] as const) {
      const html = pulse(withFormat(sakura('open'), format, true));
      expect(draftHrefs(html)).toEqual([]);
      expect(text(html)).not.toContain(label);
    }
  });

  it.each([
    ['shared', sharedPulse],
    ['EvoLiga', evoligaPulse],
  ] as const)('%s: no pool, no CTA, whatever the format', (_name, pulse) => {
    for (const format of ['evolution_point_buy', 'draft', 'singles'] as const) {
      expect(draftHrefs(pulse(withFormat(sakura('epb'), format, false)))).toEqual([]);
    }
  });
});
