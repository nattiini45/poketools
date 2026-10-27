import Link from 'next/link';
import { rulesetEditorHref, RULESETS_HREF } from '@/components/ruleset-studio/hrefs';
import RulesView from '@/components/ruleset-studio/RulesView';
import ForkStoredButton from '@/components/ruleset-studio/starts/ForkStoredButton';
import { describeChange } from '@/components/ruleset/pin-change-text';
import UsagePanel from '@/components/ruleset/UsagePanel';
import Badge from '@/components/ui/Badge';
import { LocalTime } from '@/i18n/LocalTime';
import type { Locale } from '@/i18n/config';
import type { Translator } from '@/i18n/core';
import type { rulesetMessages } from '@/i18n/messages/ruleset';
import type { rulesetStudioMessages } from '@/i18n/messages/ruleset-studio';
import type { rulesetStudioEditorMessages } from '@/i18n/messages/ruleset-studio/editor';
import type { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import type { DescribedRuleset } from '@/lib/ruleset-kit/describe';
import type { RulesetDefinitionSummary, RulesetUsage, RulesetVersionSummary } from '@/lib/ruleset-studio/library-types';
import type { PinChangeSummary } from '@/lib/ruleset-studio/pin-info';
import { isCatalogStale } from '@/lib/ruleset-studio/staleness';
import { resolveLText } from '@/lib/studio-core/ltext';

const LINK = 'inline-flex min-h-11 min-w-11 items-center text-sm font-medium text-poke-blue hover:underline sm:min-h-0 sm:min-w-0';

export interface RulesetPageViewProps {
  id: string;
  /** The definition as the library lists it (names only for the owner). */
  summary: RulesetDefinitionSummary;
  /** The viewer may open the editor. */
  canEdit: boolean;
  locale: Locale;
  /** The rules in sentences: the newest published version, or the saved draft (`isDraft`) of a ruleset with none. Null: nothing to show. */
  described: DescribedRuleset | null;
  isDraft: boolean;
  /** Who pins which version; null while the ruleset has no published version. */
  usage: RulesetUsage | null;
  latestVersionNo: number | null;
  /** The versions the viewer may list, newest first. */
  versions: readonly RulesetVersionSummary[];
  /** Per version number, what it changed against the one before (`null`: the first version); a version missing here has no line. */
  changes: ReadonlyMap<number, PinChangeSummary | null>;
  /** `PRESET_RULES_VERSION` of the running app. */
  catalogVersion: string;
  t: Translator<typeof rulesetStudioSectionsMessages.en>;
  tList: Translator<typeof rulesetStudioMessages.en>;
  tEditor: Translator<typeof rulesetStudioEditorMessages.en>;
  tRuleset: Translator<typeof rulesetMessages.en>;
}

/**
 * The body of `/admin/rulesets/[id]` below the page title: state badges, the way back and to the editor, the fork button,
 * the rules in plain sentences, who uses the ruleset (`UsagePanel`) and the version list. Each of the newest versions says
 * what it changed against the one before and is flagged when it was computed from older catalog data than this build has
 * (`isCatalogStale`). Pure over already-read data and already-built translators, so the page gates and reads, and the dev
 * preview (`/ruleset-preview/surfaces`) renders the same markup over fixtures.
 */
export default function RulesetPageView({
  id,
  summary,
  canEdit,
  locale,
  described,
  isDraft,
  usage,
  latestVersionNo,
  versions,
  changes,
  catalogVersion,
  t,
  tList,
  tEditor,
  tRuleset,
}: RulesetPageViewProps) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Badge variant="gray">{tEditor(`toolbar.visibility.${summary.visibility}`)}</Badge>
        <Badge variant={summary.current_version === null ? 'gray' : 'green'}>
          {summary.current_version === null ? tList('list.state.draft') : tList('list.state.published', { n: summary.current_version.version_no })}
        </Badge>
        {summary.owner !== null && <span className="text-sm text-poke-text-secondary">{tList('list.by', { name: summary.owner.name })}</span>}
        <Link href={RULESETS_HREF} className={LINK}>
          {t('page.back')}
        </Link>
        {canEdit && (
          <Link href={rulesetEditorHref(id)} className={LINK}>
            {t('page.edit')}
          </Link>
        )}
      </div>
      <ForkStoredButton definitionId={id} />

      {described === null ? (
        <p className="text-sm text-poke-text-muted">{t('page.noContent')}</p>
      ) : (
        <section className="space-y-3" aria-labelledby="ruleset-rules">
          <h2 id="ruleset-rules" className="font-heading text-lg font-bold text-poke-text-primary">
            {t('page.rulesHeading')}
          </h2>
          {isDraft && <p className="text-sm text-poke-text-muted">{t('page.draftNote')}</p>}
          <RulesView rules={described} lang={locale} />
        </section>
      )}

      {usage !== null && <UsagePanel definitionId={id} usage={usage} latestVersionNo={latestVersionNo} />}

      {versions.length > 0 && (
        <section className="space-y-2" aria-labelledby="ruleset-versions">
          <h2 id="ruleset-versions" className="font-heading text-lg font-bold text-poke-text-primary">
            {t('page.versions')}
          </h2>
          <ul className="space-y-3 text-sm text-poke-text-secondary">
            {versions.map((version) => {
              const change = changes.get(version.version_no);
              const previous = version.version_no - 1;
              const changeText = change ? describeChange(change, tRuleset) : null;
              return (
                <li key={version.id} className="space-y-0.5">
                  <div>
                    <span className="font-semibold text-poke-text-primary">{t('page.versionRow', { n: version.version_no })}</span>{' '}
                    <LocalTime value={version.created_at} preset="date" />
                    {version.changelog !== null && ` · ${resolveLText(version.changelog, { viewer: locale })?.value ?? ''}`}{' '}
                    {isCatalogStale(version, catalogVersion) && <Badge variant="yellow">{t('page.versionStale')}</Badge>}
                  </div>
                  {change === null && <p className="text-poke-text-muted">{t('page.versionFirst')}</p>}
                  {change !== undefined && change !== null && (
                    <p className="text-poke-text-muted">
                      {changeText === null ? t('page.versionSame', { from: previous }) : t('page.versionChanges', { from: previous, changes: changeText })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
