'use client';

import { useMemo } from 'react';
import Select from '@/components/ui/Select';
import { useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { leagueCloneMessages } from '@/i18n/messages/league-clone';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { isCloneSourceFormat, type CloneSourceOption } from '@/lib/league-admin/clone-source';
import type { RulesetOption } from '@/lib/ruleset-studio/library-types';

interface CloneSourcePickerProps {
  sources: CloneSourceOption[];
  /** The ruleset options of the create form, which hold the version each source pins (even when it is no longer the newest). */
  rulesets: readonly RulesetOption[];
  /** Only site admins may copy the league admins. */
  isSiteAdmin: boolean;
  /** The picked source league; null = a blank league. */
  sourceId: string | null;
  copyRoster: boolean;
  copyAdmins: boolean;
  onSourceChange: (sourceId: string | null) => void;
  onCopyRosterChange: (copyRoster: boolean) => void;
  onCopyAdminsChange: (copyAdmins: boolean) => void;
}

/**
 * "Start from an existing league" on the league create page: the source
 * select, what a copy takes over and what it leaves out, and the roster and
 * league-admin options. The owner (`LeagueCreator`) holds the state and
 * resets the options when the source changes.
 */
export default function CloneSourcePicker({
  sources: allSources,
  rulesets,
  isSiteAdmin,
  sourceId,
  copyRoster,
  copyAdmins,
  onSourceChange,
  onCopyRosterChange,
  onCopyAdminsChange,
}: CloneSourcePickerProps) {
  const t = useT(leagueCloneMessages);
  const tEnum = useT(enumMessages);
  // A custom league gets its phases from an attached format, so it is never offered as a source
  // (the server refuses it as well).
  const sources = useMemo(() => allSources.filter((source) => isCloneSourceFormat(source.format_type)), [allSources]);

  const options = useMemo(
    () => [
      { value: '', label: t('picker.blank') },
      ...sources.map((source) => {
        const flags = [
          source.archived ? t('picker.archivedSuffix') : null,
          source.is_test_season ? t('picker.testSuffix') : null,
        ].filter((flag): flag is string => flag !== null);
        const label = t('picker.option', {
          name: source.name,
          type: enumLabel(tEnum, 'formatType', source.format_type),
          phases: t('picker.phases', { count: source.phase_count }),
          players: t('picker.players', { count: source.participant_count }),
        });
        return { value: source.id, label: flags.length > 0 ? `${label} · ${flags.join(' · ')}` : label };
      }),
    ],
    [sources, t, tEnum],
  );

  // Nothing to start from (a new league admin): the page is the plain create form.
  if (sources.length === 0) return null;

  const selected = sourceId ? (sources.find((source) => source.id === sourceId) ?? null) : null;
  // The new league starts on the very version the source pins, which can be older than the newest one.
  const sourceRuleset = selected?.ruleset_id ? (rulesets.find((ruleset) => ruleset.id === selected.ruleset_id) ?? null) : null;

  return (
    <section className="mb-6 max-w-lg space-y-3" aria-label={t('picker.label')}>
      <Select
        id="clone-source"
        label={t('picker.label')}
        value={selected?.id ?? ''}
        onChange={(e) => onSourceChange(e.target.value || null)}
        options={options}
      />

      {selected && (
        <div className="space-y-3">
          <div className="space-y-1 rounded-poke-md border border-poke-border bg-poke-surface px-3 py-2 text-xs text-poke-text-secondary">
            <p className="font-heading font-semibold text-poke-text-primary">{t('picker.copiedTitle')}</p>
            <p>{t('picker.copied', { count: selected.phase_count })}</p>
            <p>{t('picker.notCopied')}</p>
            <p>{t('picker.datesHint')}</p>
            {sourceRuleset && (
              <p>{t('picker.rulesetSame', { name: sourceRuleset.name, version: sourceRuleset.version_no })}</p>
            )}
            {isEvolutionPointBuy(selected.format_type) && <p>{t('picker.pointBuyNote')}</p>}
          </div>

          <label className="flex items-start gap-2 text-sm text-poke-text-primary">
            <input
              id="clone-copy-roster"
              type="checkbox"
              className="mt-0.5"
              checked={copyRoster}
              onChange={(e) => onCopyRosterChange(e.target.checked)}
            />
            <span>{t('picker.copyRoster', { count: selected.participant_count })}</span>
          </label>

          {isSiteAdmin && (
            <div className="space-y-1">
              <label className="flex items-start gap-2 text-sm text-poke-text-primary">
                <input
                  id="clone-copy-admins"
                  type="checkbox"
                  className="mt-0.5"
                  checked={copyAdmins}
                  aria-describedby="clone-copy-admins-hint"
                  onChange={(e) => onCopyAdminsChange(e.target.checked)}
                />
                <span>{t('picker.copyAdmins')}</span>
              </label>
              <p id="clone-copy-admins-hint" className="pl-6 text-xs text-poke-text-muted">
                {t('picker.copyAdminsHint')}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
