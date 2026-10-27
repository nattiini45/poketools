import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  // G0-ERR seed
  POOL_NOT_ACTIVE: 'Der Draft ist gerade nicht aktiv.',
  DRAFT_COMPLETE: 'Der Draft ist abgeschlossen.',
  NOT_YOUR_TURN: 'Du bist gerade nicht am Zug.',
  POKEMON_TAKEN: '{pokemon} wurde bereits gedraftet.',
  INSUFFICIENT_BUDGET: 'Budget reicht nicht: Diese Linie kostet {price} P, du hast {remaining} P.',
  LINE_TAKEN: 'Diese Linie wurde gerade gedraftet.',

  // §9.1 queue engine, redraft and tokens
  POOL_NOT_FOUND: 'Draft nicht gefunden.',
  POOL_ENGINE_LEGACY: 'Dieser Draft läuft noch über die alte Engine.',
  POOL_ENGINE_LEGACY_EPB:
    'Point-Buy-Ligen draften nur mit der aktuellen Draft-Engine, deshalb kann dieser alte Draft weder starten noch Picks annehmen. Wurden daraus keine Teams gedraftet und hängt kein Redraft daran, kann ein Liga-Admin ihn auf ausstehend zurücksetzen, löschen und einen neuen anlegen. Beim Löschen gehen auch alle seine Picks verloren.',
  LIST_NOT_FOUND: 'Point-Buy-Liste nicht gefunden.',
  ACTOR_NOT_ALLOWED: 'Du kannst nur für dich selbst handeln.',
  OVERRIDE_REASON_REQUIRED: 'Für einen Admin-Eingriff brauchst du eine Begründung.',
  DRAFT_NOT_ACTIVE: 'Der Draft läuft gerade nicht.',
  DRAFT_NOT_STARTED: 'Der Draft hat noch nicht begonnen.',
  DRAFT_ALREADY_STARTED: 'Diese Einstellung lässt sich nach dem Start nicht mehr ändern.',
  SUBMISSION_PHASE: 'Der Redraft ist noch in der Abgabephase.',
  DRAFT_PAUSED: 'Der Draft ist pausiert.',
  ALREADY_PAUSED: 'Der Draft ist bereits pausiert.',
  NOT_PAUSED: 'Der Draft ist nicht pausiert.',
  BLOCKED_SLOT_UNRESOLVED: 'Löse zuerst den blockierten Pick, bevor du fortsetzt.',
  STALE_SLOT: 'Dieser Pick ist nicht mehr aktuell – der Draft ist schon weiter.',
  NOT_PARTICIPANT: 'Du nimmst an diesem Draft nicht teil.',
  SLOT_BLOCKED: 'Dieser Pick ist blockiert und wartet auf einen Admin.',
  SLOT_NOT_BLOCKED: 'Dieser Pick ist nicht blockiert.',
  NOT_IN_LIST: 'Diese Linie steht nicht in der Point-Buy-Liste der Liga.',
  OWN_REDRAFT_DROP: 'Du hast diese Linie in diesem Redraft abgegeben und kannst sie nicht erneut picken.',
  LINE_RESTRICTED: 'Diese Linie ist für dich gesperrt.',
  COSMOG_REDRAFT_LOCKED: 'Diese Linie kann im Redraft nicht gepickt werden.',
  ROSTER_FULL: 'Dein Kader ist voll ({size} Linien).',
  BUDGET_INFEASIBLE:
    'Nicht draftbar – nach diesem Pick fehlen dir mindestens {shortfall} Punkte, um deine letzten {slots} Kaderplätze zu füllen.',
  NOT_ENOUGH_LINES: 'Nicht draftbar – für deine letzten {slots} Kaderplätze sind nur noch {available} Linien übrig.',
  POOL_NOT_COMPLETABLE: 'Nicht möglich – danach könnten nicht mehr alle Spieler ihren Kader im Budget füllen.',
  POOL_CHECK_LIMIT:
    'Das ließ sich nicht rechtzeitig gegen alle Kader prüfen und wurde daher nicht übernommen. Wähle eine andere Linie oder wende dich an einen Admin.',
  LEAGUE_NOT_COMPLETABLE:
    'Der Draft kann nicht starten: Die {lines} Linien der Liste reichen nicht, um alle {slots} Kaderplätze der {participants} Spieler im Budget zu füllen. Teile die Teilnehmer im Tab Teilnehmer in kleinere Gruppen auf, damit jede Gruppe ihren eigenen Draft hat.',
  REDRAFT_NOT_COMPLETABLE:
    'Der Redraft kann nicht veröffentlicht werden: Die {lines} freien Linien reichen nicht, um alle {slots} Redraft-Plätze im Budget zu füllen. Verschiebe die Abgabefrist, damit die Spieler ihre Abgaben ändern können.',
  DRAFT_ABORT_NOT_ALLOWED:
    'Ein laufender Redraft lässt sich nicht abbrechen. Pausiere ihn und korrigiere Picks oder nimm Abgaben zurück.',
  REDRAFT_SLOT_REQUIRED: 'Wähle, welchen Redraft-Platz dieser Pick füllt.',
  REDRAFT_SLOT_INVALID: 'Dieser Redraft-Platz gehört nicht dir.',
  REDRAFT_SLOT_FILLED: 'Dieser Redraft-Platz ist bereits belegt.',
  REQUEST_ID_REUSED: 'Diese Anfrage-ID wurde schon für einen anderen Pick verwendet.',
  EXTENSION_NOT_ALLOWED: 'In diesem Draft gibt es keine Verlängerungen.',
  EXTENSION_USED: 'Diese Verlängerung hast du schon genutzt.',
  PICK_NOT_FOUND: 'Pick nicht gefunden.',
  PICK_ALREADY_VOIDED: 'Dieser Pick wurde bereits annulliert.',
  CORRECTION_REQUIRES_PAUSE: 'Pausiere den Draft, bevor du Picks korrigierst.',
  VOID_BLOCKED_PROGRESS:
    'Diese Linie hat bereits Entwicklungsfortschritt ({progress}); korrigiere stattdessen den Fortschritt.',
  USE_VOID_PICK: 'Nutze in diesem Draft „Pick annullieren“.',
  SUBMISSION_LOCKED: 'Nach der Frist ist die Redraft-Abgabe gesperrt.',
  REDRAFT_MAX_EXCEEDED: 'Du kannst höchstens {max} Linien abgeben.',
  REDRAFT_MAX_BELOW_SUBMISSIONS:
    'Ein Spieler hat bereits {count} Linien zum Abgeben gewählt. Das Maximum kann nicht niedriger sein.',
  TRACKER_NOT_OWNED: 'Diese Linie ist nicht in deinem Kader.',
  TRACKER_NOT_FOUND: 'Für {pokemon} gibt es in diesem Kader keine Linie.',
  LINE_NOT_DROPPABLE: 'Diese Linie kann im Redraft nicht abgegeben werden.',
  SUBMISSIONS_NOT_DUE: 'Die Abgaben können erst zur Frist veröffentlicht werden.',
  SUBMISSIONS_ALREADY_PUBLISHED: 'Die Abgaben sind bereits veröffentlicht.',
  REDRAFT_NOT_YET_ALLOWED: 'Die Hinrunde ist noch nicht abgeschlossen.',
  INITIAL_DRAFT_NOT_COMPLETE: 'Der Initial-Draft ist noch nicht abgeschlossen.',
  RESTORE_WOULD_OVERDRAW: 'Wenn du diese Abgabe zurücknimmst, überzieht der Spieler sein Budget.',
  POOL_EXISTS: 'Für diese Saison gibt es bereits einen Draft dieser Art.',
  POOL_NOT_DELETABLE:
    'Ein Draft lässt sich nur vor dem Start oder nach dem Abbruch löschen. Brich ihn zuerst ab.',
  POOL_HAS_REDRAFT: 'An diesem Draft hängt ein Redraft. Lösch zuerst den Redraft.',
  POOL_HAS_TEAMS:
    'Aus diesem Draft wurden Teams gedraftet, deshalb lässt er sich nicht löschen. Er bleibt als Nachweis dieser Teams erhalten.',
  SEASON_HAS_NO_LIST: 'Diese Liga hat keine verknüpfte Point-Buy-Liste.',
  SEASON_GROUP_REQUIRED: 'Diese Liga hat Gruppen: Leg den Draft für eine ihrer Gruppen an.',
  SEASON_GROUP_INVALID: 'Diese Gruppe gehört nicht zu dieser Liga.',
  SEASON_GROUP_LOCKED:
    'Die Gruppen lassen sich nicht ändern, solange eine Gruppe einen Draft hat. Einen Draft, der noch nicht gestartet ist, kannst du in seiner Draft-Steuerung löschen; danach lassen sich die Gruppen wieder ändern. Ein gestarteter Draft muss zuerst abgebrochen werden.',
  SEASON_GROUPS_AFTER_DRAFT:
    'Diese Liga hat schon ohne Gruppen gedraftet. Gruppen lassen sich nur vor dem ersten Draft einrichten.',
  SEASON_GROUP_MEMBERS_INVALID: 'Jedes Gruppenmitglied muss an dieser Liga teilnehmen und in genau einer Gruppe sein.',
  SEASON_GROUP_IN_USE:
    'Ein Draft, eine Phase oder gedraftete Linien nutzen diese Gruppe noch, deshalb lässt sie sich nicht entfernen.',
  SEASON_GROUPS_SCHEDULED:
    'Diese Liga hat schon Runden, deshalb lassen sich ihre Gruppen nicht mehr ändern: Spielplan, Gruppentabellen und Draft-Reihenfolge bauen auf ihnen auf. Umbenennen geht weiterhin.',
  SEASON_GROUP_TOO_SMALL: 'Jede Gruppe braucht mindestens zwei Trainer.',
  SEASON_GROUP_SUBSTITUTION_LOCKED:
    'Die Gruppe dieses Trainers hat einen laufenden Draft (Redraft-Abgaben oder Picks), deshalb lässt er sich erst ersetzen, wenn dieser Draft abgeschlossen oder abgebrochen ist.',
  SEASON_GROUP_SEATS_STALE:
    'Die Trainer dieser Gruppe haben sich seit dem Einrichten des Drafts geändert, deshalb passen seine Plätze nicht mehr zur Gruppe. Lösche den Draft, der noch nicht gestartet ist, und lege ihn neu an.',
  SEATS_INVALID: 'Die Draft-Reihenfolge ist ungültig.',
  INVALID_CONFIG: 'Ungültige Einstellung: {field}.',
  TOKEN_WINDOW_CLOSED: 'Draft-Kill-Tokens kannst du gerade nicht kaufen.',
  TOKEN_PLAYER_LIMIT: 'Das würde dein Limit von {max} Draft-Kill-Tokens überschreiten.',
  TOKEN_LINE_LIMIT: 'Diese Linie hat bereits ein Draft-Kill-Token.',
  TOKEN_POINTS_SHORT: 'Du brauchst {needed} freie Punkte ({remaining} übrig).',
  TOKEN_WOULD_EVOLVE:
    'Ein Draft-Kill-Token kann keine Entwicklung auslösen (Fortschritt {progress}, nächste Stufe bei {next}).',
  LINE_FULLY_EVOLVED: 'Diese Linie ist voll entwickelt.',
  COMEBACK_NOT_YET: 'Comeback-Tokens kannst du erst nach dem Redraft einsetzen.',
  COMEBACK_BALANCE_SHORT: 'Du hast nur {balance} Comeback-Tokens.',
  COMEBACK_TOKENS_NOT_MULTIPLE: 'Auf dieser Linie setzt du Comeback-Tokens in Schritten von {ratio} ein (je 1 Fortschritt).',
  FAVORITES_LIMIT: 'Du kannst höchstens {max} Favoriten speichern.',
  ENDPOINT_REPLACED: 'Dieser Endpunkt wurde ersetzt.',
  REDRAFT_TRADE_RETIRED: 'Trades wurden abgeschafft. Linien wechseln nur noch über den Redraft mit verdeckter Abgabe.',

  // §9.2 legacy api/drafts/** branches
  POINT_BUDGET_REQUIRED: 'Für Auktions- und Budget-Drafts ist ein Punktebudget nötig.',
  NOT_IN_POOL: '{pokemon} ist nicht im Draft-Pool.',
  TIER_LIMIT_REACHED: 'Limit für Tier {tier} erreicht (max. {max}).',
  PICK_CAP_REACHED: 'Pick-Limit erreicht ({max} Linien pro Trainer).',
  POINTS_CAP_EXCEEDED: 'Nicht genug Punkte: Du würdest {spend}/{budget} ausgeben ({price} für diese Linie).',
  REPLAY_PICK_EVENTS_AUTO: 'Pick-Ereignisse werden automatisch erzeugt. Nutze stattdessen POST /api/drafts/[id]/picks.',
  INVALID_INCLUDE: 'include muss einer dieser Werte sein: {allowed}',
  UNDO_NOT_ACTIVE: 'Picks lassen sich nur in einem laufenden Draft zurücknehmen.',
  INVALID_PICK_ID: 'Pick nicht gefunden.',
  INVALID_REDRAFT_SLOT_ID: 'Redraft-Platz nicht gefunden.',
});
