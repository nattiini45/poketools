import ElimBracketView from '@/components/bracket/ElimBracketView';
import type { BracketCopy } from '@/components/bracket/labels';
import type { LeagueHubCopy } from '@/lib/league-hub/copy';
import type { HubBracketStage } from '@/lib/league-hub/load';
import type { MatchRecord } from '@/lib/tournament/types';
import { HubNotice, HubStageHeader } from './HubBits';

interface HubPlayoffsPanelProps {
  stages: HubBracketStage[];
  copy: LeagueHubCopy;
  /** The bracket in German (`hubSharedLabels`); absent draws it with its own defaults, as the phase page does. */
  bracketCopy?: BracketCopy;
}

/**
 * Playoffs: the bracket of every elimination phase, drawn exactly as the
 * phase page draws it (slot skeleton, feeder labels, a settled bracket reset
 * left out), in the viewer's language.
 */
export default function HubPlayoffsPanel({ stages, copy, bracketCopy }: HubPlayoffsPanelProps) {
  if (stages.length === 0) return <HubNotice>{copy.playoffsEmpty}</HubNotice>;

  return (
    <div className="space-y-10">
      {stages.map(({ stage, rounds, matches, participants }) => {
        const records: MatchRecord[] = matches
          .filter((match) => match.status === 'completed')
          .map((match) => ({
            player_1_id: match.player_1_id,
            player_2_id: match.player_2_id,
            winner_id: match.winner_id,
            round_number: 0,
          }));
        const bracketType = stage.bracket_type === 'double_elim' ? 'double_elim' : 'single_elim';
        return (
          <div key={stage.id} className="space-y-4">
            <HubStageHeader
              name={stage.name}
              meta={`${copy.bracketType[stage.bracket_type] ?? stage.bracket_type} · ${copy.bestOf(stage.best_of_default)} · ${copy.players(participants.length)}`}
              status={stage.status}
              statusLabel={copy.status[stage.status] ?? stage.status}
              href={`/tournaments/${stage.id}`}
              linkLabel={copy.links.phasePage}
            />
            {rounds.length === 0 ? (
              <HubNotice>{copy.bracketPending}</HubNotice>
            ) : (
              <ElimBracketView
                bracketType={bracketType}
                tournamentId={stage.id}
                rounds={rounds}
                matches={matches}
                participants={participants}
                matchRecords={records}
                copy={bracketCopy}
                bracketResetEnabled={stage.bracket_reset_enabled ?? true}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
