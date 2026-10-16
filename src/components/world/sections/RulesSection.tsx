import type { ReactNode } from 'react';
import SectionShell from '@/components/world/SectionShell';
import { PANEL, FOCUS_RING } from '@/components/world/panel';
import { createTranslator } from '@/i18n/core';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { worldMessages } from '@/i18n/messages/world';
import {
  fullRulesSentence,
  isBannedMovesLabel,
  isPointBuyRules,
  noRulesetSuffix,
  rulesCopyContext,
} from './rules-context';
import RulesHubLink from './RulesHubLink';
import type { ThemeRouteData, ThemeSectionCopy, WorldLocaleProps } from './types';

/**
 * #rules — the rulebook in the viewer's language. The theme's in-world plaque paints the
 * same shaping through `copy.rulesCopy`, so the DOM and the diegetic surface
 * can never disagree about the ruleset of record.
 *
 * The league's format decides the body, never whether a `format_rules` row
 * exists (only Evolution Point Buy seasons get one; a format change can leave
 * a stale row behind):
 *
 * - Evolution Point Buy: the draft numbers resolved from the season's
 *   `format_rules` row with the league defaults as fallback, the evolution
 *   and trade paragraph, and an explicit configured-versus-default
 *   distinction (a badge names the source of the numbers).
 * - Every other format: the ruleset of record, the format and the current
 *   stage's best-of, and a pointer to the league hub's Rules tab, which reads
 *   the full ruleset live (this section adds no read).
 *
 * Either way, with no ruleset the line names the format's rules and says
 * that no ruleset is assigned (the hub Rules tab's own finding), and the
 * non-EPB pointer promises no clauses the tab does not list. The plaque note
 * matches the plaque the format paints (`rulesFormatNote` off EPB).
 */

function RuleHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-heading text-sm font-bold uppercase tracking-wide text-arena-accent-strong">
      {children}
    </h3>
  );
}

export default function RulesSection({
  data,
  copy,
  locale = 'en',
}: {
  data: ThemeRouteData;
  copy: ThemeSectionCopy;
} & WorldLocaleProps) {
  const t = createTranslator(worldMessages, locale);
  // Token names come from the glossary only (i18n-core §10.4).
  const glossary = createTranslator(glossaryMessages, locale);
  const { league, formatRules, rulesetName } = data;
  const context = rulesCopyContext(data);
  const plaque = copy.rulesCopy(formatRules, rulesetName, context);

  if (!isPointBuyRules(context)) {
    return (
      <SectionShell id="rules" heading={t('rules.heading')}>
        <div
          className={`max-w-3xl space-y-6 ${PANEL} p-6 text-sm leading-relaxed text-arena-ink-secondary`}
        >
          <section>
            <RuleHeading>{t('rules.rulesetOfRecord')}</RuleHeading>
            <p className="mt-1.5">
              {copy.rulesPlaysBy}{' '}
              <strong className="font-semibold text-arena-ink">{plaque.rulesetName}</strong>
              {rulesetName === null && noRulesetSuffix(locale)}
            </p>
          </section>

          <section>
            <RuleHeading>{t('rules.format')}</RuleHeading>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 marker:text-arena-accent">
              {plaque.rows.map(([label, value]) => (
                <li key={label}>
                  <strong className="font-semibold text-arena-ink">{label}:</strong> {value}
                </li>
              ))}
            </ul>
            <p className="mt-2">{copy.rulesFormatNote}</p>
          </section>

          <section>
            <RuleHeading>{t('rules.fullRules')}</RuleHeading>
            <p className="mt-1.5">
              {fullRulesSentence(rulesetName, locale)}{' '}
              <RulesHubLink
                leagueId={league.id}
                className={`font-semibold text-arena-ink underline underline-offset-2 hover:text-arena-accent-strong ${FOCUS_RING}`}
              >
                {t('rules.openRulesTab')}
              </RulesHubLink>
            </p>
          </section>
        </div>
      </SectionShell>
    );
  }

  const isConfigured = formatRules !== null;

  return (
    <SectionShell id="rules" heading={t('rules.heading')}>
      <div
        className={`max-w-3xl space-y-6 ${PANEL} p-6 text-sm leading-relaxed text-arena-ink-secondary`}
      >
        <section>
          <RuleHeading>{t('rules.rulesetOfRecord')}</RuleHeading>
          <p className="mt-1.5">
            {copy.rulesPlaysBy}{' '}
            <strong className="font-semibold text-arena-ink">{plaque.rulesetName}</strong>
            {rulesetName === null && noRulesetSuffix(locale)}
          </p>
          <p className="mt-2">
            <span
              className={`inline-block rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
                isConfigured
                  ? 'bg-arena-accent/15 text-arena-accent-strong'
                  : 'bg-arena-elevated text-arena-ink-secondary'
              }`}
            >
              {isConfigured ? t('rules.configured') : t('rules.leagueDefaults')}
            </span>
          </p>
        </section>

        <section>
          <RuleHeading>{t('rules.draft')}</RuleHeading>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 marker:text-arena-accent">
            {plaque.rows.map(([label, value]) => (
              <li key={label}>
                <strong className="font-semibold text-arena-ink">{label}:</strong> {value}
                {isBannedMovesLabel(label) && ` ${t('rules.bannedOutright')}`}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <RuleHeading>{copy.rulesSpiritHeading}</RuleHeading>
          <p className="mt-1.5">
            {t('rules.spiritBody', {
              draftKill: glossary('token.draftKill'),
              comeback: glossary('token.comeback'),
              cosmo: glossary('token.cosmo'),
            })}{' '}
            {copy.rulesPlaqueNote}
          </p>
        </section>

        <section>
          <RuleHeading>{t('rules.defaults')}</RuleHeading>
          <p className="mt-1.5">{plaque.note ?? t('rules.defaultsNote')}</p>
        </section>
      </div>
    </SectionShell>
  );
}
