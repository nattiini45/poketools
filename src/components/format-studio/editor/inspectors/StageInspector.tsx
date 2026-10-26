'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { RULESETS_HREF, rulesetReadOnlyHref } from '@/components/ruleset-studio/hrefs';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useLocale, useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { formatStudioPrimitivesMessages } from '@/i18n/messages/format-studio/primitives';
import {
  MAX_BEST_OF,
  MAX_EXPECTED_COUNT,
  MAX_GROUPS,
  MAX_LEGS,
  MAX_OVERRIDES,
  MAX_OVERRIDE_ROUND,
  MAX_RANK_STEPS,
  MAX_SWISS_ROUNDS,
  MIN_GROUPS,
  SCORE_ABS_MAX,
  DEFAULT_RULESET_PRESET,
  ptr,
  resolveLText,
  type Diagnostic,
  type Locale,
  type RankStep,
  type Stage,
} from '@/lib/format-kit/client';
import {
  GROUP_METHODS,
  HEAD_TO_HEAD_SCOPES,
  METRIC_KEYS,
  OVERRIDE_FROM,
  PAIRING_KINDS,
  PARTICIPANT_SOURCES,
  RANK_DIRECTIONS,
  RANK_STEP_KINDS,
  SEEDING_EDGES,
  SEEDING_ROSTER,
  type RulesetChoice,
} from '@/lib/format-studio/editor/catalog';
import type { DraftDocument } from '@/lib/format-studio/editor/document';
import {
  addOverride,
  addRankStep,
  moveRankStep,
  patchOverride,
  patchPairing,
  patchRankStep,
  removeOverride,
  removeRankStep,
  renameStageKey,
  setBestOf,
  setDoubles,
  setExpectedCount,
  setGroups,
  setPairingKind,
  setParticipantsFrom,
  setRuleset,
  setScoreValue,
  setSeeding,
  setRulesetPreset,
  updateStage,
} from '@/lib/format-studio/editor/ops';
import { fieldId } from '@/lib/format-studio/editor/targets';
import { cn } from '@/lib/utils/cn';
import { FieldIssuesProvider, FieldMessage, INSPECTOR_HEADING_ID, PointerMessage, ariaOf, useFieldState } from '../fields/FieldMessage';
import LTextField from '../fields/LTextField';
import NumberField from '../fields/NumberField';
import ReorderControls, { useMoveFocus } from '../fields/ReorderControls';
import SelectField, { CheckboxField, type SelectOption } from '../fields/SelectField';
import RulesetPresetField from '../fields/RulesetPresetField';

/** The value of the ruleset select that stands for a rule preset (a stored ruleset id is a UUID, so it cannot clash). */
const PRESET_OPTION = 'preset';

interface StageInspectorProps {
  doc: DraftDocument;
  /** The selected stage. */
  index: number;
  diagnostics: readonly Diagnostic[];
  rulesets: readonly RulesetChoice[];
  /** The author's language for texts created here (the viewer's language). */
  authorBase: Locale;
  onChange: (next: DraftDocument) => void;
}

function Section({ pointer, legend, children }: { pointer: string; legend: string; children: ReactNode }) {
  return (
    <fieldset id={fieldId(pointer)} tabIndex={-1} className="min-w-0 space-y-3 rounded-poke-lg border border-poke-border p-4 focus:outline-none">
      <legend className="px-1 font-heading text-base font-semibold text-poke-text-primary">{legend}</legend>
      {children}
      <PointerMessage pointer={pointer} />
    </fieldset>
  );
}

/** The key of the stage: read-only, with an explicit edit that checks the pattern and duplicates. */
function KeyEditor({ doc, index, onChange }: { doc: DraftDocument; index: number; onChange: (next: DraftDocument) => void }) {
  const t = useT(formatStudioEditorMessages);
  const p = useT(formatStudioPrimitivesMessages);
  const stage = doc.stages[index];
  const pointer = ptr('stages', index, 'key');
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const state = useFieldState(pointer, { hint: t('inspector.stage.keyHelp'), localError: problem });

  const apply = () => {
    if (draft === null) return;
    const result = renameStageKey(doc, index, draft);
    if (result.ok) {
      onChange(result.doc);
      setDraft(null);
      setProblem(null);
    } else if (result.reason === 'unchanged') {
      setDraft(null);
      setProblem(null);
    } else {
      setProblem(result.reason === 'taken' ? t('inspector.stage.keyTaken') : t('inspector.stage.keyPattern'));
    }
  };

  return (
    <div className="space-y-2">
      {draft === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-poke-text-primary">{p('field.key')}</span>
          <code id={state.id} className="break-all rounded bg-poke-muted px-1.5 py-0.5 text-sm">{stage.key}</code>
          <Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-0" onClick={() => setDraft(stage.key)}>
            {t('inspector.stage.editKey')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Input
            id={state.id}
            label={p('field.key')}
            value={draft}
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setDraft(event.target.value);
              setProblem(null);
            }}
            {...ariaOf(state)}
          />
          <Button type="button" variant="primary" size="sm" className="min-h-11 sm:min-h-0" onClick={apply}>
            {t('inspector.stage.applyKey')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 sm:min-h-0"
            onClick={() => {
              setDraft(null);
              setProblem(null);
            }}
          >
            {t('inspector.stage.cancelKey')}
          </Button>
        </div>
      )}
      <FieldMessage state={state} />
    </div>
  );
}

/** One step of the rank chain. */
function RankStepRow({
  step,
  position,
  count,
  stageIndex,
  onPatch,
  onChangeKind,
  onMove,
  onRemove,
  focusDirection,
  onFocusHandled,
}: {
  step: RankStep;
  position: number;
  count: number;
  stageIndex: number;
  onPatch: (patch: Record<string, unknown>) => void;
  onChangeKind: (kind: RankStep['kind']) => void;
  onMove: (to: number, direction: 'up' | 'down') => void;
  onRemove: () => void;
  focusDirection: 'up' | 'down' | null;
  onFocusHandled: () => void;
}) {
  const t = useT(formatStudioEditorMessages);
  const p = useT(formatStudioPrimitivesMessages);
  const rowPointer = ptr('stages', stageIndex, 'rank', position);
  const n = position + 1;
  return (
    <li className="min-w-0 space-y-2 rounded-poke-md border border-poke-border bg-poke-elevated p-3">
      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          className="min-w-0 flex-1 basis-40"
          pointer={rowPointer}
          label={t('inspector.stage.stepKind', { position: n })}
          value={step.kind}
          options={RANK_STEP_KINDS.map((kind) => ({ value: kind, label: p.dynamic(`label.rank_${kind}`) }))}
          onChange={(value) => onChangeKind(value as RankStep['kind'])}
        />
        {step.kind === 'metric' && (
          <>
            <SelectField
              className="min-w-0 flex-1 basis-40"
              pointer={ptr('stages', stageIndex, 'rank', position, 'metric')}
              label={p('field.metric')}
              value={step.metric}
              options={metricOptions(step.metric, p.dynamic)}
              onChange={(value) => onPatch({ metric: value })}
            />
            <SelectField
              className="min-w-0 flex-1 basis-40"
              pointer={ptr('stages', stageIndex, 'rank', position, 'direction')}
              label={p('field.direction')}
              value={step.direction}
              options={RANK_DIRECTIONS.map((value) => ({ value, label: p.dynamic(`option.direction_${value}`) }))}
              onChange={(value) => onPatch({ direction: value })}
            />
          </>
        )}
        {step.kind === 'head_to_head' && (
          <SelectField
            className="min-w-0 flex-1 basis-40"
            pointer={ptr('stages', stageIndex, 'rank', position, 'scope')}
            label={p('field.scope')}
            value={step.scope}
            options={HEAD_TO_HEAD_SCOPES.map((value) => ({ value, label: p.dynamic(`option.scope_${value}`) }))}
            onChange={(value) => onPatch({ scope: value })}
          />
        )}
        <ReorderControls
          index={position}
          count={count}
          rowKey={`rank-${position}`}
          labels={{
            up: t('inspector.stage.moveStepUp', { position: n }),
            down: t('inspector.stage.moveStepDown', { position: n }),
            remove: t('inspector.stage.removeStep', { position: n }),
          }}
          onMove={onMove}
          onRemove={onRemove}
          focusDirection={focusDirection}
          onFocusHandled={onFocusHandled}
        />
      </div>
    </li>
  );
}

/** A metric the document names that is not a builtin one stays selectable, as itself. */
function metricOptions(current: string, label: (key: string) => string): SelectOption[] {
  const options: SelectOption[] = METRIC_KEYS.map((key) => ({ value: key, label: label(`metric.${key}`) }));
  if (!METRIC_KEYS.some((key) => key === current)) options.push({ value: current, label: current });
  return options;
}

/** A score the engine cannot play yet: shown, never editable, with the reason next to it. */
function UnsupportedScoreRow({ pointer, label, value, reason }: { pointer: string; label: string; value: number | undefined; reason: string }) {
  const state = useFieldState(pointer);
  const reasonId = `${state.id}-why`;
  return (
    <div className="space-y-1">
      <Input
        id={state.id}
        label={label}
        value={value === undefined ? '' : String(value)}
        disabled
        readOnly
        aria-describedby={[reasonId, state.describedBy].filter(Boolean).join(' ')}
        aria-invalid={state.invalid ? true : undefined}
      />
      <p id={reasonId} className="text-sm text-poke-text-muted">
        {reason}
      </p>
      <FieldMessage state={state} />
    </div>
  );
}

/**
 * The form for one stage, as labelled sections: name, participants, groups, pairing, match length, ruleset,
 * scoring and the rank chain. The ruleset is the league default, a stored ruleset (labelled with its newest
 * version, which attach pins; a link opens it in the Ruleset Studio) or a rule preset; the
 * preset kind adds a searchable preset picker and sets the doubles setting the preset implies, which stays
 * editable (attach turns a preset into a ruleset of the league). Every edit is one pure operation on the whole document, handed to `onChange`.
 * Findings of the compiler appear next to the field they are about.
 */
export default function StageInspector({ doc, index, diagnostics, rulesets, authorBase, onChange }: StageInspectorProps) {
  const t = useT(formatStudioEditorMessages);
  const p = useT(formatStudioPrimitivesMessages);
  const locale = useLocale();
  const stage = doc.stages[index];
  const [announcement, setAnnouncement] = useState('');
  const moveFocus = useMoveFocus();
  if (stage === undefined) return null;

  const edit = (fn: (s: Stage) => Stage) => onChange(updateStage(doc, index, fn));
  const base = ptr('stages', index);
  const name = resolveLText(stage.name, { viewer: locale })?.value ?? t('outline.untitled');
  const fromRoster = stage.participants.from === 'roster';
  const eliminationStage = stage.pairing.kind === 'single_elim' || stage.pairing.kind === 'double_elim';
  const seedings = fromRoster ? SEEDING_ROSTER : SEEDING_EDGES;

  const knownRuleset = stage.ruleset.kind !== 'ruleset' || rulesets.some((r) => r.id === (stage.ruleset.kind === 'ruleset' ? stage.ruleset.id : ''));
  const rulesetOptions: SelectOption[] = [
    { value: '', label: t('inspector.stage.rulesetDefault') },
    ...rulesets.map((r) => ({
      value: r.id,
      label: r.version_no !== undefined && r.version_no > 1 ? t('inspector.stage.rulesetOption', { name: r.name, version: r.version_no }) : r.name,
    })),
    ...(stage.ruleset.kind === 'ruleset' && !knownRuleset ? [{ value: stage.ruleset.id, label: t('inspector.stage.rulesetUnknown') }] : []),
    { value: PRESET_OPTION, label: t('inspector.stage.rulesetPreset') },
  ];
  const rulesetValue = stage.ruleset.kind === 'ruleset' ? stage.ruleset.id : stage.ruleset.kind === 'preset' ? PRESET_OPTION : '';
  const chooseRuleset = (value: string) =>
    edit((s) => {
      if (value === '') return setRuleset(s, { kind: 'season_default' });
      // Picking the preset kind starts from the newest generation's OU; the preset field below changes it.
      if (value === PRESET_OPTION) return s.ruleset.kind === 'preset' ? s : setRulesetPreset(s, DEFAULT_RULESET_PRESET);
      return setRuleset(s, { kind: 'ruleset', id: value });
    });

  const pairing = stage.pairing;
  const rank = stage.rank;
  const rankFull = rank.length >= MAX_RANK_STEPS;
  const overrides = stage.series.overrides;
  const overridesFull = overrides.length >= MAX_OVERRIDES;

  return (
    <FieldIssuesProvider diagnostics={diagnostics} definition={doc}>
      <div className="min-w-0 space-y-4" data-inspector="stage">
        <h2 id={INSPECTOR_HEADING_ID} tabIndex={-1} className="break-words font-heading text-xl font-bold text-poke-text-primary focus:outline-none">
          {name}
        </h2>
        <PointerMessage pointer={base} />

        <Section pointer={ptr('stages', index, 'naming')} legend={t('inspector.stage.name')}>
          <LTextField
            pointer={ptr('stages', index, 'name')}
            label={p('field.name')}
            value={stage.name}
            base={authorBase}
            onChange={(next) => next !== undefined && edit((s) => ({ ...s, name: next }))}
          />
          <details className="rounded-poke-md border border-poke-border p-3">
            <summary className="cursor-pointer text-sm font-semibold text-poke-text-primary">{t('inspector.stage.advanced')}</summary>
            <div className="mt-3">
              <KeyEditor doc={doc} index={index} onChange={onChange} />
            </div>
          </details>
        </Section>

        <Section pointer={ptr('stages', index, 'participants')} legend={t('inspector.stage.participants')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              pointer={ptr('stages', index, 'participants', 'from')}
              label={p('field.from')}
              value={stage.participants.from}
              options={PARTICIPANT_SOURCES.map((value) => ({ value, label: p.dynamic(`option.from_${value}`) }))}
              onChange={(value) => edit((s) => setParticipantsFrom(s, value === 'edges' ? 'edges' : 'roster'))}
            />
            <SelectField
              pointer={ptr('stages', index, 'participants', 'seeding')}
              label={p('field.seeding')}
              value={stage.participants.seeding}
              options={seedings.map((value) => ({ value, label: p.dynamic(`option.seeding_${value}`) }))}
              onChange={(value) => edit((s) => setSeeding(s, value))}
            />
            {stage.participants.from === 'roster' && (
              <NumberField
                pointer={ptr('stages', index, 'participants', 'expected_count')}
                label={p('field.expected_count')}
                value={stage.participants.expected_count}
                min={2}
                max={MAX_EXPECTED_COUNT}
                optional
                hint={t('inspector.stage.expectedHelp')}
                onCommit={(value) => edit((s) => setExpectedCount(s, value))}
              />
            )}
          </div>
          <CheckboxField
            pointer={ptr('stages', index, 'doubles')}
            label={p('field.doubles')}
            checked={stage.doubles}
            onChange={(checked) => edit((s) => setDoubles(s, checked))}
          />
        </Section>

        <Section pointer={ptr('stages', index, 'groups')} legend={p('field.groups')}>
          <CheckboxField
            pointer={ptr('stages', index, 'groups', 'enabled')}
            label={t('inspector.stage.groupsOn')}
            checked={stage.groups !== undefined}
            onChange={(checked) => edit((s) => setGroups(s, checked ? { count: MIN_GROUPS, method: 'serpentine' } : undefined))}
          />
          {stage.groups !== undefined && (
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                pointer={ptr('stages', index, 'groups', 'count')}
                label={t('inspector.stage.groupCount')}
                value={stage.groups.count}
                min={MIN_GROUPS}
                max={MAX_GROUPS}
                onCommit={(value) => value !== undefined && edit((s) => setGroups(s, { count: value, method: s.groups?.method ?? 'serpentine' }))}
              />
              <SelectField
                pointer={ptr('stages', index, 'groups', 'method')}
                label={t('inspector.stage.groupMethod')}
                value={stage.groups.method}
                options={GROUP_METHODS.map((value) => ({ value, label: p.dynamic(`option.method_${value}`) }))}
                onChange={(value) =>
                  edit((s) => setGroups(s, { count: s.groups?.count ?? MIN_GROUPS, method: value as NonNullable<Stage['groups']>['method'] }))
                }
              />
            </div>
          )}
        </Section>

        <Section pointer={ptr('stages', index, 'pairing')} legend={p('field.pairing')}>
          <SelectField
            pointer={ptr('stages', index, 'pairing', 'kind')}
            label={t('inspector.stage.pairingKind')}
            value={pairing.kind}
            options={PAIRING_KINDS.map((kind) => ({ value: kind, label: p.dynamic(`label.pairing_${kind}`) }))}
            onChange={(value) => edit((s) => setPairingKind(s, value as Stage['pairing']['kind']))}
          />
          {pairing.kind === 'round_robin' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                pointer={ptr('stages', index, 'pairing', 'legs')}
                label={p('field.legs')}
                value={pairing.legs}
                min={1}
                max={MAX_LEGS}
                onCommit={(value) => value !== undefined && edit((s) => patchPairing(s, { legs: value }))}
              />
              <CheckboxField
                className="self-end"
                pointer={ptr('stages', index, 'pairing', 'mirror_legs')}
                label={p('field.mirror_legs')}
                checked={pairing.mirror_legs}
                onChange={(checked) => edit((s) => patchPairing(s, { mirror_legs: checked }))}
              />
            </div>
          )}
          {pairing.kind === 'swiss' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                pointer={ptr('stages', index, 'pairing', 'rounds_mode')}
                label={p('field.rounds')}
                value={pairing.rounds === 'auto' ? 'auto' : 'fixed'}
                options={[
                  { value: 'auto', label: p('option.rounds_auto') },
                  { value: 'fixed', label: t('inspector.stage.roundsFixed') },
                ]}
                onChange={(value) => edit((s) => patchPairing(s, { rounds: value === 'auto' ? 'auto' : 3 }))}
              />
              {pairing.rounds !== 'auto' && (
                <NumberField
                  pointer={ptr('stages', index, 'pairing', 'rounds')}
                  label={t('inspector.stage.swissRounds')}
                  value={pairing.rounds}
                  min={1}
                  max={MAX_SWISS_ROUNDS}
                  onCommit={(value) => value !== undefined && edit((s) => patchPairing(s, { rounds: value }))}
                />
              )}
              <CheckboxField
                pointer={ptr('stages', index, 'pairing', 'avoid_repeats')}
                label={p('field.avoid_repeats')}
                checked={pairing.avoid_repeats}
                onChange={(checked) => edit((s) => patchPairing(s, { avoid_repeats: checked }))}
              />
            </div>
          )}
          {pairing.kind === 'single_elim' && (
            <CheckboxField
              pointer={ptr('stages', index, 'pairing', 'third_place')}
              label={p('field.third_place')}
              checked={pairing.third_place}
              onChange={(checked) => edit((s) => patchPairing(s, { third_place: checked }))}
            />
          )}
          {pairing.kind === 'double_elim' && (
            <CheckboxField
              pointer={ptr('stages', index, 'pairing', 'bracket_reset')}
              label={p('field.bracket_reset')}
              checked={pairing.bracket_reset}
              onChange={(checked) => edit((s) => patchPairing(s, { bracket_reset: checked }))}
            />
          )}
        </Section>

        <Section pointer={ptr('stages', index, 'series')} legend={p('field.series')}>
          <NumberField
            pointer={ptr('stages', index, 'series', 'best_of')}
            label={p('field.best_of')}
            value={stage.series.best_of}
            min={1}
            max={MAX_BEST_OF}
            hint={t('inspector.stage.bestOfHelp')}
            onCommit={(value) => value !== undefined && edit((s) => setBestOf(s, value))}
          />
          <div className="space-y-2">
            <h3 className="font-heading text-sm font-semibold text-poke-text-primary">{t('inspector.stage.exceptions')}</h3>
            {overrides.length === 0 && <p className="text-sm text-poke-text-muted">{t('inspector.stage.exceptionsNone')}</p>}
            <ul className="space-y-2">
              {overrides.map((override, j) => (
                <li key={j} className="flex flex-wrap items-end gap-3 rounded-poke-md border border-poke-border bg-poke-elevated p-3">
                  <NumberField
                    className="min-w-0 flex-1 basis-24"
                    pointer={ptr('stages', index, 'series', 'overrides', j, 'round')}
                    label={p('field.round')}
                    value={override.round}
                    min={1}
                    max={MAX_OVERRIDE_ROUND}
                    onCommit={(value) => value !== undefined && edit((s) => patchOverride(s, j, { round: value }))}
                  />
                  <SelectField
                    className="min-w-0 flex-1 basis-40"
                    pointer={ptr('stages', index, 'series', 'overrides', j, 'from')}
                    label={t('inspector.stage.fromWhere')}
                    value={override.from}
                    options={OVERRIDE_FROM.map((value) => ({ value, label: p.dynamic(`option.from_${value}`) }))}
                    onChange={(value) => edit((s) => patchOverride(s, j, { from: value === 'end' ? 'end' : 'start' }))}
                  />
                  <NumberField
                    className="min-w-0 flex-1 basis-24"
                    pointer={ptr('stages', index, 'series', 'overrides', j, 'best_of')}
                    label={p('field.best_of')}
                    value={override.best_of}
                    min={1}
                    max={MAX_BEST_OF}
                    onCommit={(value) => value !== undefined && edit((s) => patchOverride(s, j, { best_of: value }))}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="min-h-11 sm:min-h-0"
                    onClick={() => edit((s) => removeOverride(s, j))}
                  >
                    {t('inspector.stage.removeException', { position: j + 1 })}
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-11 sm:min-h-0"
                disabled={overridesFull}
                aria-describedby={overridesFull ? 'fe-limit-overrides' : undefined}
                onClick={() => edit((s) => addOverride(s))}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t('inspector.stage.addException')}
              </Button>
              {overridesFull && (
                <p id="fe-limit-overrides" className="text-sm text-poke-text-muted">
                  {t('inspector.stage.limitExceptions', { max: MAX_OVERRIDES })}
                </p>
              )}
            </div>
          </div>
        </Section>

        <Section pointer={ptr('stages', index, 'ruleset')} legend={p('field.ruleset')}>
          <SelectField
            pointer={ptr('stages', index, 'ruleset', 'id')}
            label={p('field.ruleset')}
            value={rulesetValue}
            options={rulesetOptions}
            onChange={chooseRuleset}
          />
          {stage.ruleset.kind === 'ruleset' && knownRuleset && (
            <p className="text-sm text-poke-text-muted">{t('inspector.stage.rulesetHelp')}</p>
          )}
          {stage.ruleset.kind === 'preset' && (
            <RulesetPresetField
              pointer={ptr('stages', index, 'ruleset', 'preset')}
              label={t('inspector.stage.rulesetPreset')}
              value={stage.ruleset.preset}
              hint={t('inspector.stage.presetHelp')}
              onChange={(value) => edit((s) => setRulesetPreset(s, value))}
            />
          )}
          <Link
            href={stage.ruleset.kind === 'ruleset' && knownRuleset ? rulesetReadOnlyHref(stage.ruleset.id) : RULESETS_HREF}
            className="inline-flex min-h-11 items-center text-sm font-medium text-poke-blue hover:underline sm:min-h-0"
          >
            {t('inspector.stage.openStudio')}
          </Link>
        </Section>

        <Section pointer={ptr('stages', index, 'scoring')} legend={p('field.scoring')}>
          <div className="grid gap-3 sm:grid-cols-3">
            {(['win', 'loss', 'bye'] as const).map((key) => (
              <NumberField
                key={key}
                pointer={ptr('stages', index, 'scoring', key)}
                label={p(`field.${key}`)}
                value={stage.scoring[key]}
                integer={false}
                min={-SCORE_ABS_MAX}
                max={SCORE_ABS_MAX}
                onCommit={(value) => value !== undefined && edit((s) => setScoreValue(s, key, value))}
              />
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <UnsupportedScoreRow
              pointer={ptr('stages', index, 'scoring', 'draw')}
              label={p('field.draw')}
              value={stage.scoring.draw}
              reason={t('inspector.stage.drawDisabled')}
            />
            <UnsupportedScoreRow
              pointer={ptr('stages', index, 'scoring', 'forfeit')}
              label={p('field.forfeit')}
              value={stage.scoring.forfeit}
              reason={t('inspector.stage.forfeitDisabled')}
            />
          </div>
        </Section>

        <Section pointer={ptr('stages', index, 'rank')} legend={p('field.rank')}>
          {eliminationStage && <p className="text-sm text-poke-text-muted">{t('inspector.stage.rankIgnored')}</p>}
          {rank.length === 0 && <p className="text-sm text-poke-text-muted">{t('inspector.stage.rankNone')}</p>}
          <ol className="space-y-2" aria-label={p('field.rank')}>
            {rank.map((step, j) => (
              <RankStepRow
                key={j}
                step={step}
                position={j}
                count={rank.length}
                stageIndex={index}
                onPatch={(patch) => edit((s) => patchRankStep(s, j, patch))}
                onChangeKind={(kind) =>
                  edit((s) => {
                    if (s.rank[j]?.kind === kind) return s;
                    const added = addRankStep(removeRankStep(s, j), kind);
                    return moveRankStep(added, added.rank.length - 1, j);
                  })
                }
                onMove={(to, direction) => {
                  edit((s) => moveRankStep(s, j, to));
                  moveFocus.mark(to, direction);
                  setAnnouncement(t('inspector.stage.moved', { position: to + 1, total: rank.length }));
                }}
                onRemove={() => edit((s) => removeRankStep(s, j))}
                focusDirection={moveFocus.focusFor(j)}
                onFocusHandled={moveFocus.clear}
              />
            ))}
          </ol>
          <p role="status" className="sr-only">
            {announcement}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <AddStep disabled={rankFull} onAdd={(kind) => edit((s) => addRankStep(s, kind))} pointer={ptr('stages', index, 'rank', 'add')} />
            {rankFull && (
              <p id="fe-limit-rank" className="text-sm text-poke-text-muted">
                {t('inspector.stage.limitSteps', { max: MAX_RANK_STEPS })}
              </p>
            )}
          </div>
        </Section>
      </div>
    </FieldIssuesProvider>
  );
}

/** The add control of the rank chain: a kind select and an Add button that is disabled with its reason at the limit. */
function AddStep({ pointer, disabled, onAdd }: { pointer: string; disabled: boolean; onAdd: (kind: RankStep['kind']) => void }) {
  const t = useT(formatStudioEditorMessages);
  const p = useT(formatStudioPrimitivesMessages);
  const [kind, setKind] = useState<RankStep['kind']>('metric');
  return (
    <>
      <SelectField
        className="min-w-0 basis-56"
        pointer={pointer}
        label={t('inspector.stage.addStepKind')}
        value={kind}
        disabled={disabled}
        options={RANK_STEP_KINDS.map((value) => ({ value, label: p.dynamic(`label.rank_${value}`) }))}
        onChange={(value) => setKind(value as RankStep['kind'])}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={cn('min-h-11 sm:min-h-0')}
        disabled={disabled}
        aria-describedby={disabled ? 'fe-limit-rank' : undefined}
        onClick={() => onAdd(kind)}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t('inspector.stage.addStep')}
      </Button>
    </>
  );
}
