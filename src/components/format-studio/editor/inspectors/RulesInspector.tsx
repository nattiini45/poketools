'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { useLocale, useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { formatStudioPrimitivesMessages } from '@/i18n/messages/format-studio/primitives';
import {
  MAX_RULES,
  MAX_TEXT_SECTIONS,
  computeCoverage,
  describeCoverage,
  ptr,
  resolveLText,
  type Diagnostic,
  type Locale,
  type RuleCard,
} from '@/lib/format-kit/client';
import { RULE_VERIFY_MODES, RULE_WHEN } from '@/lib/format-studio/editor/catalog';
import type { DraftDocument } from '@/lib/format-studio/editor/document';
import {
  addRuleCard,
  addTextSection,
  duplicateRuleCard,
  moveRuleCard,
  moveTextSection,
  removeRuleCard,
  removeTextSection,
  updateRuleCard,
  updateTextSection,
} from '@/lib/format-studio/editor/ops';
import { FieldIssuesProvider, INSPECTOR_HEADING_ID, PointerMessage } from '../fields/FieldMessage';
import LTextField from '../fields/LTextField';
import ReorderControls, { useMoveFocus } from '../fields/ReorderControls';
import SelectField, { CheckboxField, type SelectOption } from '../fields/SelectField';

/** Which of the two lists the outline selected; `both` shows them one after the other. */
export type RulesPart = 'rules' | 'text' | 'both';

interface RulesInspectorProps {
  doc: DraftDocument;
  diagnostics: readonly Diagnostic[];
  authorBase: Locale;
  onChange: (next: DraftDocument) => void;
  part?: RulesPart;
}

/** The add button of a list; at the limit it is disabled and the reason sits next to it. */
function AddButton({ label, limit, full, limitId, onClick }: { label: string; limit: string; full: boolean; limitId: string; onClick: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        className="min-h-11 sm:min-h-0"
        disabled={full}
        aria-describedby={full ? limitId : undefined}
        onClick={onClick}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {label}
      </Button>
      {full && (
        <p id={limitId} className="text-sm text-poke-text-muted">
          {limit}
        </p>
      )}
    </div>
  );
}

/**
 * The written rules of a format: honor rule cards (rules nobody enforces automatically) and rules text
 * sections, with the coverage line below so the "Honor system" badge has its meaning next to it.
 */
export default function RulesInspector({ doc, diagnostics, authorBase, onChange, part = 'both' }: RulesInspectorProps) {
  const t = useT(formatStudioEditorMessages);
  const p = useT(formatStudioPrimitivesMessages);
  const locale = useLocale();
  const cardFocus = useMoveFocus();
  const sectionFocus = useMoveFocus();
  const [announcement, setAnnouncement] = useState('');

  const stageOptions = (current: string | undefined, withNone: boolean): SelectOption[] => {
    const options: SelectOption[] = doc.stages.map((s) => ({ value: s.key, label: resolveLText(s.name, { viewer: locale })?.value ?? s.key }));
    if (current !== undefined && current !== '' && !doc.stages.some((s) => s.key === current)) options.push({ value: current, label: current });
    return withNone ? [{ value: '', label: t('inspector.rules.wholeFormat') }, ...options] : options;
  };

  const cards = doc.rules;
  const sections = doc.text.sections;
  const cardsFull = cards.length >= MAX_RULES;
  const sectionsFull = sections.length >= MAX_TEXT_SECTIONS;
  const coverage = describeCoverage(computeCoverage(doc), locale);
  const preview = (text: RuleCard['text'] | undefined, fallback: string) => {
    const resolved = text === undefined ? null : resolveLText(text, { viewer: locale })?.value;
    return resolved === null || resolved === undefined || resolved === '' ? fallback : resolved.length > 60 ? `${resolved.slice(0, 57)}…` : resolved;
  };

  return (
    <FieldIssuesProvider diagnostics={diagnostics} definition={doc}>
      <div className="min-w-0 space-y-6" data-inspector="rules">
        <h2 id={INSPECTOR_HEADING_ID} tabIndex={-1} className="font-heading text-xl font-bold text-poke-text-primary focus:outline-none">
          {part === 'text' ? t('inspector.rules.textHeading') : t('inspector.rules.honorHeading')}
        </h2>

        {part !== 'text' && (
          <section className="min-w-0 space-y-3" aria-labelledby="fe-honor-heading">
            <h3 id="fe-honor-heading" className="font-heading text-base font-semibold text-poke-text-primary">
              {t('inspector.rules.honorCards')}
            </h3>
            <p className="text-sm text-poke-text-secondary">{t('inspector.rules.honorIntro')}</p>
            {cards.length === 0 && <p className="text-sm text-poke-text-muted">{t('inspector.rules.honorNone')}</p>}
            <ol className="space-y-3" aria-label={t('inspector.rules.honorCards')}>
              {cards.map((card, i) => {
                const name = preview(card.text, t('inspector.rules.cardUntitled', { position: i + 1 }));
                const update = (fn: (c: RuleCard) => RuleCard) => onChange(updateRuleCard(doc, i, fn));
                return (
                  <li key={card.id} className="min-w-0 space-y-3 rounded-poke-lg border border-poke-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge variant="accent">{p('level.honor')}</Badge>
                      <ReorderControls
                        index={i}
                        count={cards.length}
                        rowKey={card.id}
                        labels={{
                          up: t('inspector.rules.moveCardUp', { name }),
                          down: t('inspector.rules.moveCardDown', { name }),
                          duplicate: t('inspector.rules.duplicateCard', { name }),
                          remove: t('inspector.rules.removeCard', { name }),
                        }}
                        duplicateDisabled={cardsFull}
                        onMove={(to, direction) => {
                          onChange(moveRuleCard(doc, i, to));
                          cardFocus.mark(to, direction);
                          setAnnouncement(t('inspector.rules.cardMoved', { position: to + 1, total: cards.length }));
                        }}
                        onDuplicate={() => {
                          const result = duplicateRuleCard(doc, i);
                          if (result.index >= 0) onChange(result.doc);
                        }}
                        onRemove={() => onChange(removeRuleCard(doc, i))}
                        focusDirection={cardFocus.focusFor(i)}
                        onFocusHandled={cardFocus.clear}
                      />
                    </div>
                    <PointerMessage pointer={ptr('rules', i)} />
                    <LTextField
                      pointer={ptr('rules', i, 'text')}
                      label={t('inspector.rules.text')}
                      value={card.text}
                      base={authorBase}
                      multiline
                      onChange={(next) => next !== undefined && update((c) => ({ ...c, text: next }))}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <SelectField
                        pointer={ptr('rules', i, 'scope', 'kind')}
                        label={t('inspector.rules.scope')}
                        value={card.scope.kind}
                        options={[
                          { value: 'season', label: p('option.kind_season') },
                          { value: 'stage', label: p('option.kind_stage') },
                        ]}
                        onChange={(value) =>
                          update((c) => ({
                            ...c,
                            scope: value === 'stage' ? { kind: 'stage', stage: doc.stages[0]?.key ?? '' } : { kind: 'season' },
                          }))
                        }
                      />
                      {card.scope.kind === 'stage' && (
                        <SelectField
                          pointer={ptr('rules', i, 'scope', 'stage')}
                          label={p('field.stage')}
                          value={card.scope.stage}
                          options={stageOptions(card.scope.stage, false)}
                          onChange={(value) => update((c) => ({ ...c, scope: { kind: 'stage', stage: value } }))}
                        />
                      )}
                      <SelectField
                        pointer={ptr('rules', i, 'verify')}
                        label={p('field.verify')}
                        value={card.verify}
                        options={RULE_VERIFY_MODES.map((value) => ({ value, label: p.dynamic(`option.verify_${value}`) }))}
                        onChange={(value) => update((c) => ({ ...c, verify: value as RuleCard['verify'] }))}
                      />
                    </div>
                    <details className="rounded-poke-md border border-poke-border p-3">
                      <summary className="cursor-pointer text-sm font-semibold text-poke-text-primary">{t('inspector.rules.more')}</summary>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <SelectField
                          pointer={ptr('rules', i, 'when')}
                          label={t('inspector.rules.applies')}
                          value={card.when}
                          options={RULE_WHEN.map((value) => ({ value, label: p.dynamic(`option.when_${value}`) }))}
                          onChange={(value) => update((c) => ({ ...c, when: value as RuleCard['when'] }))}
                        />
                        <CheckboxField
                          className="self-end"
                          pointer={ptr('rules', i, 'visible_to_players')}
                          label={p('field.visible_to_players')}
                          checked={card.visible_to_players}
                          onChange={(checked) => update((c) => ({ ...c, visible_to_players: checked }))}
                        />
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
            <AddButton
              label={t('inspector.rules.addCard')}
              limit={t('inspector.rules.limitCards', { max: MAX_RULES })}
              full={cardsFull}
              limitId="fe-limit-cards"
              onClick={() => {
                const result = addRuleCard(doc, authorBase);
                if (result.index >= 0) onChange(result.doc);
              }}
            />
          </section>
        )}

        {part !== 'rules' && (
          <section className="min-w-0 space-y-3" aria-labelledby="fe-sections-heading">
            <h3 id="fe-sections-heading" className="font-heading text-base font-semibold text-poke-text-primary">
              {t('inspector.rules.sectionsHeading')}
            </h3>
            <p className="text-sm text-poke-text-secondary">{t('inspector.rules.sectionsIntro')}</p>
            {sections.length === 0 && <p className="text-sm text-poke-text-muted">{t('inspector.rules.sectionsNone')}</p>}
            <ol className="space-y-3" aria-label={t('inspector.rules.sectionsHeading')}>
              {sections.map((section, i) => {
                const name = preview(section.title, t('inspector.rules.sectionUntitled', { position: i + 1 }));
                return (
                  <li key={section.id} className="min-w-0 space-y-3 rounded-poke-lg border border-poke-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="min-w-0 break-words font-heading text-sm font-semibold text-poke-text-primary">{name}</h4>
                      <ReorderControls
                        index={i}
                        count={sections.length}
                        rowKey={section.id}
                        labels={{
                          up: t('inspector.rules.moveSectionUp', { name }),
                          down: t('inspector.rules.moveSectionDown', { name }),
                          remove: t('inspector.rules.removeSection', { name }),
                        }}
                        onMove={(to, direction) => {
                          onChange(moveTextSection(doc, i, to));
                          sectionFocus.mark(to, direction);
                          setAnnouncement(t('inspector.rules.sectionMoved', { position: to + 1, total: sections.length }));
                        }}
                        onRemove={() => onChange(removeTextSection(doc, i))}
                        focusDirection={sectionFocus.focusFor(i)}
                        onFocusHandled={sectionFocus.clear}
                      />
                    </div>
                    <PointerMessage pointer={ptr('text', 'sections', i)} />
                    <LTextField
                      pointer={ptr('text', 'sections', i, 'title')}
                      label={t('inspector.rules.sectionTitle')}
                      value={section.title}
                      base={authorBase}
                      onChange={(next) => next !== undefined && onChange(updateTextSection(doc, i, (s) => ({ ...s, title: next })))}
                    />
                    <LTextField
                      pointer={ptr('text', 'sections', i, 'body')}
                      label={t('inspector.rules.sectionBody')}
                      value={section.body}
                      base={authorBase}
                      multiline
                      onChange={(next) => next !== undefined && onChange(updateTextSection(doc, i, (s) => ({ ...s, body: next })))}
                    />
                    <SelectField
                      pointer={ptr('text', 'sections', i, 'stage')}
                      label={t('inspector.rules.sectionStage')}
                      value={section.stage ?? ''}
                      options={stageOptions(section.stage, true)}
                      onChange={(value) =>
                        onChange(
                          updateTextSection(doc, i, (s) => {
                            const { stage: _removed, ...rest } = s;
                            return value === '' ? rest : { ...rest, stage: value };
                          }),
                        )
                      }
                    />
                  </li>
                );
              })}
            </ol>
            <AddButton
              label={t('inspector.rules.addSection')}
              limit={t('inspector.rules.limitSections', { max: MAX_TEXT_SECTIONS })}
              full={sectionsFull}
              limitId="fe-limit-sections"
              onClick={() => {
                const result = addTextSection(doc, authorBase);
                if (result.index >= 0) onChange(result.doc);
              }}
            />
          </section>
        )}

        <p role="status" className="sr-only">
          {announcement}
        </p>
        <p className="break-words text-sm text-poke-text-secondary">{coverage}</p>
      </div>
    </FieldIssuesProvider>
  );
}
