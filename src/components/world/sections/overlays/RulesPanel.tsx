import { PANEL_INSET, FOCUS_RING } from '@/components/world/panel';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { worldMessages } from '@/i18n/messages/world';
import { worldEvoligaMessages } from '@/i18n/messages/world/evoliga';
import type { FormatRules } from '@/types/format-rules';
import { fullRulesSentence, isBannedMovesLabel, isPointBuyRules, noRulesetSuffix } from '../rules-context';
import RulesHubLink from '../RulesHubLink';
import type { RulesCopyContext, RulesCopyFn, WorldLocaleProps } from '../types';

interface RulesPanelProps extends WorldLocaleProps {
  formatRules: FormatRules | null;
  rulesetName: string | null;
  /** The theme's own plaque painter — rows and defaults come from it, never duplicated here. */
  rulesCopy: RulesCopyFn;
  /** The league's format and current best-of (`rulesCopyContext`); the format picks the body. */
  context: RulesCopyContext;
  /** For the non-EPB pointer to the league hub's Rules tab. */
  leagueId: string;
}

export function rulesPanelTitle(locale: Locale = 'en'): string {
  return createTranslator(worldMessages, locale)('overlays.rulebook');
}

/**
 * Body of the `?rules=gate` overlay for the isle route themes: the
 * rulebook behind the gate plaque. The league's format picks the body, never
 * whether a `format_rules` row exists: Evolution Point Buy shows the ruleset
 * of record, the draft rows and an explicit configured-versus-defaults
 * distinction; every other format shows the ruleset of record, its format
 * and best-of, and a pointer to the league hub's Rules tab.
 *
 * The rows come from the theme's plaque painter (the same shaping the painted
 * gate carries), so the panel and the in-world plaque can never disagree
 * about the ruleset of record or the default numbers. Server component; pure
 * props-in, no data fetching.
 */
export default function RulesPanel({
  formatRules,
  rulesetName,
  rulesCopy,
  context,
  leagueId,
  locale = 'en',
}: RulesPanelProps) {
  const t = createTranslator(worldMessages, locale);
  const plaque = rulesCopy(formatRules, rulesetName, context);

  if (!isPointBuyRules(context)) {
    return (
      <div className="space-y-4 text-sm">
        <section>
          <h3 className="font-heading text-xs font-bold uppercase tracking-wide text-arena-accent-strong">
            {t('rules.rulesetOfRecord')}
          </h3>
          <p className="mt-1.5 text-arena-ink-secondary">
            <strong className="font-semibold text-arena-ink">{plaque.rulesetName}</strong>
            {rulesetName === null && noRulesetSuffix(locale)}
          </p>
        </section>

        <section>
          <h3 className="font-heading text-xs font-bold uppercase tracking-wide text-arena-accent-strong">
            {t('rules.format')}
          </h3>
          <dl className="mt-1.5 space-y-1">
            {plaque.rows.map(([label, value]) => (
              <div
                key={label}
                className={`flex items-baseline justify-between gap-3 px-3 py-1.5 ${PANEL_INSET}`}
              >
                <dt className="min-w-0 font-medium text-arena-ink">{label}</dt>
                <dd className="flex-none font-semibold tabular-nums text-arena-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h3 className="font-heading text-xs font-bold uppercase tracking-wide text-arena-accent-strong">
            {t('rules.fullRules')}
          </h3>
          <p className="mt-1.5 text-arena-ink-secondary">
            {fullRulesSentence(rulesetName, locale)}{' '}
            <RulesHubLink
              leagueId={leagueId}
              className={`font-semibold text-arena-ink underline underline-offset-2 hover:text-arena-accent-strong ${FOCUS_RING}`}
            >
              {t('rules.openRulesTab')}
            </RulesHubLink>
          </p>
        </section>
      </div>
    );
  }

  const isConfigured = formatRules !== null;

  return (
    <div className="space-y-4 text-sm">
      <section>
        <h3 className="font-heading text-xs font-bold uppercase tracking-wide text-arena-accent-strong">
          {t('rules.rulesetOfRecord')}
        </h3>
        <p className="mt-1.5 text-arena-ink-secondary">
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
        <h3 className="font-heading text-xs font-bold uppercase tracking-wide text-arena-accent-strong">
          {t('rules.draft')}
        </h3>
        <dl className="mt-1.5 space-y-1">
          {plaque.rows.map(([label, value]) => (
            <div
              key={label}
              className={`flex items-baseline justify-between gap-3 px-3 py-1.5 ${PANEL_INSET}`}
            >
              <dt className="min-w-0 font-medium text-arena-ink">{label}</dt>
              <dd className="flex-none font-semibold tabular-nums text-arena-ink">
                {value}
                {isBannedMovesLabel(label) && ` ${t('rules.bannedOutright')}`}
              </dd>
            </div>
          ))}
        </dl>
        {/* The pack's note on passing moves, as on the plaza rulebook. */}
        <p className="mt-2 text-arena-ink-secondary" data-rule="pass">
          {createTranslator(worldEvoligaMessages, locale)('rules.passRule')}
        </p>
      </section>

      <section>
        <h3 className="font-heading text-xs font-bold uppercase tracking-wide text-arena-accent-strong">
          {t('rules.defaults')}
        </h3>
        <p className="mt-1.5 text-arena-ink-secondary">{plaque.note ?? t('rules.defaultsNote')}</p>
      </section>
    </div>
  );
}
