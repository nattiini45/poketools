'use client';

import { useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import { useLocale, useT } from '@/i18n/client';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import { getRulesetPreset } from '@/lib/format-kit/client';
import { GENERATIONS, getPreset } from '@/lib/pkmn/format-catalog';
import type { PresetUnmodelled } from '@/lib/pkmn/format-catalog';
import type { PresetRules } from '@/lib/pkmn/preset-rules';
import { applyTourOverlay } from '@/lib/ruleset-kit/overlay';
import { RULESET_CATEGORIES, type RulesetUniverse } from '@/lib/ruleset-kit/types';
import { fetchTourOverlay } from '@/lib/ruleset-studio/editor/catalog-client';
import type { DraftDocument } from '@/lib/ruleset-studio/editor/document';
import type { PresetStatus } from '../editor/useRulesetEditor';
import LTextPair from './LTextPair';
import PresetBrowser from './PresetBrowser';
import RebaseDialog, { BLANK_TARGET } from './RebaseDialog';
import { fieldId } from '@/lib/ruleset-studio/editor/targets';

interface BaseSectionProps {
  doc: DraftDocument;
  preset: PresetRules | null;
  presetStatus: PresetStatus;
  onRetryPreset: () => void;
  loadPreset: (id: string) => Promise<PresetRules | null>;
  /** A plain edit of the document (name, summary, the blank base's fields). */
  onChange: (next: DraftDocument) => void;
  /** An edit that rewrites the base: the editor clears the undo history. */
  onReplace: (next: DraftDocument) => void;
}

/**
 * "Base and basics": the ruleset's name and summary, and what every list is measured against. A preset base shows the
 * preset (its generation and tier, what it rules out, what the app does not model), a way to change it through the
 * catalog browser and the rebase dialog, a switch to a blank base, and, for the Smogon draft presets that have
 * documented tour extras, a button that adds them as ordinary entries. A blank base shows its generation, game type and
 * universe as fields.
 */
export default function BaseSection({ doc, preset, presetStatus, onRetryPreset, loadPreset, onChange, onReplace }: BaseSectionProps) {
  const t = useT(rulesetStudioSectionsMessages);
  const locale = useLocale();
  const [browsing, setBrowsing] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [tourMessage, setTourMessage] = useState<{ kind: 'applied' | 'nothing' | 'failed'; clauses: number; bans: number } | null>(null);
  const [tourBusy, setTourBusy] = useState(false);

  const base = doc.base;
  const entry = base.kind === 'preset' ? getRulesetPreset(base.preset) : undefined;
  const catalogPreset = base.kind === 'preset' ? getPreset(base.preset) : undefined;

  const addTour = async () => {
    if (base.kind !== 'preset' || preset === null) return;
    setTourBusy(true);
    setTourMessage(null);
    try {
      const outcome = await fetchTourOverlay(base.preset);
      if (!outcome.ok) {
        setTourMessage({ kind: 'failed', clauses: 0, bans: 0 });
        return;
      }
      const { document, applied } = applyTourOverlay(doc, outcome.data, preset);
      const bans = applied.banned.moves.length + applied.banned.items.length + applied.banned.abilities.length;
      const clauses = applied.clausesAdded.length + applied.clausesRemoved.length;
      if (bans + clauses === 0) {
        setTourMessage({ kind: 'nothing', clauses: 0, bans: 0 });
        return;
      }
      onReplace(document);
      setTourMessage({ kind: 'applied', clauses, bans });
    } finally {
      setTourBusy(false);
    }
  };

  const unmodelled = (preset?.facts.unmodelled ?? []) as readonly PresetUnmodelled[];

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <LTextPair
          pointer="/identity/name"
          label={t('fields.name')}
          value={doc.identity.name}
          base={locale}
          required
          onChange={(name) => name !== undefined && onChange({ ...doc, identity: { ...doc.identity, name } })}
        />
        <LTextPair
          pointer="/identity/summary"
          label={t('fields.summary')}
          value={doc.identity.summary}
          base={locale}
          multiline
          onChange={(summary) => {
            const identity = { ...doc.identity };
            if (summary === undefined) delete identity.summary;
            else identity.summary = summary;
            onChange({ ...doc, identity });
          }}
        />
      </div>

      <section className="space-y-3 rounded-poke-lg border border-poke-border bg-poke-surface p-4" aria-labelledby="rf-base-preset">
        <h3 id="rf-base-preset" className="font-heading text-base font-bold text-poke-text-primary">
          {base.kind === 'preset' ? t('base.presetHeading') : t('base.blankHeading')}
        </h3>
        <p className="text-sm text-poke-text-secondary">{t('base.intro')}</p>

        {base.kind === 'preset' ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-heading text-lg font-bold text-poke-text-primary">{entry?.name ?? base.preset}</span>
              {entry !== undefined && (
                <span className="text-sm text-poke-text-secondary">
                  {entry.genLabel} · {entry.tierLabel}
                </span>
              )}
            </div>

            {presetStatus === 'loading' && <p role="status" className="text-sm text-poke-text-secondary">{t('base.presetLoading')}</p>}
            {presetStatus === 'error' && (
              <Alert variant="error" className="flex flex-wrap items-center justify-between gap-2">
                <span>{t('base.presetFailed')}</span>
                <Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-0" onClick={onRetryPreset}>
                  {t('base.retry')}
                </Button>
              </Alert>
            )}
            {preset !== null && (
              <>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-poke-text-secondary">
                  {RULESET_CATEGORIES.map((category) => (
                    <li key={category}>{t(`base.bansInPreset.${category}`, { count: preset[category].ids.length })}</li>
                  ))}
                </ul>
                {RULESET_CATEGORIES.some((category) => preset[category].mode === 'allow') && <p className="text-sm text-poke-text-secondary">{t('base.rosterNote')}</p>}
                {unmodelled.length > 0 && (
                  <p className="text-sm text-poke-text-secondary">
                    {t('base.unmodelled', { list: unmodelled.map((kind) => t(`base.unmodelledKind.${kind}`)).join(', ') })}
                  </p>
                )}
              </>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-0" onClick={() => setBrowsing(true)}>
                {t('base.changePreset')}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-0" disabled={preset === null} onClick={() => setTarget(BLANK_TARGET)}>
                {t('base.toBlank')}
              </Button>
            </div>
            <p className="text-xs text-poke-text-muted">{t('base.toBlankHelp')}</p>

            {catalogPreset?.tourOverlay === true && (
              <div className="space-y-2 rounded-poke-md border border-poke-border bg-poke-base p-3">
                <h4 className="text-sm font-semibold text-poke-text-primary">{t('base.tourHeading')}</h4>
                <p className="text-xs text-poke-text-secondary">{t('base.tourHelp')}</p>
                <Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-0" loading={tourBusy} disabled={preset === null} onClick={() => void addTour()}>
                  {t('base.tourAdd')}
                </Button>
                {tourMessage !== null && (
                  <p role="status" className="text-sm text-poke-text-secondary">
                    {tourMessage.kind === 'applied' ? t('base.tourApplied', { clauses: tourMessage.clauses, bans: tourMessage.bans }) : tourMessage.kind === 'nothing' ? t('base.tourNothing') : t('base.tourFailed')}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-poke-text-secondary">{t('base.blankIntro')}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Select
                id={fieldId('/base/gen')}
                label={t('base.generation')}
                value={String(base.gen)}
                onChange={(event) => onChange({ ...doc, base: { ...base, gen: Number(event.target.value) } })}
              >
                {GENERATIONS.map((generation) => (
                  <option key={generation.num} value={generation.num}>
                    {generation.label}
                  </option>
                ))}
              </Select>
              <Select
                id={fieldId('/base/doubles')}
                label={t('base.gameType')}
                value={base.doubles ? 'doubles' : 'singles'}
                onChange={(event) => onChange({ ...doc, base: { ...base, doubles: event.target.value === 'doubles' } })}
              >
                <option value="singles">{t('base.singles')}</option>
                <option value="doubles">{t('base.doubles')}</option>
              </Select>
              <Select
                id={fieldId('/base/universe')}
                label={t('base.universe')}
                value={base.universe}
                onChange={(event) => onChange({ ...doc, base: { ...base, universe: event.target.value as RulesetUniverse } })}
              >
                <option value="standard">{t('base.universeStandard')}</option>
                <option value="national">{t('base.universeNational')}</option>
              </Select>
            </div>
            <Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-0" onClick={() => setBrowsing(true)}>
              {t('base.changePreset')}
            </Button>
          </div>
        )}
      </section>

      <PresetBrowser
        open={browsing}
        onClose={() => setBrowsing(false)}
        currentId={base.kind === 'preset' ? base.preset : null}
        onChoose={(id) => {
          setBrowsing(false);
          setTarget(id);
        }}
      />
      <RebaseDialog
        target={target}
        doc={doc}
        fromPreset={base.kind === 'preset' ? preset : null}
        loadPreset={loadPreset}
        onClose={() => setTarget(null)}
        onApply={(next) => {
          setTarget(null);
          onReplace(next);
        }}
      />
    </div>
  );
}
