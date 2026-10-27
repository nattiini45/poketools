'use client';

import Input from '@/components/ui/Input';
import TeamConstraintsEditor from '@/components/ruleset/TeamConstraintsEditor';
import { useT } from '@/i18n/client';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import type { DraftDocument } from '@/lib/ruleset-studio/editor/document';
import { fieldId } from '@/lib/ruleset-studio/editor/targets';

interface ConstraintsSectionProps {
  doc: DraftDocument;
  onChange: (next: DraftDocument) => void;
}

/** The share of the team that must share a type, and the team constraints editor (type quotas, Tera match, evolution stage). */
export default function ConstraintsSection({ doc, onChange }: ConstraintsSectionProps) {
  const t = useT(rulesetStudioSectionsMessages);
  return (
    <div className="space-y-6">
      <p className="text-sm text-poke-text-secondary">{t('constraints.intro')}</p>
      <div className="max-w-sm space-y-1">
        <Input
          id={fieldId('/min_shared_type_pct')}
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          label={t('constraints.sharedType')}
          value={doc.min_shared_type_pct}
          onChange={(event) => {
            const parsed = Math.trunc(Number(event.target.value));
            onChange({ ...doc, min_shared_type_pct: Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0 });
          }}
        />
        <p className="text-xs text-poke-text-muted">{t('constraints.sharedTypeHelp')}</p>
      </div>
      <div id={fieldId('/team_constraints')} className="space-y-2">
        <h3 className="font-heading text-base font-bold text-poke-text-primary">{t('constraints.constraintsHeading')}</h3>
        <TeamConstraintsEditor value={doc.team_constraints} onChange={(team_constraints) => onChange({ ...doc, team_constraints })} />
      </div>
    </div>
  );
}
