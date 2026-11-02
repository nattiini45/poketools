'use client';

import Alert from '@/components/ui/Alert';
import { useT } from '@/i18n/client';
import { draftLegacyBoardMessages } from '@/i18n/messages/draft/legacy/board';

/** What a saved legacy pick reports in `warnings` when a step after the insert failed (the picks route's codes). */
export type PickWarning = 'TRACKER_NOT_CREATED' | 'POOL_COMPLETION_PENDING';

/** The warnings of a pick response this board knows how to word; anything else is ignored. */
export function knownPickWarnings(warnings: unknown): PickWarning[] {
  if (!Array.isArray(warnings)) return [];
  return warnings.filter(
    (w): w is PickWarning => w === 'TRACKER_NOT_CREATED' || w === 'POOL_COMPLETION_PENDING',
  );
}

/** The pick stands, so the notice says not to pick again and never offers a retry. */
export default function PickWarnings({ warnings }: { warnings: readonly PickWarning[] }) {
  const t = useT(draftLegacyBoardMessages);
  return (
    <>
      {warnings.map((warning) => (
        <Alert key={warning} variant="warning">
          {t(`board.pickWarnings.${warning}`)}
        </Alert>
      ))}
    </>
  );
}
