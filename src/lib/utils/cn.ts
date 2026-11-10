import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { TYPE_ROLES } from '@/lib/design/type';

// The type roles are font sizes, so `cn('text-caption', 'text-fg-muted')` keeps both and `cn('text-sm', 'text-caption')`
// keeps only the role.
const twMerge = extendTailwindMerge({ extend: { classGroups: { 'font-size': [{ text: [...TYPE_ROLES] }] } } });

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
