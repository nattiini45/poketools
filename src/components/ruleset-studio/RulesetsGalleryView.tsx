import type { ReactNode } from 'react';
import AdminEmpty from '@/components/admin/AdminEmpty';
import GalleryTabs, { GalleryPanel } from '@/components/studio-shell/library/GalleryTabs';
import { rulesetLibraryEntry, rulesetPresetEntry } from '@/components/ruleset-studio/library-entries';
import PresetLibraryList from '@/components/ruleset-studio/starts/PresetLibraryList';
import RulesetLibraryList from '@/components/ruleset-studio/starts/RulesetLibraryList';
import type { Translator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import type { rulesetStudioMessages } from '@/i18n/messages/ruleset-studio';
import { groupRulesetPresets, listRulesetPresets } from '@/lib/pkmn/ruleset-preset-catalog';
import type { PresetSource } from '@/lib/pkmn/format-catalog';
import type { RulesetDefinitionSummary, RulesetPinCounts } from '@/lib/ruleset-studio/library-types';

const SOURCES: readonly { source: PresetSource; heading: 'presetsShowdown' | 'presetsDraft' | 'presetsCommunity' }[] = [
  { source: 'showdown', heading: 'presetsShowdown' },
  { source: 'smogon-draft', heading: 'presetsDraft' },
  { source: 'poketools', heading: 'presetsCommunity' },
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
  /** The "New ruleset" button shown in the empty state of the Yours tab. */
  newAction?: ReactNode;
}

/**
 * The tabs of `/admin/rulesets` below the page title: Yours (the viewer's rulesets and the ones that belong to a league), Shared
 * (the custom rulesets other admins shared) and Examples (the catalog of rule presets and the site catalog). Pure over already-read lists and an already-built translator, so the
 * page reads and gates, and the dev preview (`/ruleset-preview/surfaces`) renders the same sections over fixtures.
 */
export default function RulesetsGalleryView({ t, locale, mine, shared, site, usage, catalogVersion, limit, newAction }: RulesetsGalleryViewProps) {
  const extrasFor = (item: { id: string }) => ({ usage: usage.get(item.id), catalogVersion });
  const own = mine.items.filter((item) => item.season_id === null);
  const leagueOwned = mine.items.filter((item) => item.season_id !== null);
  const presets = listRulesetPresets();
  const heading = (id: string, text: string) => (
    <h2 id={id} className="font-heading text-title text-fg">
      {text}
    </h2>
  );
  const disclosure = 'rounded-poke-lg border border-hairline bg-surface';
  const summaryRow = 'flex min-h-11 cursor-pointer flex-wrap items-center gap-2 px-4 font-heading font-semibold text-fg';

  return (
    <GalleryTabs label={t('tabs.label')} glideId="ruleset-gallery">
      <GalleryPanel id="yours" label={t('tabs.yours')} count={mine.total}>
        <section className="space-y-3" aria-labelledby="rulesets-yours">
          {heading('rulesets-yours', t('list.yours'))}
          <p className="text-body text-fg-muted">{t('list.yoursIntro')}</p>
          <RulesetLibraryList
            entries={own.map((item) => rulesetLibraryEntry(item, locale, t, true, extrasFor(item)))}
            empty={
              <AdminEmpty title={t('list.emptyTitle')} hint={t('list.emptyYours')} data-rulesets-empty="yours">
                {newAction}
              </AdminEmpty>
            }
          />
          {mine.total > mine.items.length && <p className="text-caption text-fg-muted">{t('list.capNote', { count: limit })}</p>}
        </section>

        {leagueOwned.length > 0 && (
          <section className="space-y-3" aria-labelledby="rulesets-leagues">
            {heading('rulesets-leagues', t('page.leagues'))}
            <p className="text-body text-fg-muted">{t('page.leaguesIntro')}</p>
            <RulesetLibraryList entries={leagueOwned.map((item) => rulesetLibraryEntry(item, locale, t, true, extrasFor(item)))} empty={null} />
          </section>
        )}
      </GalleryPanel>

      <GalleryPanel id="shared" label={t('tabs.shared')} count={shared.total}>
        <section className="space-y-3" aria-labelledby="rulesets-shared">
          {heading('rulesets-shared', t('list.shared'))}
          <p className="text-body text-fg-muted">{t('list.sharedIntro')}</p>
          <RulesetLibraryList
            fork
            entries={shared.items.map((item) => rulesetLibraryEntry(item, locale, t, false, extrasFor(item)))}
            empty={<AdminEmpty title={t('list.emptyShared')} data-rulesets-empty="shared" />}
          />
          {shared.total > shared.items.length && <p className="text-caption text-fg-muted">{t('list.capNote', { count: limit })}</p>}
        </section>
      </GalleryPanel>

      <GalleryPanel id="examples" label={t('tabs.examples')} count={presets.length + site.total}>
        <section className="space-y-3" aria-labelledby="rulesets-presets">
          {heading('rulesets-presets', t('presets.heading'))}
          <p className="text-body text-fg-muted">{t('presets.intro')}</p>
          {SOURCES.map(({ source, heading: key }) => {
            const ofSource = presets.filter((preset) => preset.source === source);
            const groups = groupRulesetPresets(ofSource);
            return (
              <details key={source} className={disclosure}>
                <summary className={summaryRow}>
                  {t(`page.${key}`)}
                  <span className="text-body font-normal text-fg-muted">{t('page.presetsCount', { count: ofSource.length })}</span>
                </summary>
                <div className="space-y-6 border-t border-hairline p-4">
                  {groups.map((group) => (
                    <div key={group.key} className="space-y-2">
                      <h3 className="text-body font-[550] text-fg-muted">{group.genLabel}</h3>
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
          <details className={disclosure}>
            <summary className={summaryRow}>
              <span id="rulesets-site">{t('page.site')}</span>
              <span className="text-body font-normal text-fg-muted">{t('page.presetsCount', { count: site.total })}</span>
            </summary>
            <div className="space-y-3 border-t border-hairline p-4">
              <p className="text-body text-fg-muted">{t('page.siteIntro')}</p>
              <RulesetLibraryList
                fork
                entries={site.items.map((item) => rulesetLibraryEntry(item, locale, t, false, extrasFor(item)))}
                empty={<AdminEmpty title={t('page.emptySite')} data-rulesets-empty="site" />}
              />
              {site.total > site.items.length && <p className="text-caption text-fg-muted">{t('list.capNote', { count: limit })}</p>}
            </div>
          </details>
        </section>
      </GalleryPanel>
    </GalleryTabs>
  );
}
