import type { Database } from '@/types/database';
import type { TeraRules } from '@/types/format-rules';
import { formatPack } from '@/lib/format-pack';

type E = Database['public']['Enums'];

const P = formatPack.messages.en.enums;

/**
 * Labels for every DB enum (i18n-core §5.3), plus price groups, bracket sides
 * and tera rules. Keys are the stored values verbatim. Adding a DB enum value
 * fails `tsc` until it is labelled here. Read-only after G0-I18N-RT except for
 * B-SCHEMA (same-commit labels for a new DB enum value only). The price-group
 * labels (`priceGroup.*`) come from the active format pack (design spec §E.1).
 */
export default {
  matchStatus: {
    scheduled: 'Scheduled',
    in_progress: 'In progress',
    pending_confirmation: 'Awaiting confirmation',
    completed: 'Completed',
    disputed: 'Disputed',
  },
  roundStatus: { pending: 'Pending', active: 'Active', completed: 'Completed' },
  seasonStatus: { upcoming: 'Upcoming', active: 'Active', completed: 'Completed' },
  tournamentStatus: { upcoming: 'Upcoming', active: 'Active', completed: 'Completed' },
  bracketType: {
    single_elim: 'Single elimination',
    double_elim: 'Double elimination',
    round_robin: 'Round robin',
    swiss: 'Swiss',
  },
  bracketSide: { winners: 'Winners bracket', losers: 'Losers bracket', grand_finals: 'Grand finals' },
  formatType: { singles: 'Singles', doubles: 'Doubles', draft: 'Draft', evolution_point_buy: 'Evolution Point Buy' },
  draftType: { snake: 'Snake', auction: 'Auction', budget: 'Budget' },
  draftPoolStatus: { pending: 'Pending', in_progress: 'In progress', complete: 'Complete' },
  matchProposalStatus: {
    pending: 'Pending',
    accepted: 'Accepted',
    rejected: 'Rejected',
    expired: 'Expired',
    cancelled: 'Cancelled',
  },
  gameSource: { ps_replay: 'Showdown replay', manual: 'Manual', champions: 'Champions' },
  teamVisibility: { hidden_until_match: 'Hidden until the match', always_public: 'Always public' },
  teamImportSource: { pokepastes: 'PokePaste', manual: 'Manual', ps_text: 'Showdown text' },
  aggregateScope: { tournament: 'Tournament', league: 'League', all_time: 'All time' },
  ...P,
  teraRule: { any: 'Any Tera type', stab_only: 'STAB Tera types only', none: 'No Terastallization' },
} as const satisfies {
  matchStatus: Record<E['match_status'], string>;
  roundStatus: Record<E['round_status'], string>;
  seasonStatus: Record<E['season_status'], string>;
  tournamentStatus: Record<E['tournament_status'], string>;
  bracketType: Record<E['bracket_type'], string>;
  bracketSide: Record<string, string>;
  formatType: Record<E['season_format_type'], string>;
  draftType: Record<E['draft_type'], string>;
  draftPoolStatus: Record<E['draft_pool_status'], string>;
  matchProposalStatus: Record<E['match_proposal_status'], string>;
  gameSource: Record<E['game_source'], string>;
  teamVisibility: Record<E['team_visibility'], string>;
  teamImportSource: Record<E['team_import_source'], string>;
  aggregateScope: Record<E['aggregate_scope'], string>;
  priceGroup: Record<string, string>;
  teraRule: Record<TeraRules[keyof TeraRules], string>;
};
