import RulesetDetail, { type RulesetDetailLabels } from '@/components/ruleset/RulesetDetail';
import CoreLigaParticipants from '@/components/league/CoreLigaParticipants';
import { PANEL_INSET } from '@/components/world/panel';
import type { LeagueHubCopy } from '@/lib/league-hub/copy';
import type { CoreTriple } from '@/types/season';
import type { Ruleset } from '@/types/ruleset';
import { HubLink, HubNotice } from './HubBits';

interface HubRulesPanelProps {
  description: string | null;
  ruleset: Ruleset | null;
  /** Core Liga assignments; only formats with type cores pass them. */
  coreParticipants?: { id: string; name: string; coreTypes: CoreTriple | null }[];
  /** Anchor of the world's format-rules plaque, for formats that have one. */
  formatRulesHref?: string;
  copy: LeagueHubCopy;
  /** The ruleset detail's words in another language; absent keeps its English. */
  rulesetLabels?: RulesetDetailLabels;
}

/**
 * Rules: the league description, the full ruleset (clauses, bans, additions,
 * custom rules) and the Core Liga type cores where the format assigns them.
 */
export default function HubRulesPanel({
  description,
  ruleset,
  coreParticipants,
  formatRulesHref,
  copy,
  rulesetLabels,
}: HubRulesPanelProps) {
  return (
    <div className="space-y-6">
      {description && description.trim().length > 0 && (
        <div className={`${PANEL_INSET} p-4`}>
          <h4 className="font-heading text-sm font-bold uppercase tracking-wide text-arena-ink-secondary">
            {copy.description}
          </h4>
          <p className="mt-2 whitespace-pre-wrap text-sm text-arena-ink">{description}</p>
        </div>
      )}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-heading text-sm font-bold uppercase tracking-wide text-arena-ink-secondary">
            {copy.ruleset}
            {ruleset ? ` · ${ruleset.name}` : ''}
          </h4>
          {formatRulesHref && <HubLink href={formatRulesHref}>{copy.formatRulesLink}</HubLink>}
        </div>
        {ruleset ? (
          <RulesetDetail ruleset={ruleset} blockTag="div" labels={rulesetLabels} />
        ) : (
          <HubNotice>{copy.noRuleset}</HubNotice>
        )}
      </div>
      {coreParticipants && <CoreLigaParticipants participants={coreParticipants} heading={copy.coreLiga} />}
    </div>
  );
}
