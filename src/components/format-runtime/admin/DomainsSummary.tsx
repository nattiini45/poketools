'use client';

import Badge from '@/components/ui/Badge';
import { useLocale, useT } from '@/i18n/client';
import { formatRuntimeAdminMessages } from '@/i18n/messages/format-runtime/admin';
import type { AdminDomainView } from '@/lib/format-engine/runtime/view-types';
import { CELL, NAME_CELL, ROW, TABLE, TABLE_FRAME, TBODY, TH, THEAD } from '@/components/admin/admin-table';
import { labelText } from './admin-shared';

export interface DomainsSummaryProps {
  domains: readonly AdminDomainView[];
}

/** The lists of entries the format defines (Pokémon pools, ...): who may see each, whether it is unlocked, how many entries it has. Read only. */
export default function DomainsSummary({ domains }: DomainsSummaryProps) {
  const t = useT(formatRuntimeAdminMessages);
  const locale = useLocale();

  if (domains.length === 0) {
    return <p className="text-body text-fg-muted">{t('domains.empty')}</p>;
  }

  return (
    <div className={TABLE_FRAME} role="region" aria-label={t('domains.caption')} tabIndex={0} data-live-domains>
      <table className={TABLE}>
        <caption className="sr-only">{t('domains.caption')}</caption>
        <thead className={THEAD}>
          <tr>
            <th scope="col" className={TH}>{t('domains.columns.list')}</th>
            <th scope="col" className={TH}>{t('domains.columns.visibility')}</th>
            <th scope="col" className={TH}>{t('domains.columns.lock')}</th>
            <th scope="col" className={TH}>{t('domains.columns.entries')}</th>
          </tr>
        </thead>
        <tbody className={TBODY}>
          {domains.map((domain) => (
            <tr key={domain.key} className={ROW}>
              <td className={NAME_CELL}>{labelText(domain.label, locale, domain.key)}</td>
              <td className={CELL} data-label={t('domains.columns.visibility')}>{t(`domains.visibility.${domain.visibility}`)}</td>
              <td className={CELL} data-label={t('domains.columns.lock')}>
                <Badge variant={domain.unlocked ? 'green' : 'gray'}>{domain.unlocked ? t('domains.unlocked') : t('domains.locked')}</Badge>
              </td>
              <td className={CELL} data-label={t('domains.columns.entries')}>{domain.entry_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
