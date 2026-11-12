import type { DescribedRuleset } from '@/lib/ruleset-kit/describe';
import ShowdownChallenge from './ShowdownChallenge';

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
    <div lang={lang} className="space-y-5">
      {rules.sections.map((section) => (
        <section key={section.id} id={`rules-${section.id}`} className="scroll-mt-24 space-y-1">
          <Heading className="font-heading text-body font-[550] text-fg-muted">{section.heading}</Heading>
          {section.lines.map((line) => (
            <p key={line} className="max-w-prose whitespace-pre-wrap break-words text-sm text-fg">
              {line}
            </p>
          ))}
        </section>
      ))}
      <ShowdownChallenge value={rules.showdownChallenge} headingLevel={headingLevel} />
      <p className="text-xs font-semibold text-fg-muted">{rules.coverage}</p>
    </div>
  );
}
