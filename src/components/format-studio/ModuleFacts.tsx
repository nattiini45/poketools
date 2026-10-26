'use client';

import Link from 'next/link';
import Card from '@/components/ui/Card';
import { useT } from '@/i18n/client';
import { formatStudioAdminMessages } from '@/i18n/messages/format-studio/admin';
import type { ModuleDescription } from '@/lib/format-kit/client';
import { Heading, childLevel, type HeadingLevel } from './headingLevel';

interface ModuleFactsProps {
  modules: readonly ModuleDescription[];
  /** Where each module's settings are edited (the league admin tab); absent for an adapter without a link. */
  editorLinks?: Partial<Record<ModuleDescription['adapter'], string>>;
  /** The level of the heading that introduces these modules; each module heading is one level below it. */
  parentLevel: HeadingLevel;
}

/**
 * Legacy modules (Core Liga, classic draft, Evolution Point Buy): data the league already holds, shown as a
 * read-only label and value table. The Studio does not run or change them; the link goes to where they are edited.
 */
export default function ModuleFacts({ modules, editorLinks, parentLevel }: ModuleFactsProps) {
  const t = useT(formatStudioAdminMessages);

  return (
    <div className="space-y-3">
      {modules.map((mod) => {
        const href = editorLinks?.[mod.adapter];
        return (
          <Card key={mod.adapter} padding="sm" className="space-y-2">
            <Heading level={childLevel(parentLevel)} className="font-heading font-semibold text-poke-text-primary">{mod.label}</Heading>
            {mod.summary !== '' && <p className="text-sm text-poke-text-secondary">{mod.summary}</p>}
            {mod.facts.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-poke-border text-poke-text-muted">
                      <th scope="col" className="py-1 pr-4 font-medium">
                        {t('detail.factLabel')}
                      </th>
                      <th scope="col" className="py-1 font-medium">
                        {t('detail.factValue')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {mod.facts.map((fact) => (
                      <tr key={fact.key} className="border-b border-poke-border/60 last:border-0">
                        <th scope="row" className="py-1 pr-4 font-normal text-poke-text-secondary">
                          {fact.label}
                        </th>
                        <td className="py-1 text-poke-text-primary">{fact.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-sm text-poke-text-muted">
              {t('detail.legacyNote')}
              {href !== undefined && (
                <>
                  {' '}
                  <Link href={href} className="font-medium text-poke-blue hover:underline">
                    {t('detail.editIn')}
                  </Link>
                </>
              )}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
