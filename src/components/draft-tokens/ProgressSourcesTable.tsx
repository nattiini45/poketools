'use client';

/**
 * Evolution progress by source for each own line (draft-frontend §6.2, §6.3;
 * SPEC Prompt 6 §10–12). Only the self-earned column is labelled KOs; the
 * transferred progress and the three token kinds are separate columns, and
 * the total is labelled progress (`total/next`).
 */
import { useMemo } from 'react';
import { useT } from '@/i18n/client';
import { draftTokensMessages } from '@/i18n/messages/draft/tokens';
import { glossaryMessages } from '@/i18n/messages/glossary';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { TokenOverviewDTO } from '@/types/draft-queue';
import { catalogById, formAt } from './token-view';
import { useLineText } from './use-line-text';
import { CARD, CARD_TITLE } from './styles';

export interface ProgressSourcesTableProps {
  lines: TokenOverviewDTO['lines'];
  catalog: DraftLineCatalog;
}

const TH = 'px-2 py-1.5 font-medium';
const TD = 'px-2 py-1.5 tabular-nums';

export default function ProgressSourcesTable({ lines, catalog }: ProgressSourcesTableProps) {
  const t = useT(draftTokensMessages);
  const tGlossary = useT(glossaryMessages);
  const text = useLineText(catalog);
  const byId = useMemo(() => catalogById(catalog), [catalog]);

  return (
    <section className={CARD} aria-labelledby="token-progress-table">
      <h2 id="token-progress-table" className={CARD_TITLE}>
        {t('table.title')}
      </h2>
      {lines.length === 0 ? (
        <p className="text-sm text-poke-text-secondary">{t('table.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-poke-text-secondary">
                <th scope="col" className={TH}>{t('table.line')}</th>
                <th scope="col" className={TH}>{t('table.stage')}</th>
                <th scope="col" className={TH}>{t('table.kos')}</th>
                <th scope="col" className={`${TH} capitalize`}>{tGlossary('progress.transferred')}</th>
                <th scope="col" className={TH}>{tGlossary('token.draftKill')}</th>
                <th scope="col" className={TH}>{tGlossary('token.comeback')}</th>
                <th scope="col" className={TH}>{tGlossary('token.cosmo')}</th>
                <th scope="col" className={TH}>{tGlossary('progress.progress')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const form = formAt(byId.get(line.line_id), line.stage);
                return (
                  <tr key={line.line_id} className="border-t border-poke-border">
                    <th scope="row" className="px-2 py-1.5 text-left font-semibold text-poke-text-primary">
                      {text.label(line.line_id)}
                    </th>
                    <td className={TD}>
                      {form ? t('table.stageValue', { n: line.stage, form: text.species(form) }) : line.stage}
                    </td>
                    <td className={`${TD} font-semibold text-poke-text-primary`}>{line.self_earned_kills}</td>
                    <td className={TD}>{line.transferred_evo_progress}</td>
                    <td className={TD}>{line.draft_token_progress}</td>
                    <td className={TD}>{line.comeback_token_progress}</td>
                    <td className={TD}>{line.cosmo_token_progress}</td>
                    <td className={`${TD} font-semibold text-poke-text-primary`}>
                      {line.next_threshold === null
                        ? t('table.progressMax', { total: line.total_progress })
                        : t('table.progressValue', { total: line.total_progress, next: line.next_threshold })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
