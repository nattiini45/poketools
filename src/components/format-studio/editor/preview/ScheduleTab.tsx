'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useLocale, useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import {
  SCHEDULE_CADENCES,
  SCHEDULE_DEFAULT_PLAYERS,
  SCHEDULE_DEFAULT_ROUND_DAYS,
  SCHEDULE_MAX_PLAYERS,
  SCHEDULE_MIN_PLAYERS,
  resolveLText,
  type CountRange,
} from '@/lib/format-kit/client';
import type { DraftDocument } from '@/lib/format-studio/editor/document';
import { scheduleFor } from '@/lib/format-studio/editor/preview';
import NumberField from '../fields/NumberField';
import SelectField from '../fields/SelectField';

interface ScheduleTabProps {
  doc: DraftDocument;
  /** Ids of the rulesets that exist, as the compile in the editor sees them. */
  rulesetIds: ReadonlySet<string>;
  /** Opens the Issues tab (shown next to the "fix the errors first" message). */
  onShowIssues: () => void;
  /** For tests: start with these values instead of 8 players and a weekly cadence. */
  initialPlayers?: number;
  initialRoundDays?: number;
}

const CELL = 'px-3 py-2 text-right tabular-nums';

/**
 * The estimated schedule of the format for a number of players: rounds, matches, matches per player, byes and
 * weeks for each stage, and the total. The numbers come from the same compile as the Issues tab; a document with
 * errors has no schedule, and the tab says so instead of showing guesses.
 */
export default function ScheduleTab({ doc, rulesetIds, onShowIssues, initialPlayers = SCHEDULE_DEFAULT_PLAYERS, initialRoundDays = SCHEDULE_DEFAULT_ROUND_DAYS }: ScheduleTabProps) {
  const t = useT(formatStudioEditorMessages);
  const locale = useLocale();
  const format = useFormatter();
  const [players, setPlayers] = useState(initialPlayers);
  const [roundDays, setRoundDays] = useState(initialRoundDays);

  const estimate = useMemo(() => scheduleFor(doc, players, roundDays, rulesetIds), [doc, players, roundDays, rulesetIds]);

  const stageName = (key: string) => {
    const stage = doc.stages.find((s) => s.key === key);
    return stage === undefined ? key : (resolveLText(stage.name, { viewer: locale })?.value ?? key);
  };
  const range = (value: CountRange | null) => {
    if (value === null) return null;
    return value.min === value.max ? format.number(value.min) : t('preview.schedule.range', { min: format.number(value.min), max: format.number(value.max) });
  };
  const cell = (value: CountRange | null) => {
    const text = range(value);
    return text === null ? (
      <span title={t('preview.schedule.unknown')}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t('preview.schedule.unknown')}</span>
      </span>
    ) : (
      text
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          pointer="/preview/players"
          label={t('preview.schedule.players')}
          value={players}
          min={SCHEDULE_MIN_PLAYERS}
          max={SCHEDULE_MAX_PLAYERS}
          onCommit={(value) => value !== undefined && setPlayers(value)}
        />
        <SelectField
          pointer="/preview/cadence"
          label={t('preview.schedule.cadence')}
          value={String(roundDays)}
          options={SCHEDULE_CADENCES.map((days) => ({ value: String(days), label: t.dynamic(`preview.schedule.cadenceOption.${days}`) }))}
          onChange={(value) => setRoundDays(Number(value))}
        />
      </div>

      {estimate === null ? (
        <div className="space-y-2 text-sm text-poke-text-secondary">
          <p>{t('preview.schedule.invalid')}</p>
          <button type="button" className="font-medium text-poke-blue hover:underline" onClick={onShowIssues}>
            {t('preview.schedule.showIssues')}
          </button>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto" role="region" aria-label={t('preview.schedule.tableLabel')} tabIndex={0}>
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <caption className="pb-2 text-left font-heading font-semibold text-poke-text-primary">
                {t('preview.schedule.caption', { players: estimate.players })}
              </caption>
              <thead>
                <tr className="border-b border-poke-border text-poke-text-secondary">
                  <th scope="col" className="px-3 py-2 text-left font-semibold">{t('preview.schedule.col.stage')}</th>
                  <th scope="col" className={`${CELL} font-semibold`}>{t('preview.schedule.col.players')}</th>
                  <th scope="col" className={`${CELL} font-semibold`}>{t('preview.schedule.col.rounds')}</th>
                  <th scope="col" className={`${CELL} font-semibold`}>{t('preview.schedule.col.matches')}</th>
                  <th scope="col" className={`${CELL} font-semibold`}>{t('preview.schedule.col.perPlayer')}</th>
                  <th scope="col" className={`${CELL} font-semibold`}>{t('preview.schedule.col.byes')}</th>
                  <th scope="col" className={`${CELL} font-semibold`}>{t('preview.schedule.col.weeks')}</th>
                </tr>
              </thead>
              <tbody>
                {estimate.stages.map((stage) => (
                  <tr key={stage.key} className="border-b border-poke-border/60">
                    <th scope="row" className="min-w-0 break-words px-3 py-2 text-left font-medium text-poke-text-primary">
                      {stageName(stage.key)}
                      {stage.groups !== null && (
                        <span className="block text-xs font-normal text-poke-text-muted">{t('preview.schedule.groups', { count: stage.groups })}</span>
                      )}
                    </th>
                    <td className={CELL}>{cell(stage.participants)}</td>
                    <td className={CELL}>{cell(stage.rounds)}</td>
                    <td className={CELL}>{cell(stage.matches)}</td>
                    <td className={CELL}>{cell(stage.matchesPerPlayer)}</td>
                    <td className={CELL}>{cell(stage.byes)}</td>
                    <td className={CELL}>{cell(stage.weeks)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-poke-text-primary">
                  <th scope="row" className="px-3 py-2 text-left">{t('preview.schedule.total')}</th>
                  <td className={CELL} />
                  <td className={CELL}>{cell(estimate.totals.rounds)}</td>
                  <td className={CELL}>{cell(estimate.totals.matches)}</td>
                  <td className={CELL} />
                  <td className={CELL} />
                  <td className={CELL}>{cell(estimate.totals.weeks)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-poke-text-muted">
            <li>{t('preview.schedule.sequentialNote')}</li>
            <li>{t('preview.schedule.bestOfNote')}</li>
            {estimate.stages.some((s) => s.precision === 'bounds') && <li>{t('preview.schedule.boundsNote')}</li>}
          </ul>
        </>
      )}
    </div>
  );
}
