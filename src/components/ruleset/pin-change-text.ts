/**
 * The sentence parts that say what differs between two ruleset versions ("3 more banned, 1 no longer banned"), from the counts of
 * a `PinChangeSummary`. Shared by the pin card, its confirmation and the version list of the read-only ruleset page, so one
 * wording describes a version change everywhere. Pure: it takes the translator of the `ruleset` namespace.
 */
import type { Translator } from '@/i18n/core';
import type rulesetEn from '@/i18n/messages/ruleset/en';
import { isEmptyChange, type PinChangeSummary } from '@/lib/ruleset-studio/pin-info';

type Translate = Translator<typeof rulesetEn>;

/** "3 more banned, 1 no longer banned, 1 clause added" for the parts that are not zero; null when nothing differs. */
export function describeChange(change: PinChangeSummary, t: Translate): string | null {
  if (isEmptyChange(change)) return null;
  const parts: string[] = [];
  if (change.banned > 0) parts.push(t('pin.change.banned', { count: change.banned }));
  if (change.unbanned > 0) parts.push(t('pin.change.unbanned', { count: change.unbanned }));
  if (change.allowed > 0) parts.push(t('pin.change.allowed', { count: change.allowed }));
  if (change.disallowed > 0) parts.push(t('pin.change.disallowed', { count: change.disallowed }));
  if (change.clausesAdded > 0) parts.push(t('pin.change.clausesAdded', { count: change.clausesAdded }));
  if (change.clausesRemoved > 0) parts.push(t('pin.change.clausesRemoved', { count: change.clausesRemoved }));
  if (change.modeChanged) parts.push(t('pin.change.modeChanged'));
  if (change.otherChanged) parts.push(t('pin.change.otherChanged'));
  return parts.join(', ');
}
