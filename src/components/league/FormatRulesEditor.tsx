'use client';

import { useState, useEffect, useCallback } from 'react';
import type { FormatRules, TeraRules } from '@/types/format-rules';
import { DEFAULT_BANNED_MOVES, DEFAULT_BANNED_ITEMS, DEFAULT_TERA_RULES } from '@/types/format-rules';
import { epbPack } from '@/lib/format-pack';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { useDataLocale, useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { enumMessages } from '@/i18n/messages/enums';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';

interface FormatRulesEditorProps {
  seasonId: string;
}

/** The failure to show: the route's own error, or one of this editor's fallback messages. */
type EditorError =
  | { kind: 'api'; result: ApiErrorLike }
  | { kind: 'loadFailed' }
  | { kind: 'initializeFailed' };

/** Tera rule per stage; stage names come from `glossary.roster` (stage 1 is the base). */
const TERA_STAGES: readonly {
  key: keyof TeraRules;
  stage: 'roster.base' | 'roster.stage2' | 'roster.stage3';
  className: string;
}[] = [
  { key: 'stage1', stage: 'roster.base', className: 'bg-green-900/30 text-green-400' },
  { key: 'stage2', stage: 'roster.stage2', className: 'bg-yellow-900/30 text-yellow-400' },
  { key: 'stage3', stage: 'roster.stage3', className: 'bg-red-900/30 text-red-400' },
];

export default function FormatRulesEditor({ seasonId }: FormatRulesEditorProps) {
  const t = useT(leagueAdminMessages);
  const tGlossary = useT(glossaryMessages);
  const tEnum = useT(enumMessages);
  const dataLocale = useDataLocale();
  const errorText = useApiErrorText(errorsSeasons);
  const [rules, setRules] = useState<FormatRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<EditorError | null>(null);
  const [saved, setSaved] = useState(false);

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch(`/api/seasons/${seasonId}/format-rules`);
      const json = await res.json();
      if (json.success && json.data) {
        setRules(json.data);
      }
    } catch {
      setError({ kind: 'loadFailed' });
    } finally {
      setLoading(false);
    }
  }, [seasonId]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleInitialize = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch(`/api/seasons/${seasonId}/format-rules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          banned_moves: DEFAULT_BANNED_MOVES,
          banned_items: DEFAULT_BANNED_ITEMS,
          draft_budget: epbPack.defaults.draftBudget,
          draft_picks: epbPack.defaults.draftPicks,
          draft_token_ratio: epbPack.defaults.tokenRatio,
          draft_token_max: epbPack.defaults.tokenMax,
          draft_token_max_per_line: epbPack.defaults.tokenMaxPerLine,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setRules(json.data);
        setSaved(true);
      } else {
        const result = toApiErrorLike(json);
        setError(result.error || result.code ? { kind: 'api', result } : { kind: 'initializeFailed' });
      }
    } catch {
      setError({ kind: 'initializeFailed' });
    } finally {
      setSaving(false);
    }
  };

  const errorMessage =
    error === null
      ? null
      : error.kind === 'api'
        ? errorText(error.result)
        : t(error.kind === 'loadFailed' ? 'formatRules.loadFailed' : 'formatRules.initializeFailed');

  if (loading) {
    return <p className="text-sm text-poke-text-secondary">{t('formatRules.loading')}</p>;
  }

  if (!rules) {
    return (
      <div className="space-y-3">
        {errorMessage && <Alert variant="error">{errorMessage}</Alert>}
        <p className="text-sm text-poke-text-secondary">{t('formatRules.empty')}</p>
        <Button onClick={handleInitialize} disabled={saving}>
          {saving ? t('formatRules.initializing') : t('formatRules.initialize')}
        </Button>
      </div>
    );
  }

  const token = tGlossary('token.draftKill');
  const teraRules = rules.tera_rules ?? DEFAULT_TERA_RULES;

  return (
    <div className="space-y-4">
      {errorMessage && <Alert variant="error">{errorMessage}</Alert>}
      {saved && <Alert variant="success">{t('formatRules.saved')}</Alert>}

      {/* Draft configuration */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-poke-elevated p-3 text-center">
          <span className="text-xs text-poke-text-secondary">{tGlossary('price.budget')}</span>
          <p className="text-lg font-bold">{rules.draft_budget}</p>
        </div>
        <div className="rounded-lg bg-poke-elevated p-3 text-center">
          <span className="text-xs text-poke-text-secondary">{t('formatRules.picks')}</span>
          <p className="text-lg font-bold">{rules.draft_picks}</p>
        </div>
        <div className="rounded-lg bg-poke-elevated p-3 text-center">
          <span className="text-xs text-poke-text-secondary">{t('formatRules.tokenRatio', { token })}</span>
          <p className="text-lg font-bold">{t('formatRules.ratioValue', { ratio: rules.draft_token_ratio })}</p>
        </div>
        <div className="rounded-lg bg-poke-elevated p-3 text-center">
          <span className="text-xs text-poke-text-secondary">{t('formatRules.tokenMax', { token })}</span>
          <p className="text-lg font-bold">{rules.draft_token_max}</p>
        </div>
      </div>

      {/* Banned moves (canonical English names, shown in the viewer's data locale) */}
      <div>
        <h3 className="mb-1 text-sm font-medium text-poke-text-secondary">{t('formatRules.bannedMoves')}</h3>
        <div className="flex flex-wrap gap-1.5">
          {rules.banned_moves.map((move) => (
            <span key={move} className="rounded bg-red-900/30 px-2 py-0.5 text-xs text-red-400">
              {localizeMove(move, dataLocale)}
            </span>
          ))}
        </div>
      </div>

      {/* Banned items */}
      <div>
        <h3 className="mb-1 text-sm font-medium text-poke-text-secondary">{t('formatRules.bannedItems')}</h3>
        <div className="flex flex-wrap gap-1.5">
          {rules.banned_items.map((item) => (
            <span key={item} className="rounded bg-red-900/30 px-2 py-0.5 text-xs text-red-400">
              {localizeItem(item, dataLocale)}
            </span>
          ))}
        </div>
      </div>

      {/* Tera rules */}
      <div>
        <h3 className="mb-1 text-sm font-medium text-poke-text-secondary">{t('formatRules.teraRules')}</h3>
        <div className="flex flex-wrap gap-2 text-xs">
          {TERA_STAGES.map(({ key, stage, className }) => (
            <span key={key} className={`rounded px-2 py-1 ${className}`}>
              {t('formatRules.teraRule', {
                stage: tGlossary(stage),
                rule: enumLabel(tEnum, 'teraRule', teraRules[key]),
              })}
            </span>
          ))}
        </div>
      </div>

      {/* Tiebreaker order */}
      <div>
        <h3 className="mb-1 text-sm font-medium text-poke-text-secondary">{t('formatRules.tiebreakerOrder')}</h3>
        <ol className="list-inside list-decimal text-xs text-poke-text-secondary">
          {rules.tiebreaker_order.map((step) => (
            <li key={step}>
              {step === 'evolution_points'
                ? tGlossary('progress.evolutionPoints')
                : t.dynamic(`formatRules.tiebreaker.${step}`, undefined, step)}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
