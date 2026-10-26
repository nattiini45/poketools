'use client';

import Textarea from '@/components/ui/Textarea';
import { useT } from '@/i18n/client';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import { MAX_CUSTOM_RULES_CHARS } from '@/lib/ruleset-kit/limits';
import type { DraftDocument } from '@/lib/ruleset-studio/editor/document';
import { fieldId } from '@/lib/ruleset-studio/editor/targets';

interface NotesSectionProps {
  doc: DraftDocument;
  onChange: (next: DraftDocument) => void;
}

/** The notes and custom rules: free text shown on the rules page and never enforced. */
export default function NotesSection({ doc, onChange }: NotesSectionProps) {
  const t = useT(rulesetStudioSectionsMessages);
  return (
    <div className="max-w-3xl space-y-2">
      <p className="text-sm text-poke-text-secondary">{t('notes.intro')}</p>
      <Textarea
        id={fieldId('/custom_rules')}
        label={t('notes.label')}
        rows={10}
        maxLength={MAX_CUSTOM_RULES_CHARS}
        value={doc.custom_rules}
        onChange={(event) => onChange({ ...doc, custom_rules: event.target.value })}
      />
      <p className="flex flex-wrap justify-between gap-2 text-xs text-poke-text-muted">
        <span>{t('notes.help')}</span>
        <span>{t('notes.remaining', { count: MAX_CUSTOM_RULES_CHARS - doc.custom_rules.length })}</span>
      </p>
    </div>
  );
}
