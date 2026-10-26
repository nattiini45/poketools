'use client';

import { useState } from 'react';
import Input from '@/components/ui/Input';
import { useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { formatStudioPrimitivesMessages } from '@/i18n/messages/format-studio/primitives';
import { isKey, ptr, type Diagnostic, type LText, type Locale } from '@/lib/format-kit/client';
import type { DraftDocument } from '@/lib/format-studio/editor/document';
import { setTheme } from '@/lib/format-studio/editor/ops';
import { FieldIssuesProvider, INSPECTOR_HEADING_ID, ariaOf, FieldMessage, useFieldState } from '../fields/FieldMessage';
import LTextField from '../fields/LTextField';
import SelectField from '../fields/SelectField';

interface IdentityInspectorProps {
  doc: DraftDocument;
  diagnostics: readonly Diagnostic[];
  authorBase: Locale;
  onChange: (next: DraftDocument) => void;
  /** `identity`: name and summary; `theme`: the look of the league world. */
  part: 'identity' | 'theme';
}

const hasText = (text: LText | undefined): boolean => text !== undefined && ((text.en?.v ?? '') !== '' || (text.de?.v ?? '') !== '');

function ThemeFields({ doc, onChange }: { doc: DraftDocument; onChange: (next: DraftDocument) => void }) {
  const t = useT(formatStudioEditorMessages);
  const world = doc.theme.world;
  const [named, setNamed] = useState(world !== 'auto');
  const [keyText, setKeyText] = useState(world === 'auto' ? '' : world);
  const problem = named && keyText !== '' && !isKey(keyText) ? t('inspector.identity.themeKeyInvalid') : null;
  const state = useFieldState(ptr('theme', 'world'), { hint: t('inspector.identity.themeHint'), localError: problem });

  return (
    <div className="space-y-3">
      <SelectField
        pointer={ptr('theme', 'mode')}
        label={t('inspector.identity.theme')}
        value={named ? 'named' : 'auto'}
        options={[
          { value: 'auto', label: t('inspector.identity.themeAuto') },
          { value: 'named', label: t('inspector.identity.themeNamed') },
        ]}
        onChange={(value) => {
          setNamed(value === 'named');
          if (value === 'auto') onChange(setTheme(doc, 'auto'));
          else if (isKey(keyText)) onChange(setTheme(doc, keyText));
        }}
      />
      {named && (
        <div>
          <Input
            id={state.id}
            label={t('inspector.identity.themeKey')}
            value={keyText}
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              const next = event.target.value;
              setKeyText(next);
              if (isKey(next)) onChange(setTheme(doc, next));
            }}
            {...ariaOf(state)}
          />
          <FieldMessage state={state} className="mt-1" />
        </div>
      )}
      {!named && <p className="text-sm text-poke-text-muted">{t('inspector.identity.themeHint')}</p>}
    </div>
  );
}

/** The format's name and optional summary, or its theme hint. */
export default function IdentityInspector({ doc, diagnostics, authorBase, onChange, part }: IdentityInspectorProps) {
  const t = useT(formatStudioEditorMessages);
  const p = useT(formatStudioPrimitivesMessages);

  return (
    <FieldIssuesProvider diagnostics={diagnostics} definition={doc}>
      <div className="min-w-0 space-y-4" data-inspector={part}>
        <h2 id={INSPECTOR_HEADING_ID} tabIndex={-1} className="font-heading text-xl font-bold text-poke-text-primary focus:outline-none">
          {part === 'identity' ? t('inspector.identity.heading') : t('inspector.identity.lookHeading')}
        </h2>
        {part === 'identity' ? (
          <>
            <LTextField
              pointer={ptr('identity', 'name')}
              label={t('inspector.identity.name')}
              value={doc.identity.name}
              base={authorBase}
              onChange={(next) => next !== undefined && onChange({ ...doc, identity: { ...doc.identity, name: next } })}
            />
            <LTextField
              pointer={ptr('identity', 'summary')}
              label={p('field.summary')}
              value={doc.identity.summary}
              base={authorBase}
              multiline
              removeLabel={t('inspector.identity.removeSummary')}
              onRemove={() => {
                const { summary: _removed, ...identity } = doc.identity;
                onChange({ ...doc, identity });
              }}
              onChange={(next) => {
                if (next === undefined || !hasText(next)) {
                  const { summary: _removed, ...identity } = doc.identity;
                  onChange({ ...doc, identity });
                } else {
                  onChange({ ...doc, identity: { ...doc.identity, summary: next } });
                }
              }}
            />
          </>
        ) : (
          <ThemeFields doc={doc} onChange={onChange} />
        )}
      </div>
    </FieldIssuesProvider>
  );
}
