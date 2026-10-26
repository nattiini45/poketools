/**
 * The cards of the ruleset gallery as plain data: a stored ruleset or a catalog rule preset mapped to a `LibraryEntry`
 * (the shared card list of `studio-shell/library`). Pure, so a server page renders them with the translator it already
 * has and the tests check the badges without a DOM.
 */
import type { Translator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import type { rulesetStudioMessages } from '@/i18n/messages/ruleset-studio';
import { resolveLText, type RulesetPresetEntry } from '@/lib/format-kit/client';
import type { RulesetDefinitionSummary, RulesetPinCounts } from '@/lib/ruleset-studio/library-types';
import { isCatalogStale } from '@/lib/ruleset-studio/staleness';
import type { LibraryEntry } from '@/components/studio-shell/library/LibraryList';
import { rulesetEditorHref, rulesetPresetHref, rulesetReadOnlyHref } from './hrefs';

type LibraryT = Translator<typeof rulesetStudioMessages.en>;

/** What a card shows besides the definition row: who pins it, and the catalog version to test the published version against. */
export interface RulesetEntryExtras {
  /** Leagues and phases that pin a version of the ruleset; omitted, the card prints no usage line. */
  usage?: RulesetPinCounts;
  /** `PRESET_RULES_VERSION` of the running app; omitted, the card shows no catalog badge. */
  catalogVersion?: string;
}

/** "Used by 2 leagues, 3 phases", or that nobody uses the ruleset yet. */
function usageLine(counts: RulesetPinCounts, t: LibraryT): string {
  if (counts.seasons === 0 && counts.tournaments === 0) return t('list.usage.none');
  const parts = [
    counts.seasons > 0 ? t('list.usage.leagues', { count: counts.seasons }) : null,
    counts.tournaments > 0 ? t('list.usage.phases', { count: counts.tournaments }) : null,
  ].filter((part): part is string => part !== null);
  return t('list.usage.used', { what: parts.join(', ') });
}

/**
 * One card of a list of stored rulesets: its name, state badges and where it leads. `own` is a ruleset the viewer may edit
 * (the card opens the editor); any other card opens the read-only page. A published ruleset also says who uses it
 * (`extras.usage`), and one whose published version was computed from older catalog data than the app has now carries a
 * "Catalog updated" badge (`extras.catalogVersion`), with the way out written under the title for those who can edit it.
 */
export function rulesetLibraryEntry(
  item: RulesetDefinitionSummary,
  locale: Locale,
  t: LibraryT,
  own: boolean,
  extras: RulesetEntryExtras = {},
): LibraryEntry {
  const description = item.description === null ? '' : (resolveLText(item.description, { viewer: locale })?.value ?? '');
  const badges: LibraryEntry['badges'][number][] = [
    item.current_version === null
      ? { label: t('list.state.draft'), variant: 'gray' }
      : { label: t('list.state.published', { n: item.current_version.version_no }), variant: 'green' },
  ];
  if (item.visibility === 'league') badges.push({ label: t('list.state.shared'), variant: 'blue' });
  if (item.visibility === 'gallery') badges.push({ label: t('list.state.gallery'), variant: 'accent' });
  if (item.season_id !== null) badges.push({ label: t('list.state.league'), variant: 'gray' });
  if (item.kind === 'preset') badges.push({ label: t('list.state.site'), variant: 'gray' });
  const stale =
    item.current_version !== null && extras.catalogVersion !== undefined && isCatalogStale(item.current_version, extras.catalogVersion);
  if (stale) badges.push({ label: t('list.state.stale'), variant: 'yellow' });
  return {
    id: item.id,
    href: own ? rulesetEditorHref(item.id) : rulesetReadOnlyHref(item.id),
    title: resolveLText(item.name, { viewer: locale })?.value ?? item.slug,
    lines: [
      description,
      !own && item.owner !== null ? t('list.by', { name: item.owner.name }) : '',
      item.current_version !== null && extras.usage !== undefined ? usageLine(extras.usage, t) : '',
      stale && own ? t('list.staleHint') : '',
    ].filter((line) => line !== ''),
    badges,
    openLabel: own ? t('list.edit') : t('list.open'),
  };
}

/** One card of the catalog of rule presets: the preset's own name, its generation and tier, and where it leads. */
export function rulesetPresetEntry(preset: RulesetPresetEntry, t: LibraryT): LibraryEntry {
  const badges: LibraryEntry['badges'][number][] = [{ label: t('presets.badge'), variant: 'accent' }];
  if (preset.source === 'smogon-draft') badges.push({ label: t('presets.draftBadge'), variant: 'blue' });
  return {
    id: preset.id,
    href: rulesetPresetHref(preset.id),
    title: preset.name,
    lines: [`${preset.genLabel} · ${preset.tierLabel}`],
    badges,
    openLabel: t('presets.open'),
  };
}
