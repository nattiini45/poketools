'use client';

import Card from '@/components/ui/Card';
import type { StageDescription } from '@/lib/format-kit/client';
import { Heading, childLevel, type HeadingLevel } from './headingLevel';

interface StageOutlineProps {
  /** Stages in display order, already described in the viewer's language. */
  stages: readonly StageDescription[];
  /** The level of the heading that introduces this outline; each stage heading is one level below it. */
  parentLevel: HeadingLevel;
}

/** The lines of one stage card, in reading order; empty and absent lines are dropped. */
function lines(stage: StageDescription): string[] {
  const all: (string | null)[] = [
    stage.pairing,
    stage.series,
    stage.participants,
    stage.groups,
    stage.ruleset,
    stage.scoring,
    stage.doubles,
    stage.rankChain,
    stage.expected,
  ];
  return all.filter((line): line is string => line !== null && line !== '');
}

/**
 * The stages as cards, one sentence per setting. Between two cards sit the advancement sentences of the stage
 * above (who moves on, how they are seeded, whether an admin confirms), so the flow reads top to bottom.
 */
export default function StageOutline({ stages, parentLevel }: StageOutlineProps) {
  return (
    <ol className="space-y-2">
      {stages.map((stage, index) => (
        <li key={stage.key} className="min-w-0">
          <Card padding="sm" className="space-y-2">
            <Heading level={childLevel(parentLevel)} className="flex items-baseline gap-2 font-heading font-semibold text-poke-text-primary">
              <span aria-hidden="true" className="text-sm text-poke-text-muted">
                {index + 1}
              </span>
              <span className="min-w-0 break-words">{stage.name}</span>
            </Heading>
            <ul className="space-y-1 text-sm text-poke-text-secondary">
              {lines(stage).map((line, i) => (
                <li key={i} className="break-words">
                  {line}
                </li>
              ))}
            </ul>
          </Card>
          {stage.outgoing.length > 0 && (
            <ul className="my-2 ml-4 space-y-1 border-l-2 border-poke-border pl-3 text-sm text-poke-text-secondary">
              {stage.outgoing.map((sentence, i) => (
                <li key={i} className="break-words">
                  {sentence}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
