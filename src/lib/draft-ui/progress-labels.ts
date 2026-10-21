/**
 * Labels for `ProgressSourceChips` (draft-frontend §6.3), built from
 * `draft/shared.progress.*`. The chips take labels as props (not hooks), so
 * server components (`getT`), client components (`useT`) and canvas painters
 * (`createTranslator`) all build them the same way:
 *
 * ```ts
 * const labels = progressChipLabels(useT(draftSharedMessages));
 * ```
 */
import type { Translator } from '@/i18n/core';
import type { DraftSharedEn } from '@/i18n/messages/draft/shared';

export interface ProgressChipLabels {
  /** "4 KOs" — self-earned kills only. */
  kos(count: number): string;
  /** "+2 transferred" */
  transferred(n: number): string;
  /** "+1 Draft Kill Token" */
  draftKill(n: number): string;
  /** "+1 Comeback" */
  comeback(n: number): string;
  /** "+3 Cosmo" */
  cosmo(n: number): string;
  /** Group label of the chip row ("Progress sources"). */
  group: string;
}

export function progressChipLabels(t: Translator<DraftSharedEn>): ProgressChipLabels {
  return {
    kos: (count) => t('progress.kos', { count }),
    transferred: (n) => t('progress.transferredChip', { n }),
    draftKill: (count) => t('progress.draftKillChip', { count }),
    comeback: (n) => t('progress.comebackChip', { n }),
    cosmo: (n) => t('progress.cosmoChip', { n }),
    group: t('progress.sources'),
  };
}
