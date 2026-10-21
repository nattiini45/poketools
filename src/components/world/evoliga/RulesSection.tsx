import type { ReactNode } from 'react';
import SectionShell from '@/components/world/SectionShell';
import { FOCUS_RING, PANEL } from '@/components/world/panel';
import RulesHubLink from '@/components/world/sections/RulesHubLink';
import { isPointBuyRules } from '@/components/world/sections/rules-context';
import type { RulesCopyContext } from '@/components/world/sections/types';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { worldEvoligaMessages } from '@/i18n/messages/world/evoliga';
import { epbPack, participationLineBase } from '@/lib/format-pack';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { FormatRules } from '@/types/format-rules';
import { resolveRuleSet } from './route/plaza/gate-painters';

interface RulesSectionProps {
  formatRules: FormatRules | null;
  rulesetName: string | null;
  /** The league's format and current best-of (`rulesCopyContext`); the format picks the body. */
  context: RulesCopyContext;
  /** For the non-EPB pointer to the league hub's Rules tab. */
  leagueId: string;
  /** The viewer's UI language (i18n D11). */
  locale: Locale;
  /** The viewer's language for Pokémon, move and item names; defaults to `locale`. */
  dataLocale?: Locale;
}

/** Rule heading — the repeated subhead treatment inside the rulebook panel. */
function RuleHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-heading text-sm font-bold uppercase tracking-wide text-arena-accent-strong">
      {children}
    </h3>
  );
}

const strong = (chunks: ReactNode) => <strong className="font-semibold text-arena-ink">{chunks}</strong>;

/**
 * #rules — the Evolution Point Buy rules as readable prose in the viewer's
 * language, resolved from the season's format_rules row with the EPB
 * defaults as fallback when no row is configured.
 *
 * The token economy uses the token names from the glossary (draft-frontend
 * §8.3). The league's own rule prose and token names come from the active
 * format pack, and so do the fallbacks when no row is configured (design
 * spec §E). The participation-token rule names the pack's participation line
 * through the pkmn layer, and is left out when the pack has none.
 *
 * The rulebook sits on one continuous panel rather than loose on the page:
 * this is the longest reading block in the world, and it must stay legible
 * with the route rendering behind it.
 *
 * The league's format decides the body, never whether a format_rules row
 * exists (only Evolution Point Buy seasons get one; a format change can
 * leave a stale one behind, and an admin pin or `?world=plaza` can put any
 * league here). Every other format gets `FormatRulebook`: the plaques' own
 * shaping (`resolveRuleSet`) and a pointer to the league hub's Rules tab.
 */
export default function RulesSection({
  formatRules,
  rulesetName,
  context,
  leagueId,
  locale,
  dataLocale = locale,
}: RulesSectionProps) {
  if (!isPointBuyRules(context)) {
    return (
      <FormatRulebook
        formatRules={formatRules}
        rulesetName={rulesetName}
        context={context}
        leagueId={leagueId}
        locale={locale}
        dataLocale={dataLocale}
      />
    );
  }

  const t = createTranslator(worldEvoligaMessages, locale);
  const glossary = createTranslator(glossaryMessages, locale);
  const enums = createTranslator(enumMessages, locale);

  const defaults = epbPack.defaults;
  const budget = formatRules?.draft_budget ?? defaults.draftBudget;
  const picks = formatRules?.draft_picks ?? defaults.draftPicks;
  const tokenRatio = formatRules?.draft_token_ratio ?? defaults.tokenRatio;
  const tokenMax = formatRules?.draft_token_max ?? defaults.tokenMax;
  const tokenMaxPerLine = formatRules?.draft_token_max_per_line ?? defaults.tokenMaxPerLine;
  const tera: typeof epbPack.teraByStage = formatRules?.tera_rules ?? epbPack.teraByStage;
  const bannedMoves = formatRules?.banned_moves ?? defaults.bannedMoves;
  const bannedItems = formatRules?.banned_items ?? defaults.bannedItems;
  const tiebreakers = formatRules?.tiebreaker_order ?? epbPack.tiebreakerChain;
  const participationLine = participationLineBase();
  const nameList = (names: readonly string[]) => (names.length > 0 ? names.join(', ') : t('rules.none'));

  return (
    <SectionShell id="rules" heading={t('rules.heading')}>
      {!formatRules && (
        <p className="mb-4 rounded-lg border border-arena-border bg-arena-elevated p-3 text-xs text-arena-ink-secondary">
          {t('rules.noFormatRules')}
        </p>
      )}

      <div
        className={`max-w-3xl space-y-6 ${PANEL} p-6 text-sm leading-relaxed text-arena-ink-secondary`}
      >
        <section>
          <RuleHeading>{t('rules.budgetDraft')}</RuleHeading>
          <p className="mt-1.5">{t.rich('rules.budgetBody', { b: strong, budget, picks })}</p>
        </section>

        <section>
          <RuleHeading>{t('rules.tokens')}</RuleHeading>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 marker:text-arena-accent">
            <li>
              {t.rich('rules.draftKillRule', {
                b: strong,
                token: glossary('token.draftKill'),
                ratio: tokenRatio,
                max: tokenMax,
                perLine: tokenMaxPerLine,
              })}
            </li>
            <li>{t.rich('rules.comebackRule', { b: strong, token: glossary('token.comeback') })}</li>
            {participationLine && (
              <li>
                {t.rich('rules.cosmoRule', {
                  b: strong,
                  token: glossary('token.cosmo'),
                  line: localizeSpecies(participationLine, dataLocale),
                })}
              </li>
            )}
          </ul>
        </section>

        <section>
          <RuleHeading>{t('rules.evolutionTera')}</RuleHeading>
          <p className="mt-1.5">{t('rules.evolutionBody')}</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 marker:text-arena-accent">
            <li>{t('rules.teraStage', { stage: 1, rule: enumLabel(enums, 'teraRule', tera.stage1) })}</li>
            <li>{t('rules.teraStage', { stage: 2, rule: enumLabel(enums, 'teraRule', tera.stage2) })}</li>
            <li>{t('rules.teraStage', { stage: 3, rule: enumLabel(enums, 'teraRule', tera.stage3) })}</li>
          </ul>
        </section>

        <section>
          <RuleHeading>{t('rules.redraftHeading')}</RuleHeading>
          <p className="mt-1.5">
            {t.rich('rules.redraftBody', {
              b: strong,
              state: formatRules?.redraft_phase_open ? t('rules.redraftOpen') : t('rules.redraftClosed'),
            })}
          </p>
        </section>

        <section>
          <RuleHeading>{t('rules.tiebreakers')}</RuleHeading>
          <p className="mt-1.5">
            {t('rules.tiebreakersLead')}{' '}
            {tiebreakers.map((step, i) => (
              <span key={step}>
                {i > 0 && <span className="text-arena-accent"> → </span>}
                {t.dynamic(`rules.tiebreaker.${step}`, undefined, step)}
              </span>
            ))}
            .
          </p>
        </section>

        <section>
          <RuleHeading>{t('rules.bans')}</RuleHeading>
          <p className="mt-1.5">
            {t('rules.bannedMoves', { list: nameList(bannedMoves.map((move) => localizeMove(move, dataLocale))) })}
          </p>
          <p className="mt-1">
            {t('rules.bannedItems', { list: nameList(bannedItems.map((item) => localizeItem(item, dataLocale))) })}
          </p>
          <p className="mt-1">{t('rules.passRule')}</p>
          {rulesetName && <p className="mt-1">{t.rich('rules.underlying', { b: strong, name: rulesetName })}</p>}
        </section>
      </div>
    </SectionShell>
  );
}

/**
 * #rules for every format but Evolution Point Buy: the format rows the
 * plaques paint (ruleset when set, format, best-of) and the pointer to the
 * league hub's Rules tab, where the live ruleset lists the clauses, bans and
 * custom rules (this section adds no read). No draft numbers, no defaults
 * notice: a `format_rules` row off EPB is a stale one.
 */
function FormatRulebook({
  formatRules,
  rulesetName,
  context,
  leagueId,
  locale,
  dataLocale = locale,
}: RulesSectionProps) {
  const t = createTranslator(worldEvoligaMessages, locale);
  const ruleSet = resolveRuleSet(formatRules, rulesetName, context, locale, dataLocale);
  const format = ruleSet.sections.find((section) => section.id === 'format');
  const pointer = ruleSet.sections.find((section) => section.id === 'klauseln');

  return (
    <SectionShell id="rules" heading={t('rules.heading')}>
      <div
        className={`max-w-3xl space-y-6 ${PANEL} p-6 text-sm leading-relaxed text-arena-ink-secondary`}
      >
        <section>
          <RuleHeading>{t('rules.format')}</RuleHeading>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 marker:text-arena-accent">
            {format?.rows.map((row) => (
              <li key={row.label}>
                <strong className="font-semibold text-arena-ink">{row.label}:</strong> {row.value}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <RuleHeading>{t('rules.allRules')}</RuleHeading>
          <p className="mt-1.5">
            {pointer?.note}{' '}
            <RulesHubLink
              leagueId={leagueId}
              className={`font-semibold text-arena-ink underline underline-offset-2 hover:text-arena-accent-strong ${FOCUS_RING}`}
            >
              {t('rules.toRulesTab')}
            </RulesHubLink>
          </p>
        </section>
      </div>
    </SectionShell>
  );
}
