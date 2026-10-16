import Link from 'next/link';
import GymTypedName from '@/components/shared/GymTypedName';
import { FOCUS_RING, PANEL_HOVER, PANEL_INSET } from '@/components/world/panel';
import type { LeagueHubCopy } from '@/lib/league-hub/copy';
import type { HubPhase } from '@/lib/league-hub/load';
import { HubNotice, HubStatusChip } from './HubBits';

interface HubPhasesPanelProps {
  phases: HubPhase[];
  copy: LeagueHubCopy;
}

/**
 * Phases: one card per phase in stage order (format, best-of, players,
 * status, advancement rule where a later phase takes the qualifiers) with its
 * groups and their members (the players the group tables list). Each card
 * opens the phase page.
 */
export default function HubPhasesPanel({ phases, copy }: HubPhasesPanelProps) {
  if (phases.length === 0) return <HubNotice>{copy.phasesEmpty}</HubNotice>;

  return (
    <ol className="space-y-3">
      {phases.map(({ stage, groups, showAdvancement }, index) => (
        <li key={stage.id}>
          <Link
            href={`/tournaments/${stage.id}`}
            className={`block ${PANEL_INSET} ${PANEL_HOVER} p-4 ${FOCUS_RING}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-heading text-base font-bold text-arena-ink">
                  <span className="mr-2 text-arena-accent-strong">{index + 1}.</span>
                  {stage.name}
                </p>
                <p className="mt-1 text-xs text-arena-ink-secondary">
                  {copy.bracketType[stage.bracket_type] ?? stage.bracket_type} · {copy.bestOf(stage.best_of_default)} ·{' '}
                  {copy.players(stage.participant_count)}
                </p>
              </div>
              <HubStatusChip status={stage.status} label={copy.status[stage.status] ?? stage.status} />
            </div>
            {showAdvancement && stage.advancement_rule && (
              <p className="mt-2 text-xs font-semibold text-arena-accent-strong">
                {copy.advances(stage.advancement_rule.count, stage.advancement_rule.per_group)}
              </p>
            )}
            {groups.length > 0 && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {groups.map((group) => (
                  <div key={group.id} className="rounded-lg border border-arena-border bg-arena-surface p-2.5">
                    <p className="mb-1 font-heading text-xs font-bold text-arena-ink">{group.name}</p>
                    {group.members.length === 0 ? (
                      <p className="text-xs text-arena-ink-secondary">{copy.noMembers}</p>
                    ) : (
                      <ul className="space-y-0.5 text-xs text-arena-ink-secondary">
                        {group.members.map((member) => (
                          <li key={member.player_id}>
                            {member.seed > 0 && <span className="mr-1 tabular-nums">#{member.seed}</span>}
                            <GymTypedName name={member.player_name} gymType={member.gym_type} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Link>
        </li>
      ))}
    </ol>
  );
}
