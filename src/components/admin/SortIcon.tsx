import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { ColumnSortState } from '@/lib/ui/table-params';
import { cn } from '@/lib/utils/cn';
import { FOCUS } from '@/components/admin/match-styles';

/** The sort mark of an admin table's column header: neutral while the column is not the sort, an arrow once it is. */
export default function SortIcon({ active, direction }: { active: boolean; direction: 'asc' | 'desc' | null }) {
  const Icon = !active || !direction ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
  return <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', active ? 'text-fg' : 'text-fg-muted opacity-60')} />;
}

/** The button inside a sortable column header (`th`); the header carries `aria-sort` itself. */
export function SortHeadButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: 'asc' | 'desc' | null;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={cn('inline-flex items-center gap-1 rounded-sm hover:text-fg', FOCUS, active && 'text-fg')}>
      <span>{label}</span>
      <SortIcon active={active} direction={direction} />
    </button>
  );
}

/** `aria-sort` of a header for the current client-side sort (`useClientTable`'s state, null = the default order). */
export function ariaSort(sort: ColumnSortState | null, key: string): 'ascending' | 'descending' | 'none' {
  if (sort?.key !== key) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}
