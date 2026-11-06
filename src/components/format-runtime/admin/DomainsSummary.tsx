'use client';

import Badge from '@/components/ui/Badge';
import { useLocale, useT } from '@/i18n/client';
import { formatRuntimeAdminMessages } from '@/i18n/messages/format-runtime/admin';
import type { AdminDomainView } from '@/lib/format-engine/runtime/view-types';
import ScrollRegion from '../ScrollRegion';
import { labelText } from './admin-shared';

export interface DomainsSummaryProps {
  domains: readonly AdminDomainView[];
}

/** The lists of entries the format defines (Pokémon pools, ...): who may see each, whether it is unlocked, how many entries it has. Read only. */
export default function DomainsSummary({ domains }: DomainsSummaryProps) {
  const t = useT(formatRuntimeAdminMessages);
  const locale = useLocale();

  if (domains.length === 0) {
    return <p className="text-sm text-poke-text-muted">{t('domains.empty')}</p>;
  }

  return (
    <ScrollRegion label={t('domains.caption')} data-live-domains>
      <table className="w-full min-w-[28rem] text-left text-sm">
        <caption className="sr-only">{t('domains.caption')}</caption>
        <thead className="bg-poke-muted text-xs font-heading text-poke-text-secondary">
          <tr>
            <th scope="col" className="px-3 py-2">{t('domains.columns.list')}</th>
            <th scope="col" className="px-3 py-2">{t('domains.columns.visibility')}</th>
            <th scope="col" className="px-3 py-2">{t('domains.columns.lock')}</th>
            <th scope="col" className="px-3 py-2">{t('domains.columns.entries')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-poke-border">
          {domains.map((domain) => (
            <tr key={domain.key}>
              <td className="px-3 py-2 text-poke-text-primary">{labelText(domain.label, locale, domain.key)}</td>
              <td className="px-3 py-2 text-poke-text-secondary">{t(`domains.visibility.${domain.visibility}`)}</td>
              <td className="px-3 py-2">
                <Badge variant={domain.unlocked ? 'green' : 'gray'}>{domain.unlocked ? t('domains.unlocked') : t('domains.locked')}</Badge>
              </td>
              <td className="px-3 py-2 text-poke-text-secondary">{domain.entry_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
