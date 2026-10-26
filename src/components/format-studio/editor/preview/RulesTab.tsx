'use client';

import { useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import type { CompileResult } from '@/lib/format-kit/client';
import type { DraftDocument } from '@/lib/format-studio/editor/document';
import RulesText from '../../RulesText';

interface RulesTabProps {
  doc: DraftDocument;
  result: CompileResult;
  rulesets: readonly { id: string; name: string }[];
}

/**
 * The rules text of the draft, written the way the read-only pages write it. A draft with problems still gets
 * a text (the describer reads any document), with a notice that it may be incomplete.
 */
export default function RulesTab({ doc, result, rulesets }: RulesTabProps) {
  const t = useT(formatStudioEditorMessages);
  const order = result.graph === null ? [] : [...result.graph.order];
  for (const stage of doc.stages) {
    if (!order.includes(stage.key)) order.push(stage.key);
  }

  return (
    <div className="space-y-3">
      {!result.ok && <p role="note" className="text-sm text-poke-text-muted">{t('preview.rules.incomplete')}</p>}
      <RulesText definition={doc} plan={result.plan} order={order} rulesets={rulesets} parentLevel={2} />
    </div>
  );
}
