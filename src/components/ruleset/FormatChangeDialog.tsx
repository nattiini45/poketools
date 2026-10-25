'use client';

import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useT } from '@/i18n/client';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import { getFormatName } from '@/lib/pkmn/format-catalog';
import type { BaseFormat } from '@/types/ruleset';
import type { FormatSwitchImpact } from './ruleset-form';

interface FormatChangeSummaryProps {
  format: BaseFormat;
  impact: FormatSwitchImpact;
}

/**
 * What replacing the lists with `format`'s defaults would lose. Split from the
 * dialog because Radix portals render nothing in static markup.
 */
export function FormatChangeSummary({ format, impact }: FormatChangeSummaryProps) {
  const t = useT(rulesetMessages);
  return (
    <div className="space-y-3 text-sm text-poke-text-secondary">
      <p>{t('builder.formatChange.intro', { format: getFormatName(format) })}</p>
      {!impact.baselineKnown && (
        <p className="text-xs text-poke-text-muted">{t('builder.formatChange.unknownBaseline')}</p>
      )}
      <ul className="ml-4 list-disc space-y-0.5 text-poke-text-primary">
        {impact.changes.map((change) => {
          const label = t(`builder.formatChange.categories.${change.key}` as const);
          return (
            <li key={change.key}>
              {impact.baselineKnown
                ? t('builder.formatChange.diff', { label, added: change.added, removed: change.removed })
                : t('builder.formatChange.total', { label, count: change.total })}
            </li>
          );
        })}
        {impact.doublesDiffers && <li>{t('builder.formatChange.doubles')}</li>}
      </ul>
      <p className="text-xs text-poke-text-muted">{t('builder.formatChange.keepHint')}</p>
    </div>
  );
}

interface FormatChangeDialogProps {
  /** The format the admin picked; `null` while no change is pending. */
  format: BaseFormat | null;
  impact: FormatSwitchImpact | null;
  onKeep: () => void;
  onReplace: () => void;
  onCancel: () => void;
}

/**
 * Asked when a base-format switch would replace lists the admin has changed.
 * Keeping the lists is the default action, so an accidental Enter loses nothing.
 */
export default function FormatChangeDialog({ format, impact, onKeep, onReplace, onCancel }: FormatChangeDialogProps) {
  const t = useT(rulesetMessages);
  const open = format !== null && impact !== null;
  const name = format ? getFormatName(format) : '';
  return (
    <Modal open={open} onClose={onCancel} title={t('builder.formatChange.title', { format: name })} size="md">
      {format !== null && impact !== null && <FormatChangeSummary format={format} impact={impact} />}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('builder.formatChange.cancel')}
        </Button>
        <Button variant="danger" size="sm" onClick={onReplace}>
          {t('builder.formatChange.replace', { format: name })}
        </Button>
        <Button variant="primary" size="sm" onClick={onKeep} autoFocus>
          {t('builder.formatChange.keep')}
        </Button>
      </div>
    </Modal>
  );
}
