'use client';

import { useT } from '@/i18n/client';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { ActionView, DomainEntriesView } from '@/lib/format-engine/runtime/view-types';
import ActionCard, { type ActionStatus } from './ActionCard';
import { PlayerSection } from './parts';

export interface ActionsSectionProps {
  seasonId: string;
  actions: readonly ActionView[];
  domains: readonly DomainEntriesView[];
  closed: boolean;
  /** The page's single reload path: resolves to whether the view was read again. */
  onReload: () => Promise<boolean>;
  onStatus: (status: ActionStatus) => void;
}

/** The viewer's actions, one card each. */
export default function ActionsSection({ seasonId, actions, domains, closed, onReload, onStatus }: ActionsSectionProps) {
  const t = useT(formatRuntimePlayerMessages);
  return (
    <PlayerSection title={t('actions.heading')} icon="rare-candy">
      <div className="flex flex-col gap-4">
        {actions.map((action) => (
          <ActionCard
            key={action.id}
            seasonId={seasonId}
            action={action}
            domains={domains}
            closed={closed}
            onReload={onReload}
            onStatus={onStatus}
          />
        ))}
      </div>
    </PlayerSection>
  );
}
