import { defineDe } from '@/i18n/define';
import { formatPack } from '@/lib/format-pack';
import type en from './en';

const P = formatPack.messages.de.enums;

// Wording of the existing groups copied from the reviewed hub copy (`src/lib/league-hub/copy.ts`).
export default defineDe<typeof en>()({
  matchStatus: {
    scheduled: 'Angesetzt',
    in_progress: 'Läuft',
    pending_confirmation: 'Wartet auf Bestätigung',
    completed: 'Beendet',
    disputed: 'Strittig',
  },
  roundStatus: { pending: 'Offen', active: 'Läuft', completed: 'Abgeschlossen' },
  seasonStatus: { upcoming: 'Bevorstehend', active: 'Läuft', completed: 'Abgeschlossen' },
  tournamentStatus: { upcoming: 'Bevorstehend', active: 'Läuft', completed: 'Abgeschlossen' },
  bracketType: {
    single_elim: 'K.-o.-System',
    double_elim: 'Doppel-K.-o.',
    round_robin: 'Jeder gegen jeden',
    swiss: 'Schweizer System',
  },
  bracketSide: { winners: 'Gewinnerseite', losers: 'Verliererseite', grand_finals: 'Großes Finale' },
  formatType: { singles: 'Einzel', doubles: 'Doppel', draft: 'Draft', evolution_point_buy: 'Evolution Point Buy' },
  draftType: { snake: 'Snake', auction: 'Auktion', budget: 'Budget' },
  draftPoolStatus: { pending: 'Ausstehend', in_progress: 'Läuft', complete: 'Abgeschlossen' },
  matchProposalStatus: {
    pending: 'Ausstehend',
    accepted: 'Angenommen',
    rejected: 'Abgelehnt',
    expired: 'Abgelaufen',
    cancelled: 'Zurückgezogen',
  },
  gameSource: { ps_replay: 'Showdown-Replay', manual: 'Manuell', champions: 'Champions' },
  teamVisibility: { hidden_until_match: 'Bis zum Spiel verborgen', always_public: 'Immer öffentlich' },
  teamImportSource: { pokepastes: 'PokePaste', manual: 'Manuell', ps_text: 'Showdown-Text' },
  aggregateScope: { tournament: 'Turnier', league: 'Liga', all_time: 'Gesamt' },
  ...P,
  teraRule: { any: 'Beliebiger Tera-Typ', stab_only: 'Nur STAB-Tera-Typen', none: 'Kein Terakristallisieren' },
});
