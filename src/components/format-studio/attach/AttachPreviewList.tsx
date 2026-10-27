'use client';

import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import { useT } from '@/i18n/client';
import { formatStudioAttachMessages } from '@/i18n/messages/format-studio/attach';
import { formatStudioPrimitivesMessages } from '@/i18n/messages/format-studio/primitives';
import type { AttachPreview } from '@/lib/format-studio/editor/attach-preview';
import type { EngineGap } from '@/lib/format-studio/library-types';
import { Heading, childLevel, type HeadingLevel } from '../headingLevel';

interface EngineGapListProps {
  gaps: readonly EngineGap[];
  /** Phase names by stage key; a key missing here is shown as the key. */
  stageNames: Readonly<Record<string, string>>;
  /** The level of the heading of the list. */
  headingLevel?: HeadingLevel;
}

/**
 * The parts of a format the engine does not run yet, one plain sentence per gap. The sentence comes from the gap code
 * and its params; a phase is named by its name when the caller knows it. Renders nothing when there is no gap.
 */
export function EngineGapList({ gaps, stageNames, headingLevel = 4 }: EngineGapListProps) {
  const t = useT(formatStudioAttachMessages);
  if (gaps.length === 0) return null;
  return (
    <div className="space-y-1.5" data-engine-gaps>
      <Heading level={headingLevel} className="text-sm font-heading font-semibold text-poke-text-primary">
        {t('preview.gapsHeading')}
      </Heading>
      <ul className="list-disc space-y-1 pl-5 text-sm text-poke-text-secondary">
        {gaps.map((gap, index) => {
          const kind = typeof gap.params.kind === 'string' ? gap.params.kind : '';
          const stage = gap.stage === undefined ? '' : (stageNames[gap.stage] ?? gap.stage);
          return (
            <li key={`${gap.code}:${gap.stage ?? ''}:${gap.edge ?? ''}:${index}`} className="break-words">
              {t.dynamic(`preview.gaps.${gap.code}`, {
                ...gap.params,
                stage,
                edge: gap.edge ?? '',
                kind: kind === '' ? '' : t.dynamic(`preview.gapKinds.${kind}`, undefined, kind),
              })}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface AttachPreviewListProps {
  preview: AttachPreview;
  /** The read-only page of the previewed format; the invalid sentence links there. */
  formatHref?: string | null;
  headingLevel?: HeadingLevel;
}

/**
 * What an attach would create: the ordered phases (name, bracket type, best of, doubles, ruleset: the league's, a stored one or a rule preset
 * that attach turns into a ruleset of the league; the preview names the ruleset and its version when it knows them) and the engine
 * gaps in plain words. An invalid version gets one fixed sentence and a link to its page; the first error is not
 * worded here, because a diagnostic sentence needs params the preview does not keep.
 */
export default function AttachPreviewList({ preview, formatHref = null, headingLevel = 3 }: AttachPreviewListProps) {
  const t = useT(formatStudioAttachMessages);
  // The bracket words come from the Studio's own catalog, not `enums`: that catalog pulls the format pack (and zod)
  // into the browser bundle, which the Studio client boundary forbids.
  const tWords = useT(formatStudioPrimitivesMessages);

  if (!preview.ok) {
    return (
      <div className="space-y-2" data-attach-preview="invalid">
        <p className="text-sm text-poke-text-secondary">{t('preview.invalid')}</p>
        {formatHref !== null && (
          <Link
            href={formatHref}
            className="inline-flex min-h-11 items-center text-sm font-medium text-poke-blue hover:underline sm:min-h-0"
          >
            {t('preview.openFormat')}
          </Link>
        )}
      </div>
    );
  }

  const stageNames: Record<string, string> = {};
  for (const stage of preview.stages) stageNames[stage.key] = stage.name;

  return (
    <div className="space-y-3" data-attach-preview="ok">
      <Heading level={headingLevel} className="text-sm font-heading font-semibold text-poke-text-primary">
        {t('preview.heading')}
      </Heading>
      <ol className="space-y-2">
        {preview.stages.map((stage) => (
          <li
            key={stage.key}
            className="min-w-0 rounded-poke-md border border-poke-border bg-poke-elevated/40 px-3 py-2"
            data-attach-stage={stage.key}
          >
            <p className="break-words text-sm font-medium text-poke-text-primary">
              <span className="text-poke-text-muted">{t('preview.phase', { order: stage.order })}: </span>
              {stage.name}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-poke-text-secondary">
              <span>{tWords.dynamic(`label.pairing_${stage.bracketType}`, undefined, stage.bracketType)}</span>
              <span aria-hidden="true">·</span>
              <span>{t('preview.bestOf', { n: stage.bestOf })}</span>
              <span aria-hidden="true">·</span>
              <span>
                {stage.ruleset === 'preset'
                  ? t('preview.rulesetPreset', { preset: stage.presetName ?? '' })
                  : stage.ruleset === 'named'
                    ? stage.rulesetLabel === undefined
                      ? t('preview.rulesetOwn')
                      : t('preview.rulesetOwnNamed', { name: stage.rulesetLabel.name, version: stage.rulesetLabel.version_no })
                    : stage.rulesetLabel === undefined
                      ? t('preview.rulesetLeague')
                      : t('preview.rulesetLeagueNamed', { name: stage.rulesetLabel.name, version: stage.rulesetLabel.version_no })}
              </span>
              {stage.doubles && <Badge variant="blue">{t('preview.doubles')}</Badge>}
            </div>
          </li>
        ))}
      </ol>
      <EngineGapList gaps={preview.warnings} stageNames={stageNames} headingLevel={childLevel(headingLevel)} />
    </div>
  );
}
