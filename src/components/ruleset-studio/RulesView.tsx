import type { DescribedRuleset } from '@/lib/ruleset-kit/describe';

interface RulesViewProps {
  rules: DescribedRuleset;
  /** The language of the sentences (marks the block for screen readers and hyphenation). */
  lang: string;
  /** The heading level of the section headings (the page's own heading is above). */
  headingLevel?: 2 | 3;
}

/**
 * The effective rules of a ruleset in plain sentences: base, clauses, the four lists, team rules, notes, and the coverage
 * line. Hook-free and server-safe, so the read-only pages render it with a `DescribedRuleset` they built.
 */
export default function RulesView({ rules, lang, headingLevel = 3 }: RulesViewProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div lang={lang} className="space-y-4">
      {rules.sections.map((section) => (
        <section key={section.id} className="space-y-1">
          <Heading className="font-heading text-sm font-semibold text-poke-text-secondary">{section.heading}</Heading>
          {section.lines.map((line) => (
            <p key={line} className="max-w-prose whitespace-pre-wrap break-words text-sm text-poke-text-primary">
              {line}
            </p>
          ))}
        </section>
      ))}
      <p className="text-xs font-semibold text-poke-text-muted">{rules.coverage}</p>
    </div>
  );
}
