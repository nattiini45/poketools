import RoundRobinTable, { type RoundRobinTableLabels } from '@/components/bracket/RoundRobinTable';
import { FOCUS_RING, PANEL_INSET } from '@/components/world/panel';
import type { LeagueHubCopy } from '@/lib/league-hub/copy';
import type { HubTableStage } from '@/lib/league-hub/views';
import { HubNotice, HubStageHeader } from './HubBits';
import HubStandingsTable from './HubStandingsTable';

interface HubGroupsPanelProps {
  stages: HubTableStage[];
  isEvolutionPointBuy: boolean;
  copy: LeagueHubCopy;
  /** The results grid's words in another language; absent keeps its English. */
  gridLabels?: RoundRobinTableLabels;
}

/**
 * Group stage: the standings of every table phase. A grouped phase gets one
 * table per group (only matches inside the group count) with its advancement
 * zone; round robin tables add a results grid. An ungrouped phase gets one
 * table. Scoring matches the phase page.
 */
export default function HubGroupsPanel({ stages, isEvolutionPointBuy, copy, gridLabels }: HubGroupsPanelProps) {
  if (stages.length === 0) return <HubNotice>{copy.groupsEmpty}</HubNotice>;

  return (
    <div className="space-y-10">
      {stages.map(({ stage, scoring, advancementRule: rule, tables }) => {
        const notes = [
          isEvolutionPointBuy
            ? copy.evolutionScoring
            : scoring === 'swiss'
              ? copy.swissScoring
              : copy.roundRobinScoring,
          rule ? copy.advances(rule.count, rule.per_group) : null,
        ].filter((note): note is string => note !== null);
        return (
          <div key={stage.id} className="space-y-4">
            <HubStageHeader
              name={stage.name}
              meta={`${copy.bracketType[stage.bracket_type] ?? stage.bracket_type} · ${notes.join(' · ')}`}
              status={stage.status}
              statusLabel={copy.status[stage.status] ?? stage.status}
              href={`/tournaments/${stage.id}`}
              linkLabel={copy.links.phasePage}
            />
            {tables.length === 0 ? (
              <HubNotice>{copy.groupsNoPlayers}</HubNotice>
            ) : (
              <div className={`grid grid-cols-[minmax(0,1fr)] gap-4 ${tables.length > 1 ? 'xl:grid-cols-2' : ''}`}>
                {tables.map((table) => (
                  <div key={table.key} className={`${PANEL_INSET} min-w-0 space-y-3 p-4`}>
                    {table.name && (
                      <h5 className="font-heading text-sm font-bold uppercase tracking-wide text-arena-ink-secondary">
                        {table.name}
                      </h5>
                    )}
                    <HubStandingsTable
                      rows={table.standings}
                      copy={copy}
                      caption={table.name ? `${stage.name} · ${table.name}` : stage.name}
                      advanceCount={table.advanceCount}
                      columns={{
                        games: scoring === 'round_robin' && !isEvolutionPointBuy,
                        killDiff: scoring === 'round_robin',
                        evolution: isEvolutionPointBuy,
                        decisionTie: isEvolutionPointBuy && scoring === 'round_robin',
                        buchholz: scoring === 'swiss' && !isEvolutionPointBuy,
                      }}
                    />
                    {scoring === 'round_robin' && table.members.length > 1 && (
                      <details className="group">
                        <summary
                          className={`inline-flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-arena-ink-secondary hover:text-arena-ink ${FOCUS_RING}`}
                        >
                          <span
                            aria-hidden="true"
                            className="transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
                          >
                            ›
                          </span>
                          {copy.resultsGrid}
                        </summary>
                        <div className="mt-3">
                          <RoundRobinTable participants={table.members} matches={table.matches} labels={gridLabels} />
                        </div>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
