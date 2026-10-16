'use client';

/**
 * Participation token card (draft-frontend §6.2; SPEC Prompt 7; stored as
 * `cosmo`). Rendered only when the player has the format pack's participation
 * line: its tokens per matchday the line was brought, and the progress toward
 * the catalog's cumulative thresholds (league overrides applied; read from
 * data, never hard-coded). Participation tokens are not real KOs.
 */
import { useMemo } from 'react';
import { useFormatter, useT } from '@/i18n/client';
import { draftTokensMessages } from '@/i18n/messages/draft/tokens';
import { glossaryMessages } from '@/i18n/messages/glossary';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { TokenOverviewDTO } from '@/types/draft-queue';
import { catalogById } from './token-view';
import { useLineText } from './use-line-text';
import { CARD, CARD_TITLE, NOTE } from './styles';

export interface CosmoTokenCardProps {
  data: NonNullable<TokenOverviewDTO['cosmo']>;
  /** The overview's progress row of the participation line (null if the DTO has none). */
  line: TokenOverviewDTO['lines'][number] | null;
  catalog: DraftLineCatalog;
}

export default function CosmoTokenCard({ data, line, catalog }: CosmoTokenCardProps) {
  const t = useT(draftTokensMessages);
  const tGlossary = useT(glossaryMessages);
  const f = useFormatter();
  const text = useLineText(catalog);
  const entry = useMemo(() => catalogById(catalog).get(data.line_id), [catalog, data.line_id]);
  const [stage2, stage3] = entry?.thresholds.cumulative ?? [null, null];
  const matchdays = [...data.matchdays_brought].sort((a, b) => a - b);

  return (
    <section className={CARD} aria-labelledby="token-card-cosmo">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="token-card-cosmo" className={CARD_TITLE}>
          {tGlossary('token.cosmo')}
        </h2>
        <span className="text-sm font-semibold tabular-nums text-poke-text-primary">
          {tGlossary('tokenCount.cosmo', { count: data.tokens })}
        </span>
      </div>
      <p className="font-semibold text-poke-text-primary">{text.label(data.line_id)}</p>
      <p className="text-sm text-poke-text-secondary">{t('cosmo.intro')}</p>
      <p className="text-sm text-poke-text-secondary">
        {matchdays.length === 0
          ? t('cosmo.notBrought')
          : t('cosmo.brought', { list: f.list(matchdays.map((d) => f.number(d))) })}
      </p>
      {line ? (
        <p className="text-sm tabular-nums text-poke-text-primary">
          {line.next_threshold === null
            ? t('cosmo.progressMax', { progress: line.total_progress })
            : t('cosmo.progress', { progress: line.total_progress, next: line.next_threshold })}
        </p>
      ) : null}
      {stage2 !== null && stage3 !== null ? (
        <p className="text-xs tabular-nums text-poke-text-secondary">{t('cosmo.thresholds', { stage2, stage3 })}</p>
      ) : null}
      <p className={NOTE}>{t('cosmo.note')}</p>
    </section>
  );
}
