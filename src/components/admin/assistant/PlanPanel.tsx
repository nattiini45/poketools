'use client';

import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { PANEL, PANEL_INSET } from '@/components/ui/panel';
import { useFormatter, useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import { adminAssistantMessages } from '@/i18n/messages/admin-assistant';
import { adminAssistantCardsMessages } from '@/i18n/messages/admin-assistant-cards';
import { enumMessages } from '@/i18n/messages/enums';
import type { PlanBlockerView, PlanRowValue, PlanSectionState, PlanView } from './types';

type BadgeVariant = 'default' | 'accent' | 'red' | 'blue' | 'green' | 'yellow' | 'gray';

const CHIP: Record<PlanSectionState, { key: 'empty' | 'ready' | 'needsInput' | 'assumed' | 'engineGap' | 'built'; variant: BadgeVariant }> = {
  empty: { key: 'empty', variant: 'gray' },
  ready: { key: 'ready', variant: 'green' },
  needs_input: { key: 'needsInput', variant: 'yellow' },
  assumed: { key: 'assumed', variant: 'blue' },
  engine_gap: { key: 'engineGap', variant: 'red' },
  built: { key: 'built', variant: 'accent' },
};

/** Renders a row value in the viewer's language. Stored text (names) is shown as it is. */
function useRowValue() {
  const t = useT(adminAssistantMessages);
  const enums = useT(enumMessages);
  const f = useFormatter();
  return (value: PlanRowValue): string => {
    switch (value.kind) {
      case 'text':
        return value.text;
      case 'number':
        return f.number(value.value);
      case 'bool':
        return value.value ? t('plan.values.yes') : t('plan.values.no');
      case 'date':
        return f.calendarDate(value.value);
      case 'enum':
        return enumLabel(enums, value.group, value.value);
      case 'word':
        return t.dynamic(`plan.${value.group}.${value.value}`, undefined, value.value);
      case 'phase':
        return t(value.doubles ? 'plan.rows.phaseLineDoubles' : 'plan.rows.phaseLine', {
          bracket: enumLabel(enums, 'bracketType', value.bracket),
          bestOf: value.bestOf,
        });
      case 'matched':
        return t('plan.rows.matchedOf', { resolved: value.resolved, total: value.total });
    }
  };
}

export interface PlanPanelProps {
  plan: PlanView | null;
  className?: string;
  /**
   * Puts a sentence in the message box for the admin to send ("Fix this", "Build"). The panel never changes the plan or
   * stages anything by itself: the assistant does, when the admin sends the message. Absent: no shortcut is offered.
   */
  onAsk?: (text: string) => void;
  /** The conversation can take a message right now (not read-only, not archived, no turn running). */
  canAsk?: boolean;
}

/**
 * The Plan panel (plan 5.3): what the conversation has settled so far, section by section, with a chip per section and
 * the reasons a build is not possible yet, each with a "Fix" shortcut, and the Build action at the foot (on a phone it sticks
 * to the bottom edge). Read-only in phase 0: the admin changes the plan by telling the assistant, and the shortcuts only write
 * the sentence for them.
 */
export default function PlanPanel({ plan, className, onAsk, canAsk = false }: PlanPanelProps) {
  const t = useT(adminAssistantMessages);
  const cards = useT(adminAssistantCardsMessages);
  const rowValue = useRowValue();

  const blockerText = (blocker: PlanBlockerView): string => {
    const params: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(blocker.params)) {
      if (name === 'missing' && typeof value === 'string') params[name] = t.dynamic(`plan.sections.${value}`, undefined, value);
      else params[name] = typeof value === 'boolean' ? String(value) : value;
    }
    return cards.dynamic(`blockers.${blocker.code}`, params, cards('blockers.generic'));
  };
  const sectionTitle = (section: string): string => t.dynamic(`plan.sections.${section}`, undefined, section);

  return (
    <aside className={`${PANEL} space-y-3 p-3 ${className ?? ''}`} aria-label={t('page.planPanel')}>
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-base font-bold text-poke-text-primary">{t('plan.longTitle')}</h2>
        {plan !== null && <Badge variant={plan.status === 'built' ? 'green' : plan.status === 'abandoned' ? 'gray' : 'default'}>{t(`plan.status.${plan.status}`)}</Badge>}
      </header>

      {plan === null ? (
        <p className="text-sm text-poke-text-muted">{t('plan.empty')}</p>
      ) : (
        <>
          <p className="text-sm">
            <span className="font-heading font-semibold">{plan.title}</span>
            <span className="block text-xs text-poke-text-muted">
              {t('plan.revision', { number: plan.revision })} · {t('plan.code', { code: plan.code })}
            </span>
          </p>

          {plan.sections.length === 0 && <p className="text-sm text-poke-text-muted">{t('plan.empty')}</p>}
          <ul className="space-y-2">
            {plan.sections.map((section) => (
              <li key={section.section} className={`${PANEL_INSET} p-2`} data-section={section.section} data-state={section.state}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-heading text-sm font-semibold">{sectionTitle(section.section)}</h3>
                  <Badge variant={CHIP[section.state].variant} size="xs">
                    {t(`plan.chips.${CHIP[section.state].key}`)}
                  </Badge>
                </div>
                {section.rows.length > 0 && (
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                    {section.rows.map((row) => (
                      <div key={row.label} className="contents">
                        <dt className="text-poke-text-muted">{t.dynamic(`plan.rows.${row.label}`, undefined, row.label)}</dt>
                        <dd className="break-words text-poke-text-primary">{rowValue(row.value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {section.items.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {section.items.map((item, index) => (
                      <li key={`${item.title ?? 'item'}-${index}`}>
                        {item.title !== null && <span className="font-semibold">{item.title}: </span>}
                        {item.rows.map((row) => rowValue(row.value)).join(' · ')}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          {plan.assumptions.length > 0 && (
            <section aria-label={t('plan.assumptionsHeading')}>
              <h3 className="font-heading text-sm font-semibold">{t('plan.assumptionsHeading')}</h3>
              <ul className="mt-1 space-y-0.5 text-xs">
                {plan.assumptions.map((assumption) => (
                  <li key={assumption.key}>
                    <code>{assumption.key}</code>
                    {assumption.value !== null && `: ${rowValue(assumption.value)}`}
                    <span className="text-poke-text-muted">
                      {' '}
                      · {assumption.source === 'admin' ? t('plan.why.adminSaid') : assumption.source === 'default' ? t('plan.why.default') : t('plan.why.inferred')} ·{' '}
                      {assumption.confirmed ? t('plan.confirmed') : t('plan.unconfirmed')}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label={t('plan.blockersHeading')}>
            {plan.blockers.length === 0 ? (
              <p className="text-sm text-poke-text-secondary">{t('plan.noBlockers')}</p>
            ) : (
              <>
                <h3 className="font-heading text-sm font-semibold">{t('plan.blockersHeading')}</h3>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                  {plan.blockers.map((blocker, index) => (
                    <li key={`${blocker.code}-${blocker.path}-${index}`}>
                      <span className="text-poke-text-muted">{sectionTitle(blocker.section)}: </span>
                      {blockerText(blocker)}
                      {onAsk !== undefined && (
                        <button
                          type="button"
                          disabled={!canAsk}
                          className="ml-2 text-poke-focus underline underline-offset-2 hover:no-underline disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => onAsk(t('plan.fixPrompt', { problem: blockerText(blocker) }))}
                        >
                          {t('plan.fix')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {plan.warnings.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-poke-yellow-ink">
                {plan.warnings.map((warning, index) => (
                  <li key={`${warning.code}-${index}`}>{blockerText(warning)}</li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-xs text-poke-text-muted">
            {t('plan.readOnlyNote')} {t('plan.factsNote')}
          </p>

          {onAsk !== undefined && (
            <div
              className="sticky bottom-0 z-10 -mx-3 -mb-3 flex flex-wrap items-center gap-2 border-t border-poke-border bg-poke-surface p-3 lg:static lg:m-0 lg:border-0 lg:p-0"
              data-plan-footer
            >
              <Button size="sm" disabled={!plan.ready || !canAsk || plan.status === 'built' || plan.status === 'abandoned' || plan.status === 'building'} onClick={() => onAsk(t('plan.buildPrompt'))}>
                {t('plan.build')}
              </Button>
              {!plan.ready && <p className="min-w-0 flex-1 text-xs text-poke-text-muted">{t('plan.buildBlocked')}</p>}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
