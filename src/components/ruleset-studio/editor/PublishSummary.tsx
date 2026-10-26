'use client';

import { useT } from '@/i18n/client';
import { rulesetStudioDiagnosticsMessages } from '@/i18n/messages/ruleset-studio/diagnostics';
import { rulesetStudioSummaryMessages } from '@/i18n/messages/ruleset-studio/summary';
import type { CompileResult } from '@/lib/ruleset-kit/compile';
import type { RulesetCategory } from '@/lib/ruleset-kit/types';
import { diagnosticText } from '../summary/diagnostic-text';

interface PublishSummaryProps {
  result: CompileResult;
  nameOf: (category: RulesetCategory, id: string) => string;
}

/**
 * What a publish will do, in plain sentences: the compile findings (errors block, warnings do not) and, when there is
 * nothing to fix, the effective rules the new version will freeze. The slot of the shared publish dialog.
 */
export default function PublishSummary({ result, nameOf }: PublishSummaryProps) {
  const t = useT(rulesetStudioSummaryMessages);
  const tDiag = useT(rulesetStudioDiagnosticsMessages);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
  const resolved = result.resolved;

  const list = (heading: string, items: typeof errors) =>
    items.length === 0 ? null : (
      <section className="space-y-1">
        <h3 className="font-heading text-sm font-semibold text-poke-text-primary">{heading}</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-poke-text-secondary">
          {items.slice(0, 20).map((d, index) => (
            <li key={`${d.code}:${d.path}:${index}`} className="break-words">
              {diagnosticText(d, tDiag, nameOf)}
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <>
      {list(t('publish.errors', { count: errors.length }), errors)}
      {list(t('publish.warnings', { count: warnings.length }), warnings)}
      {errors.length === 0 && resolved !== null && (
        <section className="space-y-1">
          <p className="text-sm text-poke-text-secondary">{t('publish.ready')}</p>
          <p className="text-sm font-semibold text-poke-text-primary">
            {t('publish.line', {
              gen: resolved.gen,
              game: t(resolved.doubles ? 'game.doubles' : 'game.singles'),
              bans: resolved.pokemon.ids.length + resolved.moves.ids.length + resolved.items.ids.length + resolved.abilities.ids.length,
              clauses: t('clauseCount', { count: resolved.clauses.length }),
            })}
          </p>
        </section>
      )}
    </>
  );
}
