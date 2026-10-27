import { rulesetLibraryEntry, rulesetPresetEntry } from '@/components/ruleset-studio/library-entries';
import PresetLibraryList from '@/components/ruleset-studio/starts/PresetLibraryList';
import RulesetLibraryList from '@/components/ruleset-studio/starts/RulesetLibraryList';
import type { Translator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import type { rulesetStudioMessages } from '@/i18n/messages/ruleset-studio';
import { groupRulesetPresets, listRulesetPresets } from '@/lib/pkmn/ruleset-preset-catalog';
import type { PresetSource } from '@/lib/pkmn/format-catalog';
import type { RulesetDefinitionSummary, RulesetPinCounts } from '@/lib/ruleset-studio/library-types';

const SOURCES: readonly { source: PresetSource; heading: 'presetsShowdown' | 'presetsDraft' }[] = [
  { source: 'showdown', heading: 'presetsShowdown' },
  { source: 'smogon-draft', heading: 'presetsDraft' },
];

/** One list of the gallery: the rows shown and how many exist (the list is capped). */
export interface GalleryList {
  items: readonly RulesetDefinitionSummary[];
  total: number;
}

export interface RulesetsGalleryViewProps {
  t: Translator<typeof rulesetStudioMessages.en>;
  locale: Locale;
  /** The viewer's own rulesets, the ones made for a league among them. */
  mine: GalleryList;
  /** The custom rulesets other admins shared. */
  shared: GalleryList;
  /** The site catalog (preset-kind rulesets). */
  site: GalleryList;
  /** Leagues and phases per definition id (counts only); a definition without an entry prints no usage line. */
  usage: ReadonlyMap<string, RulesetPinCounts>;
  /** `PRESET_RULES_VERSION` of the running app, to flag versions computed from older catalog data. */
  catalogVersion: string;
  /** The cap each list was read with (for the "showing the first N" notes). */
  limit: number;
}

/**
 * The sections of `/admin/rulesets` below the page title: the viewer's rulesets, the shared ones, the viewer's own that belong to a league,
 * the catalog of rule presets and the site catalog. Pure over already-read lists and an already-built translator, so the
 * page reads and gates, and the dev preview (`/ruleset-preview/surfaces`) renders the same sections over fixtures.
 */
export default function RulesetsGalleryView({ t, locale, mine, shared, site, usage, catalogVersion, limit }: RulesetsGalleryViewProps) {
  const extrasFor = (item: { id: string }) => ({ usage: usage.get(item.id), catalogVersion });
  const own = mine.items.filter((item) => item.season_id === null);
  const leagueOwned = mine.items.filter((item) => item.season_id !== null);
  const presets = listRulesetPresets();
  const empty = (text: string) => <p className="text-poke-text-muted">{text}</p>;
  const heading = (id: string, text: string) => (
    <h2 id={id} className="font-heading text-lg font-bold text-poke-text-primary">
      {text}
    </h2>
  );

  return (
    <>
      <section className="space-y-3" aria-labelledby="rulesets-yours">
        {heading('rulesets-yours', t('list.yours'))}
        <p className="text-sm text-poke-text-secondary">{t('list.yoursIntro')}</p>
        <RulesetLibraryList entries={own.map((item) => rulesetLibraryEntry(item, locale, t, true, extrasFor(item)))} empty={empty(t('list.emptyYours'))} />
        {mine.total > mine.items.length && <p className="text-sm text-poke-text-muted">{t('list.capNote', { count: limit })}</p>}
      </section>

      <section className="space-y-3" aria-labelledby="rulesets-shared">
        {heading('rulesets-shared', t('list.shared'))}
        <p className="text-sm text-poke-text-secondary">{t('list.sharedIntro')}</p>
        <RulesetLibraryList fork entries={shared.items.map((item) => rulesetLibraryEntry(item, locale, t, false, extrasFor(item)))} empty={empty(t('list.emptyShared'))} />
        {shared.total > shared.items.length && <p className="text-sm text-poke-text-muted">{t('list.capNote', { count: limit })}</p>}
      </section>

      {leagueOwned.length > 0 && (
        <section className="space-y-3" aria-labelledby="rulesets-leagues">
          {heading('rulesets-leagues', t('page.leagues'))}
          <p className="text-sm text-poke-text-secondary">{t('page.leaguesIntro')}</p>
          <RulesetLibraryList entries={leagueOwned.map((item) => rulesetLibraryEntry(item, locale, t, true, extrasFor(item)))} empty={null} />
        </section>
      )}

      <section className="space-y-3" aria-labelledby="rulesets-presets">
        {heading('rulesets-presets', t('presets.heading'))}
        <p className="text-sm text-poke-text-secondary">{t('presets.intro')}</p>
        {SOURCES.map(({ source, heading: key }) => {
          const ofSource = presets.filter((preset) => preset.source === source);
          const groups = groupRulesetPresets(ofSource);
          return (
            <details key={source} className="rounded-poke-lg border border-poke-border bg-poke-surface">
              <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 px-4 font-heading font-semibold text-poke-text-primary">
                {t(`page.${key}`)}
                <span className="text-sm font-normal text-poke-text-muted">{t('page.presetsCount', { count: ofSource.length })}</span>
              </summary>
              <div className="space-y-6 border-t border-poke-border p-4">
                {groups.map((group) => (
                  <div key={group.key} className="space-y-2">
                    <h3 className="text-sm font-semibold text-poke-text-secondary">{group.genLabel}</h3>
                    <PresetLibraryList
                      empty={null}
                      presets={group.presets.map((preset) => ({ entry: rulesetPresetEntry(preset, t), tourOverlay: preset.tourOverlay }))}
                    />
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </section>

      <section className="space-y-3" aria-labelledby="rulesets-site">
        <details className="rounded-poke-lg border border-poke-border bg-poke-surface">
          <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 px-4 font-heading font-semibold text-poke-text-primary">
            <span id="rulesets-site">{t('page.site')}</span>
            <span className="text-sm font-normal text-poke-text-muted">{t('page.presetsCount', { count: site.total })}</span>
          </summary>
          <div className="space-y-3 border-t border-poke-border p-4">
            <p className="text-sm text-poke-text-secondary">{t('page.siteIntro')}</p>
            <RulesetLibraryList fork entries={site.items.map((item) => rulesetLibraryEntry(item, locale, t, false, extrasFor(item)))} empty={empty(t('page.emptySite'))} />
            {site.total > site.items.length && <p className="text-sm text-poke-text-muted">{t('list.capNote', { count: limit })}</p>}
          </div>
        </details>
      </section>
    </>
  );
}
