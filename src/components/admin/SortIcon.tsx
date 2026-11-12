import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
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

export type ColumnSort = { key: string; direction: 'asc' | 'desc' };

/** `aria-sort` of a header for the current client-side sort. */
export function ariaSort(sort: ColumnSort, key: string): 'ascending' | 'descending' | 'none' {
  if (sort.key !== key) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

/** Client-side ordering of a short list: the rows sorted by one column's value, a header click flips or switches it. */
export function useColumnSort<T>(rows: T[], values: Record<string, (row: T) => string>, initial: ColumnSort) {
  const [sort, setSort] = useState<ColumnSort>(initial);
  const sorted = useMemo(() => {
    const value = values[sort.key];
    if (!value) return rows;
    const sign = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => sign * value(a).localeCompare(value(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  const toggle = (key: string) =>
    setSort((current) => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));
  return { sorted, sort, toggle };
}
