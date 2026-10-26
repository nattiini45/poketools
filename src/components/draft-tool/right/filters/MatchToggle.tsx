'use client';

/** "Any" / "Require all" switch of the type and move filters (draft-frontend §4.4, §10.3 `match.*`). */
import SegmentedControl from '@/components/draft-tool/shared/SegmentedControl';
import { useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';

type MatchMode = 'any' | 'all';

export interface MatchToggleProps {
  value: MatchMode;
  onChange(value: MatchMode): void;
  /** What the switch applies to (the section heading), for screen readers. */
  label: string;
}

export default function MatchToggle({ value, onChange, label }: MatchToggleProps) {
  const t = useT(draftFinderMessages);
  return (
    <SegmentedControl<MatchMode>
      value={value}
      onChange={onChange}
      ariaLabel={`${label} – ${t('match.label')}`}
      options={[
        { value: 'any', label: t('match.any') },
        { value: 'all', label: t('match.all') },
      ]}
    />
  );
}
