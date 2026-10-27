'use client';

import { useMemo, useState } from 'react';
import { buttonVariants } from '@/components/ui/buttonStyles';
import Card from '@/components/ui/Card';
import { createTranslator } from '@/i18n/core';
import { useLocale, useT } from '@/i18n/client';
import { formatStudioAdminMessages } from '@/i18n/messages/format-studio/admin';
import { formatStudioDescribeMessages } from '@/i18n/messages/format-studio/describe';
import { describeDefinition, type FormatDefinition, type StagePlan } from '@/lib/format-kit/client';
import type { Locale } from '@/i18n/config';
import { cn } from '@/lib/utils/cn';
import { Heading, childLevel, type HeadingLevel } from './headingLevel';

interface RulesTextProps {
  definition: FormatDefinition;
  plan: readonly StagePlan[] | null;
  order: readonly string[];
  rulesets: readonly { id: string; name: string }[];
  /** The level of the heading that introduces the rules text; its section headings are one level below it. */
  parentLevel: HeadingLevel;
}

const TOGGLE_LOCALES: readonly Locale[] = ['en', 'de'];

/**
 * The format as a rules document, with an English / German toggle. The text is generated after the read:
 * `describeDefinition` runs here with the chosen language, so one cached view serves both. The state is the
 * language key (never translated text); until a button is pressed the document follows the viewer's language.
 *
 * `lang` sits on the generated text only: the toggle and the status line are page chrome and keep the page language.
 * A switch is announced politely through the status line (empty until a button is pressed).
 */
export default function RulesText({ definition, plan, order, rulesets, parentLevel }: RulesTextProps) {
  const t = useT(formatStudioAdminMessages);
  const viewer = useLocale();
  const [chosen, setChosen] = useState<Locale | null>(null);
  const locale = chosen ?? viewer;

  const doc = useMemo(
    () => describeDefinition(definition, locale, { plan: plan ?? undefined, order, rulesets }),
    [definition, plan, order, rulesets, locale],
  );
  const sectionLevel = childLevel(parentLevel);
  const heading = useMemo(() => createTranslator(formatStudioDescribeMessages, locale), [locale]);

  return (
    <div className="space-y-3">
      <div role="group" aria-label={t('detail.rulesLanguage')} className="inline-flex gap-1">
        {TOGGLE_LOCALES.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={locale === option}
            onClick={() => setChosen(option)}
            className={cn(buttonVariants({ variant: locale === option ? 'primary' : 'secondary', size: 'sm' }), 'min-h-11 sm:min-h-0')}
          >
            {option === 'en' ? t('detail.languageEn') : t('detail.languageDe')}
          </button>
        ))}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {chosen === null ? '' : chosen === 'en' ? t('detail.rulesShownEn') : t('detail.rulesShownDe')}
      </p>

      <Card padding="md" lang={locale} className="space-y-4 break-words text-sm text-poke-text-primary">
        <p>{doc.overview}</p>

        {doc.stages.length > 0 && (
          <section className="space-y-2">
            <Heading level={sectionLevel} className="font-heading font-semibold">{heading('heading.stages')}</Heading>
            {doc.stages.map((stage) => (
              <div key={stage.key} className="space-y-1">
                <p className="font-medium">{stage.name}</p>
                <p className="text-poke-text-secondary">
                  {[stage.summary, stage.participants, stage.groups, stage.ruleset, stage.doubles, stage.expected]
                    .filter((line): line is string => line !== null && line !== '')
                    .join(' ')}
                </p>
              </div>
            ))}
          </section>
        )}

        {doc.advancement.length > 0 && (
          <section className="space-y-2">
            <Heading level={sectionLevel} className="font-heading font-semibold">{heading('heading.advancement')}</Heading>
            <ul className="list-disc space-y-1 pl-5 text-poke-text-secondary">
              {doc.advancement.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>
        )}

        {doc.views.length > 0 && (
          <section className="space-y-2">
            <Heading level={sectionLevel} className="font-heading font-semibold">{heading('heading.views')}</Heading>
            <ul className="list-disc space-y-1 pl-5 text-poke-text-secondary">
              {doc.views.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>
        )}

        {doc.rules.length > 0 && (
          <section className="space-y-2">
            <Heading level={sectionLevel} className="font-heading font-semibold">{heading('heading.rules')}</Heading>
            <ul className="space-y-2">
              {doc.rules.map((rule) => (
                <li key={rule.id} className="space-y-0.5">
                  <p>{rule.text}</p>
                  <p className="text-poke-text-secondary">
                    {rule.verify} {rule.when}
                    {!rule.visibleToPlayers && <> {heading('rule.visible_no')}</>}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {doc.modules.length > 0 && (
          <section className="space-y-2">
            <Heading level={sectionLevel} className="font-heading font-semibold">{heading('heading.modules')}</Heading>
            <ul className="list-disc space-y-1 pl-5 text-poke-text-secondary">
              {doc.modules.map((mod) => (
                <li key={mod.adapter}>
                  <span className="font-medium text-poke-text-primary">{mod.label}</span> {mod.summary}
                </li>
              ))}
            </ul>
          </section>
        )}

        {doc.sections.length > 0 && (
          <section className="space-y-2">
            <Heading level={sectionLevel} className="font-heading font-semibold">{heading('heading.sections')}</Heading>
            {doc.sections.map((section) => (
              <div key={section.id} className="space-y-0.5">
                <p className="font-medium">{section.title}</p>
                <p className="whitespace-pre-line text-poke-text-secondary">{section.body}</p>
              </div>
            ))}
          </section>
        )}

        <p className="text-poke-text-secondary">{doc.coverageLine}</p>
      </Card>
    </div>
  );
}
