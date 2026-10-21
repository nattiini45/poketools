/**
 * Enum labels with a raw-value fallback (i18n-core §5.3):
 *
 * ```ts
 * const t = useT(enumMessages);
 * enumLabel(t, 'matchStatus', match.status);
 * ```
 *
 * An unknown DB string renders as itself (and warns once outside production).
 */
import type { Translator } from '../core';
import type enumsEn from '../messages/enums/en';

export type EnumMessagesEn = typeof enumsEn;
export type EnumGroup = keyof EnumMessagesEn & string;

export function enumLabel(t: Translator<EnumMessagesEn>, group: EnumGroup, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return t.dynamic(`${group}.${value}`, undefined, value);
}
