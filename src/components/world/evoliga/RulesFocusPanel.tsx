import type { FormatRules } from '@/types/format-rules';
import { FOCUS_RING } from '@/components/world/panel';
import RulesHubLink from '@/components/world/sections/RulesHubLink';
import type { RulesCopyContext } from '@/components/world/sections/types';
import { createTranslator, type Translator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { worldEvoligaMessages, type WorldEvoligaEn } from '@/i18n/messages/world/evoliga';
import {
  resolveRuleSet,
  type RuleRow,
  type RuleSection,
  type RuleSet,
  type RuleSide,
} from './route/plaza/gate-painters';

interface RulesFocusPanelProps {
  side: RuleSide;
  formatRules: FormatRules | null;
  rulesetName: string | null;
  /** The league's format and current best-of (`rulesCopyContext`); the format picks the body. */
  context: RulesCopyContext;
  /** For the non-EPB pointer to the league hub's Regeln tab. */
  leagueId: string;
  /** The viewer's UI language (i18n D11). */
  locale: Locale;
  /** The viewer's language for move and item names; defaults to `locale`. */
  dataLocale?: Locale;
}

/**
 * Tab chip in the ZA register — the same shoulder-flanked row the schedule
 * panel uses (`04-za-requests-ui.png`). A sibling radio drives the selected
 * page, so the docked rulebook stays a server component.
 */
const TAB =
  'row-start-1 cursor-pointer rounded-full px-2 py-1.5 text-center text-[0.7rem] font-semibold ' +
  'uppercase tracking-wide text-arena-ink-secondary transition-colors duration-150 ' +
  'hover:bg-[var(--hud-chip-hover)] hover:text-arena-ink motion-reduce:transition-none';

/** ZA `L`/`R` shoulder glyph: which trigger pages the panel on a controller. */
const SHOULDER =
  'row-start-1 select-none rounded-md border border-arena-border px-1.5 py-0.5 text-[0.6rem] ' +
  'font-bold text-arena-ink-secondary';

/** Which page opens first: the plaque the trainer actually tapped. */
const FIRST_PAGE: Record<RuleSide, 'format' | 'klauseln'> = {
  left: 'format',
  right: 'klauseln',
};

export function rulesPanelTitle(side: RuleSide, locale: Locale): string {
  const t = createTranslator(worldEvoligaMessages, locale);
  return side === 'left' ? t('rulesPanel.titleFormat') : t('rulesPanel.titleClauses');
}

/**
 * Body of the `?rules=left|right` Focus panel (ADR-0003): the full rule set
 * behind the two gate plaques, paged the way the ZA request register pages.
 *
 * Both plaques open the whole rulebook — the param value only records which
 * one was tapped, and picks the page it opens on. Rows come from
 * `resolveRuleSet`, the same shaping the stone plaques paint, so the panel and
 * the pier faces can never disagree. Server component.
 *
 * The league's format picks the body, never whether a `format_rules` row
 * exists: Evolution Point Buy pages through the draft rulebook; every other
 * format shows the tapped plaque's page — its ruleset (when set), format and
 * best-of on the left, the clause rows on the right — and points to the
 * league hub's Regeln tab for clauses, bans and custom rules.
 */
export default function RulesFocusPanel({
  side,
  formatRules,
  rulesetName,
  context,
  leagueId,
  locale,
  dataLocale = locale,
}: RulesFocusPanelProps) {
  const t = createTranslator(worldEvoligaMessages, locale);
  // The plaques' own shaping in the viewer's language, so panel and pier faces agree.
  const ruleSet = resolveRuleSet(formatRules, rulesetName, context, locale, dataLocale);
  if (!ruleSet.pointBuy) return <FormatRulesBody side={side} ruleSet={ruleSet} leagueId={leagueId} t={t} />;

  const lead = ruleSet.lead[side];
  const page = (id: RuleSection['id']) => ruleSet.sections.find((section) => section.id === id) ?? null;
  const format = page('format');
  const klauseln = page('klauseln');
  const draft = page('draft');
  const first = FIRST_PAGE[side];

  return (
    <div className="space-y-3 text-sm">
      <p className="text-arena-ink-secondary">
        {ruleSet.rulesetName ?? enumLabel(createTranslator(enumMessages, locale), 'formatType', 'evolution_point_buy')}
        {ruleSet.configured ? '' : ` · ${t('rulesPanel.standardRules')}`}
      </p>
      {!ruleSet.configured && (
        <p className="rounded-lg border border-arena-border bg-arena-elevated px-3 py-2 text-xs text-arena-ink-secondary">
          {t('rules.noFormatRules')}
        </p>
      )}

      <fieldset className="grid grid-cols-[auto_1fr_1fr_1fr_auto] items-center gap-x-1 gap-y-3">
        <legend className="sr-only">{t('rulesPanel.choosePage')}</legend>
        {/* Peer names must be literal for Tailwind to emit them — no template ids */}
        <input
          type="radio"
          name="rules-page"
          id="rules-page-format"
          defaultChecked={first === 'format'}
          className="peer/format sr-only"
        />
        <input
          type="radio"
          name="rules-page"
          id="rules-page-klauseln"
          defaultChecked={first === 'klauseln'}
          className="peer/klauseln sr-only"
        />
        <input type="radio" name="rules-page" id="rules-page-draft" className="peer/draft sr-only" />

        <span aria-hidden="true" className={`col-start-1 ${SHOULDER}`}>
          L
        </span>
        <label
          htmlFor="rules-page-format"
          className={`col-start-2 ${TAB} peer-checked/format:bg-[var(--hud-chip-active)] peer-checked/format:text-[var(--hud-chip-active-ink)] peer-checked/format:shadow-[inset_0_0_0_1px_var(--hud-chip-active-ring)] peer-focus-visible/format:outline peer-focus-visible/format:outline-2 peer-focus-visible/format:outline-offset-2 peer-focus-visible/format:outline-arena-focus`}
        >
          {t('rulesPanel.tabFormat')}
        </label>
        <label
          htmlFor="rules-page-klauseln"
          className={`col-start-3 ${TAB} peer-checked/klauseln:bg-[var(--hud-chip-active)] peer-checked/klauseln:text-[var(--hud-chip-active-ink)] peer-checked/klauseln:shadow-[inset_0_0_0_1px_var(--hud-chip-active-ring)] peer-focus-visible/klauseln:outline peer-focus-visible/klauseln:outline-2 peer-focus-visible/klauseln:outline-offset-2 peer-focus-visible/klauseln:outline-arena-focus`}
        >
          {t('rulesPanel.tabClauses')}
        </label>
        <label
          htmlFor="rules-page-draft"
          className={`col-start-4 ${TAB} peer-checked/draft:bg-[var(--hud-chip-active)] peer-checked/draft:text-[var(--hud-chip-active-ink)] peer-checked/draft:shadow-[inset_0_0_0_1px_var(--hud-chip-active-ring)] peer-focus-visible/draft:outline peer-focus-visible/draft:outline-2 peer-focus-visible/draft:outline-offset-2 peer-focus-visible/draft:outline-arena-focus`}
        >
          {t('rulesPanel.tabDraft')}
        </label>
        <span aria-hidden="true" className={`col-start-5 ${SHOULDER}`}>
          R
        </span>

        <div className="col-span-5 row-start-2 hidden peer-checked/format:block">
          {format && <RulePage rows={format.rows} note={format.note} lead={lead} />}
        </div>
        <div className="col-span-5 row-start-2 hidden peer-checked/klauseln:block">
          {klauseln && <RulePage rows={klauseln.rows} note={klauseln.note} lead={lead} />}
        </div>
        <div className="col-span-5 row-start-2 hidden peer-checked/draft:block">
          {draft && <RulePage rows={draft.rows} note={draft.note} lead={lead} />}
        </div>
      </fieldset>
    </div>
  );
}

/**
 * The non-EPB body: the page of the plaque that was tapped, so the panel
 * reads what the stone face paints under its title. Tafel I (`left`,
 * 'Regelwerk — Format'): the format rows, the format row selected. Tafel II
 * (`right`, 'Regelwerk — Klauseln'): the clause rows (Klauseln, Verbote,
 * Eigene Regeln — 'im Regeln-Tab', or 'nicht hinterlegt' without a ruleset),
 * the Klauseln row selected. (PR #65 test pass, R11: both plaques opened the
 * format page, under a 'Klauseln' title.) Either way the sentence and the
 * link to the Regeln tab close the page.
 */
function FormatRulesBody({
  side,
  ruleSet,
  leagueId,
  t,
}: {
  side: RuleSide;
  ruleSet: RuleSet;
  leagueId: string;
  t: Translator<WorldEvoligaEn>;
}) {
  const page = ruleSet.sections.find((section) => section.id === FIRST_PAGE[side]);
  const pointer = ruleSet.sections.find((section) => section.id === 'klauseln');

  return (
    <div className="space-y-3 text-sm">
      {page && <RulePage rows={page.rows} lead={ruleSet.lead[side]} />}
      <p className="px-1 leading-relaxed text-arena-ink-secondary">
        {pointer?.note}{' '}
        <RulesHubLink
          leagueId={leagueId}
          className={`font-semibold text-arena-ink underline underline-offset-2 hover:text-arena-accent-strong ${FOCUS_RING}`}
        >
          {t('rules.toRulesTab')}
        </RulesHubLink>
      </p>
    </div>
  );
}

/**
 * One page of the register: label/value rows, the tapped plaque's leading row
 * inverted on white the way ZA marks the selected request.
 */
function RulePage({
  rows,
  note,
  lead,
}: {
  rows: RuleRow[];
  note?: string;
  lead: string;
}) {
  return (
    <>
      <ul className="mt-2 space-y-1">
        {rows.map((row) => {
          const selected = row.label === lead;
          return (
            <li
              key={row.label}
              className={`flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-sm ${
                selected ? 'bg-white text-teal-950' : 'bg-arena-elevated text-arena-ink'
              }`}
            >
              <span className="min-w-0 font-medium">{row.label}</span>
              <span className="flex-none font-semibold tabular-nums">{row.value}</span>
            </li>
          );
        })}
      </ul>
      {note && <p className="mt-2 px-1 text-xs leading-relaxed text-arena-ink-secondary">{note}</p>}
    </>
  );
}
