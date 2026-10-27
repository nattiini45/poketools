'use client';

import { useEffect, useMemo, useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useT } from '@/i18n/client';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import { getRulesetPreset } from '@/lib/pkmn/ruleset-preset-catalog';
import type { PresetRules } from '@/lib/pkmn/preset-rules';
import { computeEffective, diffResolved } from '@/lib/ruleset-kit/effective';
import { blankBaseOf, rebase } from '@/lib/ruleset-kit/ops';
import { RULESET_CATEGORIES, type RulesetBase } from '@/lib/ruleset-kit/types';
import type { DraftDocument } from '@/lib/ruleset-studio/editor/document';

/** The target of a rebase: a catalog preset id, or the blank base. */
export const BLANK_TARGET = 'blank';

interface RebaseDialogProps {
  /** The preset id or `BLANK_TARGET` to switch to; null closes the dialog. */
  target: string | null;
  doc: DraftDocument;
  /** The resolved rules of the current base preset (null for a blank base). */
  fromPreset: PresetRules | null;
  loadPreset: (id: string) => Promise<PresetRules | null>;
  onApply: (next: DraftDocument) => void;
  onClose: () => void;
}

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ready'; preset: PresetRules | null };

/** The document after a switch that keeps the lists as written (no rewriting): only the base and `based_on` change. */
function switchedAsWritten(doc: DraftDocument, base: RulesetBase): DraftDocument {
  const identity = { ...doc.identity };
  if (base.kind === 'preset') identity.based_on = base.preset;
  return { ...doc, identity, base };
}

function Body({ target, doc, fromPreset, loadPreset, onApply, onClose }: Omit<RebaseDialogProps, 'target'> & { target: string }) {
  const t = useT(rulesetStudioSectionsMessages);
  const [loaded, setLoaded] = useState<Loaded>(target === BLANK_TARGET ? { status: 'ready', preset: null } : { status: 'loading' });
  const [keepRules, setKeepRules] = useState(true);

  useEffect(() => {
    if (target === BLANK_TARGET) return;
    let current = true;
    void loadPreset(target).then((preset) => {
      if (current) setLoaded(preset === null ? { status: 'error' } : { status: 'ready', preset });
    });
    return () => {
      current = false;
    };
  }, [target, loadPreset]);

  const name = target === BLANK_TARGET ? t('base.blankHeading') : (getRulesetPreset(target)?.name ?? target);
  const plan = useMemo(() => {
    if (loaded.status !== 'ready') return null;
    const base: RulesetBase =
      target === BLANK_TARGET ? (fromPreset === null ? doc.base : blankBaseOf(fromPreset)) : { kind: 'preset', preset: target };
    const to = { base, preset: loaded.preset };
    const rewritten = rebase(doc, fromPreset, to);
    const next = keepRules ? rewritten.doc : switchedAsWritten(doc, base);
    let diff: ReturnType<typeof diffResolved> | null = null;
    try {
      diff = diffResolved(computeEffective(doc, doc.base.kind === 'preset' ? fromPreset : null), computeEffective(next, base.kind === 'preset' ? loaded.preset : null));
    } catch {
      diff = null;
    }
    return {
      next,
      diff,
      lossy: keepRules ? rewritten.lossy : [],
      gen: loaded.preset?.gen ?? (base.kind === 'blank' ? base.gen : null),
      fromGen: doc.base.kind === 'blank' ? doc.base.gen : (fromPreset?.gen ?? null),
    };
  }, [loaded, target, fromPreset, doc, keepRules]);

  const lines: string[] = [];
  if (plan?.diff) {
    const { diff } = plan;
    if (plan.gen !== null && diff.otherChanged && plan.gen !== plan.fromGen) lines.push(t('rebase.gen', { gen: plan.gen }));
    for (const category of RULESET_CATEGORIES) {
      if (diff[category].added.length > 0) lines.push(t(`rebase.added.${category}`, { count: diff[category].added.length }));
      if (diff[category].removed.length > 0) lines.push(t(`rebase.removed.${category}`, { count: diff[category].removed.length }));
    }
    if (diff.clausesAdded.length > 0) lines.push(t('rebase.clausesAdded', { count: diff.clausesAdded.length }));
    if (diff.clausesRemoved.length > 0) lines.push(t('rebase.clausesRemoved', { count: diff.clausesRemoved.length }));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-poke-text-secondary">{t('rebase.intro')}</p>
      {loaded.status === 'loading' && <p role="status" className="text-sm text-poke-text-secondary">{t('rebase.loading')}</p>}
      {loaded.status === 'error' && <Alert variant="error">{t('rebase.failed')}</Alert>}
      {plan !== null && (
        <>
          <label className="flex items-start gap-3 rounded-poke-md border border-poke-border p-3">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-poke-accent" checked={keepRules} onChange={(event) => setKeepRules(event.target.checked)} />
            <span>
              <span className="block text-sm font-semibold text-poke-text-primary">{t('rebase.keepRules')}</span>
              <span className="block text-xs text-poke-text-secondary">{t('rebase.keepRulesHelp')}</span>
            </span>
          </label>
          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold text-poke-text-primary">{t('rebase.changes')}</h3>
            {lines.length === 0 ? (
              <p className="text-sm text-poke-text-secondary">{t('rebase.nothing')}</p>
            ) : (
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-poke-text-secondary">
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
          {plan.lossy.length > 0 && <Alert variant="warning">{t('rebase.lossy', { list: plan.lossy.map((category) => t(`outline.${category}`)).join(', ') })}</Alert>}
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={onClose}>
          {t('rebase.cancel')}
        </Button>
        <Button type="button" variant="primary" size="sm" className="min-h-11 sm:min-h-0" disabled={plan === null} onClick={() => plan !== null && onApply(plan.next)}>
          {t('rebase.title', { name })}
        </Button>
      </div>
    </div>
  );
}

/**
 * Switching the base shows what it would change before anything is applied: the dialog loads the target preset, rewrites
 * the document's lists against it (so the ruleset keeps enforcing the same rules) and lists the differences in the
 * effective rules, per category. The author can turn the rewrite off to keep their lists as written.
 */
export default function RebaseDialog({ target, ...rest }: RebaseDialogProps) {
  const t = useT(rulesetStudioSectionsMessages);
  const name = target === null ? '' : target === BLANK_TARGET ? t('base.blankHeading') : (getRulesetPreset(target)?.name ?? target);
  return (
    <Modal open={target !== null} onClose={rest.onClose} title={t('rebase.title', { name })} size="md">
      {target !== null && <Body key={target} target={target} {...rest} />}
    </Modal>
  );
}
