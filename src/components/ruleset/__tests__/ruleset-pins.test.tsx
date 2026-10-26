/**
 * The ruleset select of the league, phase and tournament forms, the pin card and the usage panel, in static markup and in both
 * languages. A league or phase pins a version of a ruleset: the select must show the version a form holds (even an old one),
 * the card must offer the update only while the target can still take it, and the usage panel must show names only to the
 * audience the server gave them to. Requests (`POST .../pins`) are covered by the route tests and the request-layer test.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { esc, expectLabelledControls, expectNoLeftovers, expectUniqueIds } from '@/test/markup';
import { makeRulesetOption } from '@/test/ruleset-fixtures';
import type { RulesetUsage } from '@/lib/ruleset-studio/library-types';
import type { PinChangeSummary, RulesetPinInfo } from '@/lib/ruleset-studio/pin-info';
import { groupRulesetOptions } from '../ruleset-options';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import RulesetPinCard from '../RulesetPinCard';
import RulesetSelect from '../RulesetSelect';
import UsagePanel from '../UsagePanel';

const OU2 = makeRulesetOption({ id: 'ou-v2', definition_id: 'def-ou', name: 'Spring OU', version_no: 2 });
const OU1 = makeRulesetOption({ id: 'ou-v1', definition_id: 'def-ou', name: 'Spring OU', version_no: 1 });
const LC = makeRulesetOption({ id: 'lc', definition_id: 'def-lc', name: 'Little Cup', base_format: 'gen8lc' });
const GEN8 = makeRulesetOption({ id: 'g8', definition_id: 'def-g8', name: 'Old OU', base_format: 'gen8ou' });

describe('groupRulesetOptions', () => {
  it('groups by generation, newest first, then by name; an older version of a listed ruleset is marked', () => {
    const groups = groupRulesetOptions([LC, OU1, GEN8, OU2]);
    expect(groups.map((g) => g.gen)).toEqual([9, 8]);
    expect(groups[0].options.map((o) => [o.option.id, o.older])).toEqual([
      ['ou-v2', false],
      ['ou-v1', true],
    ]);
    expect(groups[1].options.map((o) => o.option.name)).toEqual(['Little Cup', 'Old OU']);
  });

  it('puts doubles rulesets in a group of their own after the singles of the same generation', () => {
    const doubles = makeRulesetOption({ id: 'dbl', definition_id: 'def-dbl', name: 'Spring Doubles', is_doubles: true });
    const groups = groupRulesetOptions([doubles, LC, GEN8, OU2]);
    expect(groups.map((g) => [g.gen, g.doubles])).toEqual([[9, false], [9, true], [8, false]]);
    expect(groups[1].options.map((o) => o.option.id)).toEqual(['dbl']);
    // A singles ruleset never lands in the doubles group of its generation, nor the other way round.
    expect(groups[0].options.map((o) => o.option.id)).toEqual(['ou-v2']);
    expect(groups[2].options.map((o) => o.option.id)).toEqual(['lc', 'g8']);
  });

  it('a ruleset whose only listed version is old is not "older": there is nothing newer to compare with', () => {
    expect(groupRulesetOptions([OU1])[0].options[0].older).toBe(false);
  });
});

describe('RulesetSelect', () => {
  const render = (value: string, locale: 'en' | 'de' = 'en', options = [OU2, OU1, LC, GEN8]) =>
    renderWithI18n(<RulesetSelect id="league-ruleset" label="Ruleset" value={value} onChange={() => undefined} options={options} placeholder="No ruleset" />, { locale });

  it('is a labelled select with an empty option, optgroups by generation and the version in the option text', () => {
    const html = render('ou-v2');
    expectLabelledControls(html);
    expectUniqueIds(html);
    expectNoLeftovers(html);
    expect(html).toContain('<option value="">No ruleset</option>');
    expect(html).toContain('<optgroup label="Generation 9">');
    expect(html).toContain('<optgroup label="Generation 8">');
    // Version 1 is just the name; from the second version on the number follows it.
    expect(html).toContain('>Spring OU v2</option>');
    expect(html).toContain('>Little Cup</option>');
  });

  it('labels the doubles group, so a doubles ruleset is never mistaken for its singles twin', () => {
    const doubles = makeRulesetOption({ id: 'dbl', definition_id: 'def-dbl', name: 'Spring OU', is_doubles: true });
    const html = render('', 'en', [OU2, doubles]);
    expect(html).toContain('<optgroup label="Generation 9">');
    expect(html).toContain('<optgroup label="Generation 9 · Doubles">');
    expect(render('', 'de', [OU2, doubles])).toContain('<optgroup label="Generation 9 · Doppel">');
  });

  it('shows the version a form pins even when it is no longer the newest', () => {
    const html = render('ou-v1');
    expect(html).toContain('>Spring OU v1 (older version)</option>');
    expect(html).toMatch(/<option value="ou-v1" selected="">/);
  });

  it('links to the Ruleset Studio, and leaves the link out for a locked select', () => {
    expect(render('')).toContain('href="/admin/rulesets"');
    const locked = renderWithI18n(
      <RulesetSelect id="t" label="Ruleset" value="" onChange={() => undefined} options={[LC]} placeholder="Pick" studioLink={false} disabled />,
    );
    expect(locked).not.toContain('/admin/rulesets');
  });

  it('speaks German', () => {
    const html = render('ou-v1', 'de');
    expect(html).toContain('Generation 9');
    expect(html).toContain('(ältere Version)');
    expect(html).toContain('Regelwerk-Studio öffnen');
  });
});

const NO_CHANGE: PinChangeSummary = { banned: 0, unbanned: 0, allowed: 0, disallowed: 0, clausesAdded: 0, clausesRemoved: 0, modeChanged: false, otherChanged: false };
const PIN: RulesetPinInfo = {
  definition_id: 'def-ou',
  name: 'Spring OU',
  version_id: 'ou-v1',
  version_no: 1,
  update: { version_no: 3, change: { ...NO_CHANGE, banned: 3, unbanned: 1 } },
  can_view: true,
};
const TARGET = { kind: 'season' as const, id: 'season-1', name: 'Summer League', status: 'upcoming' };

describe('RulesetPinCard', () => {
  const render = (pin: RulesetPinInfo, status = 'upcoming', locale: 'en' | 'de' = 'en', kind: 'season' | 'tournament' | 'standalone' = 'season') =>
    renderWithI18n(<RulesetPinCard kind={kind} target={{ ...TARGET, status }} pin={pin} />, { locale });

  it('before the start: names the version, says what changes and offers the one-click update', () => {
    const html = render(PIN);
    expectNoLeftovers(html);
    expectUniqueIds(html);
    expect(html).toContain('Spring OU, version 1');
    expect(html).toContain('Version 3 is available.');
    expect(html).toContain('3 more banned, 1 no longer banned');
    expect(html).toContain('Update to version 3');
    expect(html).toContain('href="/admin/rulesets/def-ou"');
  });

  it('shows no link to a ruleset the viewer may not open', () => {
    expect(render({ ...PIN, can_view: false })).not.toContain('href="/admin/rulesets/def-ou"');
  });

  it('when the versions enforce the same, says so instead of printing an empty change list', () => {
    const html = render({ ...PIN, update: { version_no: 2, change: NO_CHANGE } });
    expect(html).toContain('The rules are the same.');
    expect(html).not.toContain('What changes');
  });

  it('on the newest version there is nothing to update', () => {
    const html = render({ ...PIN, version_no: 3, update: null });
    expect(html).toContain('This is the latest version.');
    expect(html).not.toContain('<button');
  });

  it('a finished league, phase or tournament is read-only and says why, in its own words', () => {
    for (const [kind, word] of [['season', 'league'], ['tournament', 'phase'], ['standalone', 'tournament']] as const) {
      const html = render(PIN, 'completed', 'en', kind);
      expect(html).toContain(`This ${word} is finished, so its ruleset can no longer change.`);
      expect(html).not.toContain('Update to version');
    }
  });

  it('a running target still offers the update; the confirmation dialog opens from the button', () => {
    expect(render(PIN, 'active')).toContain('Update to version 3');
  });

  it('speaks German', () => {
    const html = render(PIN, 'upcoming', 'de');
    expect(html).toContain(esc('Spring OU, Version 1'));
    expect(html).toContain('Version 3 ist verfügbar.');
    expect(html).toContain('3 mehr gebannt, 1 nicht mehr gebannt');
    expect(html).toContain('Auf Version 3 aktualisieren');
  });
});

const NAMED: RulesetUsage = {
  counts: [
    { version_no: 1, seasons: 1, tournaments: 0 },
    { version_no: 2, seasons: 0, tournaments: 2 },
  ],
  targets: [
    { kind: 'season', id: 's1', name: 'Summer League', season_id: null, version_id: 'v1', version_no: 1, status: 'active' },
    { kind: 'tournament', id: 't1', name: 'Group Stage', season_id: 's9', version_id: 'v2', version_no: 2, status: 'upcoming' },
    { kind: 'tournament', id: 't2', name: 'Finals', season_id: 's9', version_id: 'v1', version_no: 1, status: 'completed' },
    { kind: 'tournament', id: 't3', name: 'Playoffs', season_id: 's9', version_id: 'v1', version_no: 1, status: 'upcoming' },
  ],
};

describe('UsagePanel', () => {
  const render = (usage: RulesetUsage, latest: number | null = 2, locale: 'en' | 'de' = 'en') =>
    renderWithI18n(<UsagePanel definitionId="def-ou" usage={usage} latestVersionNo={latest} />, { locale });

  it('counts per version for everyone, with the plural forms', () => {
    const html = render({ ...NAMED, targets: null });
    expectNoLeftovers(html);
    expect(html).toContain('1 league');
    expect(html).toContain('2 phases');
    expect(html).toContain('You can see how many leagues and phases use each version, not which ones.');
    expect(html).not.toContain('<input');
  });

  it('names the targets for the audience that got names: a checkbox each, only for those that can move', () => {
    const html = render(NAMED);
    expectLabelledControls(html);
    expectUniqueIds(html);
    const box = (id: string) => new RegExp(`<input[^>]*id="usage-${id}"[^>]*>`).exec(html)?.[0] ?? '';
    // On version 1 and running: selectable. Already on the newest version, or finished: disabled.
    expect(box('season-s1')).not.toContain('disabled');
    expect(box('tournament-t1')).toContain('disabled');
    expect(box('tournament-t2')).toContain('disabled');
    expect(box('tournament-t3')).not.toContain('disabled');
    expect(html).toContain('running');
    expect(html).toContain('finished');
    expect(html).toContain('Update selected to version 2');
  });

  it('without a published version there is nothing to move to', () => {
    const html = render(NAMED, null);
    expect(html).not.toContain('Update selected');
    expect(html).toMatch(/<input[^>]*disabled/);
  });

  it('an unused ruleset says so', () => {
    expect(render({ counts: [], targets: [] })).toContain('No league or phase uses this ruleset yet.');
  });

  it('speaks German', () => {
    const html = render(NAMED, 2, 'de');
    expect(html).toContain('Wo es genutzt wird');
    expect(html).toContain('Auswahl auf Version 2 aktualisieren');
    expect(html).toContain('läuft');
    expect(html).toContain('beendet');
  });
});
