'use client';

import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { rulesetStudioDiagnosticsMessages } from '@/i18n/messages/ruleset-studio/diagnostics';
import { rulesetStudioSummaryMessages } from '@/i18n/messages/ruleset-studio/summary';
import { clauseName } from '@/lib/pkmn/clauses';
import { getPreset } from '@/lib/pkmn/format-catalog';
import type { RulesetDiagnostic } from '@/lib/ruleset-kit/compile';
import { describeRuleset } from '@/lib/ruleset-kit/describe';
import { documentCounts, listChanges } from '@/lib/ruleset-kit/changes';
import { RULESET_CATEGORIES } from '@/lib/ruleset-kit/types';
import { jumpCandidates, type EditorSection } from '@/lib/ruleset-studio/editor/targets';
import type { Locale } from '@/i18n/config';
import { cn } from '@/lib/utils/cn';
import type { RulesetEditorModel } from '../editor/useRulesetEditor';
import { diagnosticText, fixKey } from './diagnostic-text';

export type SummaryTab = 'summary' | 'changes' | 'issues' | 'rules';
const TABS: readonly SummaryTab[] = ['summary', 'changes', 'issues', 'rules'];

interface SummaryPanelProps {
  model: RulesetEditorModel;
  /** The tab that opens first (the tests and the preview open the others directly). */
  initialTab?: SummaryTab;
  /** The language the rules text opens in. */
  initialRulesLocale?: Locale;
  onSelectSection: (section: EditorSection) => void;
  onApplyFix: (diagnostic: RulesetDiagnostic) => void;
}

const MAX_CHANGES = 100;

/** A summary line that jumps to its section: text-sized on a desktop, a full 44px row on a phone. */
const JUMP =
  'inline-flex min-h-11 items-center text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-poke-focus sm:min-h-0';

/**
 * The live summary column: what the ruleset does compared with its base (counts, a diff line), the change list with a
 * revert button per entry, the issues of the compile with "go to the field" and one-click fixes, and the rules text in
 * English or German. The numbers come from the same compile that gates the publish, so the column never claims more or
 * less than the server will accept.
 */
export default function SummaryPanel({ model, initialTab = 'summary', initialRulesLocale = 'en', onSelectSection, onApplyFix }: SummaryPanelProps) {
  const t = useT(rulesetStudioSummaryMessages);
  const tDiag = useT(rulesetStudioDiagnosticsMessages);
  const [tab, setTab] = useState<SummaryTab>(initialTab);
  const [rulesLocale, setRulesLocale] = useState<Locale>(initialRulesLocale);
  const baseId = useId();
  const doc = model.state.doc;
  const result = model.result;
  const counts = useMemo(() => documentCounts(doc, model.preset), [doc, model.preset]);
  const changes = useMemo(() => listChanges(doc), [doc]);
  const catalogPreset = doc.base.kind === 'preset' ? getPreset(doc.base.preset) : undefined;

  const described = useMemo(
    () =>
      result.resolved === null
        ? null
        : describeRuleset(result.resolved, rulesLocale, {
            presetName: catalogPreset?.name ?? null,
            nameOf: (category, id) => model.nameOf(category, id),
            dataLocale: rulesLocale === 'de' ? 'de' : 'en',
          }),
    [result.resolved, rulesLocale, catalogPreset, model],
  );

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.indexOf(tab);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(TABS[next]);
    requestAnimationFrame(() => document.getElementById(`${baseId}-tab-${TABS[next]}`)?.focus());
  };

  const goTo = (pointer: string, section: EditorSection) => {
    onSelectSection(section);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        for (const id of jumpCandidates(pointer)) {
          const element = document.getElementById(id);
          if (element !== null) {
            element.focus();
            return;
          }
        }
        document.getElementById('rf-section-heading')?.focus();
      }),
    );
  };

  const resolved = result.resolved;
  const gameKey = resolved?.doubles ? 'doubles' : 'singles';

  return (
    <section id="rf-summary" aria-labelledby={`${baseId}-heading`} className="min-w-0 space-y-3 rounded-poke-lg border border-poke-border bg-poke-surface p-3 xl:sticky xl:top-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`${baseId}-heading`} className="font-heading text-base font-bold text-poke-text-primary">
          {t('heading')}
        </h2>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2 sm:min-h-0" disabled={!model.canUndo} onClick={model.undo} aria-label={t('undo')}>
            <Undo2 className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2 sm:min-h-0" disabled={!model.canRedo} onClick={model.redo} aria-label={t('redo')}>
            <Redo2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div role="tablist" aria-label={t('tablist')} className="flex flex-wrap gap-1 border-b border-poke-border">
        {TABS.map((id) => {
          const selected = tab === id;
          const issueCount = id === 'issues' ? model.counts.errors + model.counts.warnings : 0;
          return (
            <button
              key={id}
              id={`${baseId}-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={onTabKey}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-poke-focus sm:min-h-9',
                selected ? 'border-poke-accent text-poke-text-primary' : 'border-transparent text-poke-text-secondary hover:text-poke-text-primary',
              )}
            >
              {t(`tab.${id}`)}
              {id === 'issues' && issueCount > 0 && <Badge variant={model.counts.errors > 0 ? 'red' : 'yellow'}>{issueCount}</Badge>}
              {id === 'changes' && changes.length > 0 && <Badge variant="gray">{changes.length}</Badge>}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`${baseId}-panel-${tab}`} aria-labelledby={`${baseId}-tab-${tab}`} tabIndex={0} className="min-w-0 space-y-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-poke-focus">
        {tab === 'summary' && (
          <div className="space-y-3">
            <p className="text-sm text-poke-text-secondary">{catalogPreset === undefined ? t('vsBlank') : t('vs', { preset: catalogPreset.name })}</p>
            {counts.total === 0 ? (
              <p className="text-sm font-semibold text-poke-text-primary">{t('nothingChanged')}</p>
            ) : (
              <p className="text-sm font-semibold text-poke-text-primary">{t('diffLine', { banned: counts.youBanned, unbanned: counts.youUnbanned })}</p>
            )}
            {resolved === null ? (
              <p className="text-sm text-poke-text-secondary">{t('notReady')}</p>
            ) : (
              <>
                <p className="text-xs font-semibold text-poke-text-secondary">
                  {t('format', { gen: resolved.gen, game: t(`game.${gameKey}`) })} · {t(`universe.${resolved.universe}`)}
                </p>
                <ul className="space-y-1 text-sm text-poke-text-primary">
                  {RULESET_CATEGORIES.map((category) => {
                    const list = resolved[category];
                    const own = counts.perCategory[category];
                    return (
                      <li key={category} className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <button type="button" onClick={() => onSelectSection(category)} className={JUMP}>
                          {list.mode === 'allow' ? t(`categoryAllow.${category}`, { count: list.ids.length }) : t(`category.${category}`, { count: list.ids.length })}
                        </button>
                        {list.mode === 'block' && own.baseCount > 0 && (
                          <span className="text-xs text-poke-text-muted">
                            {t('fromPreset', { count: own.baseCount })}
                            {own.youBanned + own.youUnbanned > 0 && ` · ${t('yours', { count: own.youBanned + own.youUnbanned })}`}
                          </span>
                        )}
                      </li>
                    );
                  })}
                  <li>
                    <button type="button" onClick={() => onSelectSection('clauses')} className={JUMP}>
                      {t('clauseCount', { count: resolved.clauses.length })}
                    </button>
                  </li>
                </ul>
              </>
            )}
          </div>
        )}

        {tab === 'changes' && (
          <div className="space-y-2">
            {changes.length === 0 && counts.clausesAdded + counts.clausesRemoved === 0 ? (
              <p className="text-sm text-poke-text-secondary">{t('noChanges')}</p>
            ) : (
              <>
                <h3 className="text-xs font-semibold text-poke-text-secondary">{t('changeList')}</h3>
                <ul className="space-y-1">
                  {doc.clauses.add.map((id) => (
                    <li key={`clause-add-${id}`} className="flex items-center justify-between gap-2 text-sm">
                      <span>
                        <span className="text-poke-text-secondary">{t('clauseAdded')}: </span>
                        {clauseName(id)}
                      </span>
                      <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={() => model.setClauseOn(id, false)} aria-label={t('revertName', { name: clauseName(id) })}>
                        {t('revert')}
                      </Button>
                    </li>
                  ))}
                  {doc.clauses.remove.map((id) => (
                    <li key={`clause-remove-${id}`} className="flex items-center justify-between gap-2 text-sm">
                      <span>
                        <span className="text-poke-text-secondary">{t('clauseRemoved')}: </span>
                        {clauseName(id)}
                      </span>
                      <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={() => model.setClauseOn(id, true)} aria-label={t('revertName', { name: clauseName(id) })}>
                        {t('revert')}
                      </Button>
                    </li>
                  ))}
                  {changes.slice(0, MAX_CHANGES).map((change) => {
                    const name = model.nameOf(change.category, change.id);
                    return (
                      <li key={`${change.category}-${change.kind}-${change.id}`} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">
                          <span className="text-poke-text-secondary">{t(`kind.${change.kind}`)}: </span>
                          {name}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="min-h-11 shrink-0 sm:min-h-0"
                          onClick={() => model.act(change.category, change.kind === 'allow' ? 'ban' : 'reset', [change.id])}
                          aria-label={t('revertName', { name })}
                        >
                          {t('revert')}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                {changes.length > MAX_CHANGES && <p className="text-xs text-poke-text-muted">{t('moreChanges', { count: changes.length - MAX_CHANGES })}</p>}
              </>
            )}
          </div>
        )}

        {tab === 'issues' && (
          <div className="space-y-2">
            {model.rows.length === 0 ? (
              <p className="text-sm text-poke-text-secondary" role="status">{t('issuesNone')}</p>
            ) : (
              <ul className="space-y-2">
                {model.rows.map((row) => {
                  const d = row.diagnostic;
                  return (
                    <li key={row.key} className="space-y-1.5 rounded-poke-md border border-poke-border bg-poke-base p-2.5">
                      <div className="flex items-start gap-2">
                        <Badge variant={d.severity === 'error' ? 'red' : d.severity === 'warning' ? 'yellow' : 'blue'}>
                          {t(`severity.${d.severity}`)}
                        </Badge>
                        <p className="min-w-0 flex-1 text-sm text-poke-text-primary">{diagnosticText(d, tDiag, model.nameOf)}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={() => goTo(d.path, row.section)}>
                          {t('issueGoTo')}
                        </Button>
                        {d.fix !== undefined && (
                          <Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-0" onClick={() => onApplyFix(d)}>
                            {t('issueFix', { label: tDiag(`fix.${fixKey(d.code)}`) })}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {tab === 'rules' && (
          <div className="space-y-3">
            <div role="group" aria-label={t('rulesLanguage')} className="inline-flex overflow-hidden rounded-poke-md border border-poke-border">
              {(['en', 'de'] as const).map((locale) => (
                <button
                  key={locale}
                  type="button"
                  aria-pressed={rulesLocale === locale}
                  onClick={() => setRulesLocale(locale)}
                  className={cn(
                    'min-h-11 px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-poke-focus sm:min-h-9',
                    rulesLocale === locale ? 'bg-poke-accent text-poke-surface' : 'bg-poke-surface text-poke-text-secondary hover:bg-poke-muted',
                  )}
                >
                  {locale === 'en' ? t('rulesEnglish') : t('rulesGerman')}
                </button>
              ))}
            </div>
            {described === null ? (
              <p className="text-sm text-poke-text-secondary">{t('rulesPending')}</p>
            ) : (
              <div lang={rulesLocale} className="space-y-3">
                {described.sections.map((section) => (
                  <div key={section.id} className="space-y-1">
                    <h3 className="text-xs font-semibold text-poke-text-secondary">{section.heading}</h3>
                    {section.lines.map((line) => (
                      <p key={line} className="whitespace-pre-wrap break-words text-sm text-poke-text-primary">
                        {line}
                      </p>
                    ))}
                  </div>
                ))}
                <p className="text-xs font-semibold text-poke-text-muted">{described.coverage}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
