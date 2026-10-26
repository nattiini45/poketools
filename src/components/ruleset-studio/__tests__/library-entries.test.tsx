import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { expectNoLeftovers, expectUniqueIds } from '@/test/markup';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { rulesetStudioMessages } from '@/i18n/messages/ruleset-studio';
import { listRulesetPresets } from '@/lib/format-kit/client';
import type { RulesetDefinitionSummary } from '@/lib/ruleset-studio/library-types';
import { ltext } from '@/lib/studio-core/ltext';

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import LibraryList from '@/components/studio-shell/library/LibraryList';
import { rulesetEditorHref, rulesetPresetHref, rulesetReadOnlyHref } from '../hrefs';
import { rulesetLibraryEntry, rulesetPresetEntry } from '../library-entries';
import ForkPresetButton from '../starts/ForkPresetButton';
import RulesetLibraryList from '../starts/RulesetLibraryList';

const summary = (over: Partial<RulesetDefinitionSummary> = {}): RulesetDefinitionSummary => ({
  id: 'r1',
  slug: 'core-liga-ou',
  name: ltext('en', 'Core Liga OU', 'Core Liga OU (DE)'),
  description: ltext('en', 'The league rules'),
  kind: 'custom',
  visibility: 'private',
  season_id: null,
  forked_from: null,
  draft_rev: 2,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-02T10:00:00Z',
  owner: { id: 'p1', name: 'Alex' },
  current_version: null,
  ...over,
});

/** A published head version; the catalog version defaults to the current one and the base to a catalog preset. */
const version = (no: number, over: Partial<NonNullable<RulesetDefinitionSummary['current_version']>> = {}) => ({
  id: `v${no}`,
  version_no: no,
  content_hash: 'h',
  created_at: '2026-10-01T10:00:00Z',
  catalog_version: CATALOG,
  base_preset: 'gen9ou' as string | null,
  ...over,
});
const CATALOG = '2026-10-26.1';

const t = (locale: Locale) => createTranslator(rulesetStudioMessages, locale);
const labels = (entry: ReturnType<typeof rulesetLibraryEntry>) => entry.badges.map((badge) => badge.label);

describe('the addresses', () => {
  it('encode the id and keep the three pages apart', () => {
    expect(rulesetReadOnlyHref('a/b')).toBe('/admin/rulesets/a%2Fb');
    expect(rulesetEditorHref('abc')).toBe('/admin/rulesets/abc/edit');
    expect(rulesetPresetHref('gen9ou')).toBe('/admin/rulesets/catalog/gen9ou');
  });
});

describe('rulesetLibraryEntry', () => {
  it('a private draft of your own opens the editor and shows only the Draft badge', () => {
    const entry = rulesetLibraryEntry(summary(), 'en', t('en'), true);
    expect(entry).toMatchObject({ id: 'r1', href: '/admin/rulesets/r1/edit', title: 'Core Liga OU', openLabel: 'Edit' });
    expect(labels(entry)).toEqual(['Draft']);
    expect(entry.lines).toEqual(['The league rules']);
  });

  it('a published ruleset shows its version, a shared one says so', () => {
    const entry = rulesetLibraryEntry(
      summary({ visibility: 'league', current_version: version(3) }),
      'en',
      t('en'),
      true,
    );
    expect(labels(entry)).toEqual(['Published v3', 'Shared with league admins']);
  });

  it('marks the gallery, a league ruleset and a site catalog ruleset', () => {
    const published = version(1);
    expect(labels(rulesetLibraryEntry(summary({ visibility: 'gallery', current_version: published }), 'en', t('en'), false))).toContain('In the gallery');
    expect(labels(rulesetLibraryEntry(summary({ season_id: 's1', current_version: published }), 'en', t('en'), true))).toContain('League ruleset');
    expect(labels(rulesetLibraryEntry(summary({ kind: 'preset', owner: null, current_version: published }), 'en', t('en'), false))).toContain('Site catalog');
  });

  it("somebody else's ruleset opens the read-only page and names its owner", () => {
    const entry = rulesetLibraryEntry(summary({ description: null }), 'en', t('en'), false);
    expect(entry).toMatchObject({ href: '/admin/rulesets/r1', openLabel: 'Open' });
    expect(entry.lines).toEqual(['By Alex']);
  });

  it('shows the name and the words in the viewer language', () => {
    const entry = rulesetLibraryEntry(summary(), 'de', t('de'), true);
    expect(entry.title).toBe('Core Liga OU (DE)');
    expect(entry.openLabel).toBe('Bearbeiten');
    expect(labels(entry)).toEqual(['Entwurf']);
  });

  it('an ownerless ruleset has no "By" line and the slug stands in for a missing name', () => {
    const entry = rulesetLibraryEntry(summary({ owner: null, description: null, name: {} as never }), 'en', t('en'), false);
    expect(entry.lines).toEqual([]);
    expect(entry.title).toBe('core-liga-ou');
  });
});

describe('rulesetLibraryEntry usage and catalog badge', () => {
  it('a published ruleset says how many leagues and phases use it, in the viewer language', () => {
    const item = summary({ current_version: version(2) });
    expect(rulesetLibraryEntry(item, 'en', t('en'), true, { usage: { seasons: 2, tournaments: 3 } }).lines).toContain('Used by 2 leagues, 3 phases.');
    expect(rulesetLibraryEntry(item, 'en', t('en'), true, { usage: { seasons: 1, tournaments: 0 } }).lines).toContain('Used by 1 league.');
    expect(rulesetLibraryEntry(item, 'en', t('en'), true, { usage: { seasons: 0, tournaments: 1 } }).lines).toContain('Used by 1 phase.');
    expect(rulesetLibraryEntry(item, 'en', t('en'), true, { usage: { seasons: 0, tournaments: 0 } }).lines).toContain('Not used by a league or phase yet.');
    expect(rulesetLibraryEntry(item, 'de', t('de'), true, { usage: { seasons: 2, tournaments: 1 } }).lines).toContain('Genutzt von 2 Ligen, 1 Phase.');
  });

  it('prints no usage line without counts, and none for a draft that cannot be pinned', () => {
    expect(rulesetLibraryEntry(summary({ current_version: version(1) }), 'en', t('en'), true).lines).toEqual(['The league rules']);
    expect(rulesetLibraryEntry(summary(), 'en', t('en'), true, { usage: { seasons: 4, tournaments: 4 } }).lines).toEqual(['The league rules']);
  });

  it('flags a version computed from older catalog data when it is based on a preset, and tells the editor what to do', () => {
    const stale = summary({ current_version: version(2, { catalog_version: '2026-09-01.1' }) });
    const own = rulesetLibraryEntry(stale, 'en', t('en'), true, { catalogVersion: CATALOG });
    expect(own.badges).toContainEqual({ label: 'Catalog updated', variant: 'yellow' });
    expect(own.lines.some((line) => line.includes('publish it again'))).toBe(true);

    // Somebody who cannot edit it gets the badge, not the instruction.
    const other = rulesetLibraryEntry(stale, 'en', t('en'), false, { catalogVersion: CATALOG });
    expect(labels(other)).toContain('Catalog updated');
    expect(other.lines.some((line) => line.includes('publish it again'))).toBe(false);

    expect(labels(rulesetLibraryEntry(stale, 'de', t('de'), true, { catalogVersion: CATALOG }))).toContain('Katalog aktualisiert');
  });

  it('shows no catalog badge for a current version, a blank base, a legacy version or an unknown catalog version', () => {
    const badge = (current_version: RulesetDefinitionSummary['current_version'], catalogVersion: string | undefined) =>
      labels(rulesetLibraryEntry(summary({ current_version }), 'en', t('en'), true, { catalogVersion })).includes('Catalog updated');
    expect(badge(version(1), CATALOG)).toBe(false);
    expect(badge(version(1, { catalog_version: 'old', base_preset: null }), CATALOG)).toBe(false);
    expect(badge(version(1, { catalog_version: 'legacy', base_preset: null }), CATALOG)).toBe(false);
    expect(badge(version(1, { catalog_version: 'old' }), undefined)).toBe(false);
  });
});

describe('rulesetPresetEntry', () => {
  it('gives every catalog preset a card that opens its read-only page', () => {
    const entries = listRulesetPresets().map((preset) => rulesetPresetEntry(preset, t('en')));
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.href).toBe(`/admin/rulesets/catalog/${entry.id}`);
      expect(entry.badges[0]).toEqual({ label: 'Rule preset', variant: 'accent' });
    }
  });

  it('marks the Smogon draft presets and names generation and tier', () => {
    const presets = listRulesetPresets();
    const draft = presets.find((preset) => preset.id === 'gen9natdexdraft');
    const ou = presets.find((preset) => preset.id === 'gen9ou');
    if (draft === undefined || ou === undefined) throw new Error('catalog presets missing');
    expect(rulesetPresetEntry(draft, t('en')).badges.map((badge) => badge.label)).toEqual(['Rule preset', 'Smogon draft']);
    expect(rulesetPresetEntry(ou, t('en'))).toMatchObject({ title: 'Gen 9 OU', lines: ['Gen 9 (SV) · OU'] });
    expect(rulesetPresetEntry(ou, t('en')).badges).toHaveLength(1);
  });
});

describe('the lists', () => {
  const entries = [rulesetLibraryEntry(summary(), 'en', t('en'), true), rulesetLibraryEntry(summary({ id: 'r2', slug: 'second' }), 'en', t('en'), false)];

  it('render a card per entry with its badges and open label, and unique ids', () => {
    const html = renderWithI18n(<LibraryList entries={entries} empty={<p>none</p>} />);
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html).toContain('href="/admin/rulesets/r1/edit"');
    expect(html).toContain('>Draft<');
    expect(html).not.toContain('<p>none</p>');
    expectUniqueIds(html);
    expectNoLeftovers(html);
  });

  it('show the empty slot instead of the list', () => {
    expect(renderWithI18n(<LibraryList entries={[]} empty={<p>none</p>} />)).toBe('<p>none</p>');
  });

  it('the ruleset list puts a Fork button beside each card, never inside its link, only when asked', () => {
    const withFork = renderWithI18n(<RulesetLibraryList entries={entries} fork empty={null} />);
    expect(withFork.match(/>Fork</g)).toHaveLength(2);
    expect(withFork).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*<button/s);
    const without = renderWithI18n(<RulesetLibraryList entries={entries} empty={null} />);
    expect(without).not.toContain('>Fork<');
  });
});

describe('ForkPresetButton', () => {
  it('offers "use as a starting point" with a hint, or the tour variant without one', () => {
    const plain = renderWithI18n(<ForkPresetButton presetId="gen9ou" />);
    expect(plain).toContain('>Use as a starting point<');
    expect(plain).toContain('Your copy is private.');
    const tour = renderWithI18n(<ForkPresetButton presetId="gen9natdexdraft" tourOverlay />);
    expect(tour).toContain('>Use with Smogon tour bans<');
    expect(tour).not.toContain('Your copy is private.');
  });

  it.each(['en', 'de'] as const)('speaks the viewer language (%s)', (locale) => {
    const html = renderWithI18n(<ForkPresetButton presetId="gen9ou" />, { locale });
    expect(html).toContain(t(locale)('presets.fork'));
  });
});
