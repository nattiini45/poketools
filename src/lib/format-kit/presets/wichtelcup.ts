/**
 * Example format: the Wichtelcup (a Secret Santa cup). Four weekly Swiss rounds; before the first round every player
 * chooses two junk gifts and one premium gift for the recipient they were drawn for, and each week the team check
 * lets a player bring only the normal pool, their OWN gifts and (in week 4) the New Year pool.
 *
 * Nothing in the engine knows the word Wichtelcup: the pools are domains, the gifts are resource items held by the
 * recipient, the Secret Santa is a derangement relation, the gift form is a player action and the weekly obligations
 * are `count` constraints gated on the round. The species tables are transcribed once, in
 * `@/lib/pkmn/preset-data/wichtelcup` (dex-free, no imports), and mapped to dex ids here.
 *
 * Two layers share the work. The format (this document) owns what differs per player and per week. The pinned rule
 * preset `gen9natdexwichtelcup` owns the exact-forme species allowlist, the item and ability bans, the Species Clause,
 * the Item Clause and the levels. Legality is expressed with `when` on `round`, never with the unlock flag of a domain,
 * so a late audit of a week-1 team does not see the New Year pool as open.
 */
import {
  WICHTELCUP_JUNK,
  WICHTELCUP_JUNK_ROLES,
  WICHTELCUP_NEW_YEAR,
  WICHTELCUP_NORMAL,
  WICHTELCUP_PREMIUM,
} from '@/lib/pkmn/preset-data/wichtelcup';
import { toID } from '@/lib/pkmn/i18n/id';
import { ltext } from '@/lib/studio-core/ltext';
import type { Expr } from '../expr/ast';
import type { DomainDef, DomainEntry, FormatDefinition, TeamConstraint } from '../types';

const entries = (names: readonly string[]): DomainEntry[] => names.map((name) => ({ id: toID(name), attrs: [] }));

const junkEntries = (): DomainEntry[] =>
  WICHTELCUP_JUNK.map((name) => ({ id: toID(name), attrs: [{ key: 'primary_role', value: WICHTELCUP_JUNK_ROLES[name] }] }));

const domains: DomainDef[] = [
  {
    key: 'normal',
    label: ltext('en', 'Normal pool', 'Normaler Pool'),
    entries: entries(WICHTELCUP_NORMAL),
    initially: 'unlocked',
    visibility: 'public',
  },
  {
    key: 'junk',
    label: ltext('en', 'Junk gift pool', 'Schrottgeschenke-Pool'),
    entries: junkEntries(),
    initially: 'unlocked',
    visibility: 'public',
  },
  {
    key: 'premium',
    label: ltext('en', 'Premium gift pool', 'Premiumgeschenke-Pool'),
    entries: entries(WICHTELCUP_PREMIUM),
    initially: 'unlocked',
    visibility: 'public',
  },
  {
    key: 'new_year',
    label: ltext('en', "New Year's pool", 'Silvester-Pool'),
    entries: entries(WICHTELCUP_NEW_YEAR),
    initially: 'locked',
    visibility: 'public',
  },
];

/** `round` of the team check. Inequalities, not `== 4`, so a tiebreak round after week 4 follows the week 4 rules. */
const round: Expr = { k: 'ref', name: 'round', t: 'number' };
const roundIs = (op: '==' | '<=' | '>=', n: number): Expr => ({ k: 'cmp', op, a: round, b: { k: 'num', v: n } });
const weeks2To3: Expr = { k: 'and', args: [roundIs('>=', 2), roundIs('<=', 3)] };

const junkGifts = { kind: 'resource', resource: 'junk_gifts' } as const;
const premiumGift = { kind: 'resource', resource: 'premium_gift' } as const;
const newYear = { kind: 'domain', domain: 'new_year', unlocked_only: false } as const;

const constraints: TeamConstraint[] = [
  // Exactly six Pokémon, no Terastallization.
  { kind: 'roster_size', min: 6, max: 6 },
  { kind: 'tera', mode: 'banned' },
  // The allowlist: the normal pool, the player's OWN gifts and the New Year pool; everything else is outside it.
  {
    kind: 'count',
    source: { kind: 'not', source: { kind: 'any_of', sources: [{ kind: 'domain', domain: 'normal', unlocked_only: false }, junkGifts, premiumGift, newYear] } },
    max: 0,
  },
  // Week 1: exactly one of the two junk gifts, no premium gift yet.
  { kind: 'count', source: junkGifts, min: 1, max: 1, when: roundIs('==', 1) },
  // Weeks 2 and 3: both junk gifts.
  { kind: 'count', source: junkGifts, min: 2, max: 2, when: weeks2To3 },
  // Weeks 1 and 2: the premium gift is not available yet. From week 3 on it is mandatory (and stays so in week 4).
  { kind: 'count', source: premiumGift, max: 0, when: roundIs('<=', 2) },
  { kind: 'count', source: premiumGift, min: 1, when: roundIs('>=', 3) },
  // The New Year pool is closed until week 4, then at most two of its Pokémon fit in one team.
  { kind: 'count', source: newYear, max: 0, when: roundIs('<=', 3) },
  { kind: 'count', source: newYear, max: 2, when: roundIs('>=', 4) },
];

export const wichtelcup: FormatDefinition = {
  schema_version: 1,
  identity: {
    name: ltext('en', 'Wichtelcup', 'Wichtelcup'),
    summary: ltext(
      'en',
      'A four-week Secret Santa cup: every player gifts three Pokémon to another player, and the gifts decide which team you may bring each week.',
      'Ein vierwöchiger Wichtel-Cup: Jeder beschenkt einen anderen Spieler mit drei Pokémon, und die Geschenke bestimmen, welches Team du in welcher Woche spielen darfst.',
    ),
  },
  stages: [
    {
      key: 'cup',
      name: ltext('en', 'Cup', 'Cup'),
      participants: { from: 'roster', seeding: 'random' },
      pairing: { kind: 'swiss', rounds: 4, avoid_repeats: true },
      series: { best_of: 1, allow_draw: false, overrides: [] },
      ruleset: { kind: 'preset', preset: 'gen9natdexwichtelcup' },
      doubles: false,
      players_per_match: 2,
      scoring: {
        win: 30,
        loss: 10,
        bye: 0,
        per_opponent_faint: 1,
        forfeit: { win: 30, loss: 0, faint_bonus: false },
      },
      rank: [
        { kind: 'metric', metric: 'points', direction: 'desc' },
        { kind: 'decision_match' },
      ],
      columns: ['points', 'wins', 'losses', 'faints_dealt'],
      constraints,
      calendar: {
        start: { kind: 'season_start' },
        time: '18:00',
        cadence: 'weekly',
        every: 1,
        round_window_hours: 168,
        marks: [
          { key: 'gifts_open', round: 1, offset_hours: -336 },
          { key: 'gifts_close', round: 1, offset_hours: -12 },
          { key: 'week4', round: 4, offset_hours: 0 },
        ],
        deadlines: [
          { applies: 'action', action: 'choose_gifts', offset_hours: 0, on_miss: 'admin_review' },
          { applies: 'team', offset_hours: -24, on_miss: 'admin_review' },
          { applies: 'match', offset_hours: 0, on_miss: 'admin_review' },
        ],
      },
      end_when: { kind: 'rounds', rounds: 4 },
    },
  ],
  edges: [],
  views: [],
  attributes: [
    {
      key: 'primary_role',
      label: ltext('en', 'Primary role', 'Hauptrolle'),
      on: 'entry',
      type: 'enum',
      values: ['hazard_removal', 'hazard_setter', 'wall_stall', 'support', 'weather_setter', 'attacker'],
    },
  ],
  domains,
  relations: [
    {
      key: 'santa',
      label: ltext('en', 'Secret Santa', 'Wichtel'),
      shape: 'derangement',
      visibility: { from: 'hidden', to: 'own' },
      reveal_on: { event: 'time', mark: 'week4' },
    },
  ],
  resources: [
    {
      key: 'junk_gifts',
      label: ltext('en', 'Junk gifts', 'Schrottgeschenke'),
      holds: { kind: 'domain', domain: 'junk' },
      capacity: 2,
      visibility: 'own',
      exclusive: 'none',
    },
    {
      key: 'premium_gift',
      label: ltext('en', 'Premium gift', 'Premiumgeschenk'),
      holds: { kind: 'domain', domain: 'premium' },
      capacity: 1,
      visibility: 'own',
      exclusive: 'global',
    },
  ],
  rules: [
    {
      kind: 'rule.on_event',
      id: 'gifts_open_note',
      on: { event: 'time', mark: 'gifts_open' },
      effects: [
        {
          effect: 'notify',
          message: ltext(
            'en',
            'Gift selection is open. Choose two junk gifts with different roles and one premium gift for your recipient.',
            'Die Geschenkauswahl ist geöffnet. Wähle zwei Schrottgeschenke mit verschiedenen Rollen und ein Premiumgeschenk für deinen Beschenkten.',
          ),
          to: { who: 'all' },
        },
      ],
    },
    {
      kind: 'rule.on_event',
      id: 'week4_unlock',
      on: { event: 'time', mark: 'week4' },
      effects: [
        { effect: 'unlock_domain', domain: 'new_year' },
        {
          effect: 'notify',
          message: ltext(
            'en',
            'We go out with a bang! The New Year pool is open and the Secret Santas are revealed.',
            'Wir gehen mit einem Knall! Der Silvester-Pool ist offen und die Wichtel werden enthüllt.',
          ),
          to: { who: 'all' },
        },
      ],
    },
    {
      kind: 'player.action',
      id: 'choose_gifts',
      label: ltext('en', 'Choose gifts', 'Geschenke wählen'),
      via: 'santa',
      window: {
        opens_on: { event: 'time', mark: 'gifts_open' },
        closes_on: { event: 'time', mark: 'gifts_close' },
      },
      steps: [
        { resource: 'junk_gifts', domain: 'junk', count: 2, distinct_attr: 'primary_role' },
        { resource: 'premium_gift', domain: 'premium', count: 1 },
      ],
      lock: 'on_submit',
    },
    { kind: 'check.assisted', id: 'tied_standings', source: { kind: 'standings_tie', stage: 'cup' } },
    { kind: 'check.assisted', id: 'unresolved_result', source: { kind: 'unresolved_outcome' } },
    { kind: 'check.assisted', id: 'repeat_pairing', source: { kind: 'pairing_rematch', stage: 'cup' } },
    {
      kind: 'adjust.manual',
      id: 'organizer_tools',
      allow: ['points', 'resource', 'relation', 'outcome', 'action', 'domain', 'rank'],
    },
    {
      kind: 'rule.custom',
      id: 'tiebreak_matches',
      text: ltext(
        'en',
        'Ties in the standings are settled by extra matches that the organizer arranges; the procedure for three or more tied players is decided by the organizer.',
        'Gleichstände in der Tabelle werden durch Zusatzspiele entschieden, die der Organisator ansetzt; das Verfahren bei drei oder mehr punktgleichen Spielern legt der Organisator fest.',
      ),
      scope: { kind: 'season' },
      verify: 'admin_checklist',
      when: 'once',
      visible_to_players: true,
    },
    {
      kind: 'rule.custom',
      id: 'new_year_levels',
      text: ltext(
        'en',
        'The level limits of the New Year week are set by the organizer in the ruleset of this league and apply only once approved.',
        'Die Level-Grenzen der Silvesterwoche legt der Organisator im Regelwerk dieser Liga fest; sie gelten erst nach der Freigabe.',
      ),
      scope: { kind: 'season' },
      verify: 'admin_checklist',
      when: 'once',
      visible_to_players: true,
    },
    {
      kind: 'rule.custom',
      id: 'junk_roles_confirmed',
      text: ltext(
        'en',
        'The organizer confirms the primary role of every junk gift species before the gift window opens.',
        'Der Organisator bestätigt die Hauptrolle jeder Schrottgeschenk-Spezies, bevor das Geschenkfenster öffnet.',
      ),
      scope: { kind: 'season' },
      verify: 'admin_checklist',
      when: 'once',
      visible_to_players: true,
    },
    {
      kind: 'rule.custom',
      id: 'dropouts_and_substitutes',
      text: ltext(
        'en',
        'If a player drops out after the draw, the organizer re-grants their gifts to the recipient by a logged correction; the Secret Santa links themselves are not redrawn.',
        'Steigt ein Spieler nach der Auslosung aus, vergibt der Organisator dessen Geschenke per protokollierter Korrektur neu an den Beschenkten; die Wichtel-Zuordnung selbst wird nicht neu gelost.',
      ),
      scope: { kind: 'season' },
      verify: 'admin_checklist',
      when: 'once',
      visible_to_players: true,
    },
  ],
  text: {
    sections: [
      {
        id: 'overview',
        title: ltext('en', 'How the Wichtelcup works', 'So funktioniert der Wichtelcup'),
        body: ltext(
          'en',
          'A small field plays four weekly Swiss rounds, one best-of-one match per player per week, six against six. A win is worth 30 points, a loss 10, and every fainted opposing Pokémon adds 1 point. Everyone gives three Pokémon to one other player (the Secret Santa) and receives three from another one. What you may bring in a week depends on those gifts. Terastallization is not allowed.',
          'Ein kleines Feld spielt vier wöchentliche Schweizer Runden, pro Woche ein Match im Best-of-One, sechs gegen sechs. Ein Sieg zählt 30 Punkte, eine Niederlage 10, und jedes besiegte gegnerische Pokémon bringt 1 Punkt. Jeder schenkt einem anderen Spieler drei Pokémon (der Wichtel) und bekommt drei von einem anderen. Was du in einer Woche mitbringen darfst, hängt von diesen Geschenken ab. Terakristallisierung ist nicht erlaubt.',
        ),
      },
      {
        id: 'secret_santa',
        title: ltext('en', 'Secret Santa and gifts', 'Wichteln und Geschenke'),
        body: ltext(
          'en',
          'Before the cup starts the organizer draws the Secret Santa: every player gives to exactly one other player and receives from exactly one other player. The draw is one single cycle over all players, so nobody gifts themselves and nobody gifts the player who gifts them. Each giver first chooses two junk gifts with different primary roles, then one premium gift, reviews the choice and confirms it; after the confirmation it is locked. Junk gifts may be chosen by several givers, a premium Pokémon is reserved for one giver only, first come first served at the final confirmation. You see which Pokémon you received but not who sent them; the givers are revealed at the start of week 4. All gifts must be confirmed before the first round. Corrections by the organizer are explicit and logged.',
          'Vor dem Start des Cups lost der Organisator die Wichtel aus: Jeder Spieler beschenkt genau einen anderen Spieler und wird von genau einem anderen beschenkt. Die Auslosung ist ein einziger Zyklus über alle Spieler, also beschenkt niemand sich selbst und niemand den Spieler, der ihn selbst beschenkt. Jeder Schenkende wählt zuerst zwei Schrottgeschenke mit verschiedenen Hauptrollen, dann ein Premiumgeschenk, prüft die Auswahl und bestätigt sie; nach der Bestätigung ist sie gesperrt. Schrottgeschenke dürfen von mehreren Schenkenden gewählt werden, ein Premium-Pokémon wird nur für einen Schenkenden reserviert, wer zuerst endgültig bestätigt, bekommt es. Du siehst, welche Pokémon du bekommen hast, aber nicht von wem; die Schenkenden werden zu Beginn von Woche 4 enthüllt. Alle Geschenke müssen vor der ersten Runde bestätigt sein. Korrekturen durch den Organisator sind ausdrücklich und werden protokolliert.',
        ),
      },
      {
        id: 'weekly_requirements',
        title: ltext('en', 'What you bring each week', 'Was du jede Woche mitbringst'),
        body: ltext(
          'en',
          'Every match uses exactly six Pokémon. Week 1: exactly one of your two junk gifts, the rest from the normal pool; the premium gift is not available yet. Week 2: both junk gifts, the rest from the normal pool. Week 3: both junk gifts and the premium gift, the rest from the normal pool. Week 4: the premium gift stays mandatory, the junk gifts become optional, and up to two Pokémon of the New Year pool may be added. A Pokémon may only be used if it is in the normal pool, one of your own gifts or, in week 4, the New Year pool. A gift is not available to other players. The Species Clause and the Item Clause apply every week. The league rule check runs in the team builder and again after the match.',
          'Jedes Match verwendet genau sechs Pokémon. Woche 1: genau eines deiner beiden Schrottgeschenke, der Rest aus dem normalen Pool; das Premiumgeschenk ist noch nicht verfügbar. Woche 2: beide Schrottgeschenke, der Rest aus dem normalen Pool. Woche 3: beide Schrottgeschenke und das Premiumgeschenk, der Rest aus dem normalen Pool. Woche 4: Das Premiumgeschenk bleibt Pflicht, die Schrottgeschenke werden optional, und bis zu zwei Pokémon des Silvester-Pools dürfen dazukommen. Ein Pokémon darf nur verwendet werden, wenn es im normalen Pool steht, eines deiner eigenen Geschenke ist oder in Woche 4 im Silvester-Pool steht. Ein Geschenk steht anderen Spielern nicht zur Verfügung. Spezies-Klausel und Item-Klausel gelten jede Woche. Die Prüfung der Ligaregeln läuft im Teambuilder und noch einmal nach dem Match.',
        ),
      },
      {
        id: 'new_year_pool',
        title: ltext('en', "The New Year's pool", 'Der Silvester-Pool'),
        body: ltext(
          'en',
          "The New Year's pool opens at the start of week 4 (We go out with a bang!). It is shared and not exclusive: different players may use the same species. At most two of its Pokémon fit in one team; zero, one or two are fine. The pool is visible from the start but locked, and the team check refuses it in weeks 1 to 3.",
          'Der Silvester-Pool öffnet sich zu Beginn von Woche 4 (Wir gehen mit einem Knall!). Er wird von allen geteilt und ist nicht exklusiv: Verschiedene Spieler dürfen dieselbe Spezies verwenden. Höchstens zwei seiner Pokémon passen in ein Team; keins, eins oder zwei sind in Ordnung. Der Pool ist von Anfang an sichtbar, aber gesperrt, und die Teamprüfung lehnt ihn in den Wochen 1 bis 3 ab.',
        ),
      },
      {
        id: 'scoring',
        title: ltext('en', 'Points', 'Punkte'),
        body: ltext(
          'en',
          'A win gives 30 points, a loss 10, plus 1 point for every opposing Pokémon that faints, whatever the cause (recoil, hazards, poison and weather count). A no-show, concession or forfeit gives the winner 30 and the other player 0, and no faint points for either side. A tie in the standings is settled by extra matches arranged by the organizer, not by a tiebreak formula.',
          'Ein Sieg gibt 30 Punkte, eine Niederlage 10, dazu 1 Punkt für jedes gegnerische Pokémon, das besiegt wird, egal wodurch (Rückstoß, Fallen, Gift und Wetter zählen). Ein Nichtantreten, eine Aufgabe oder eine Niederlage durch Forfeit gibt dem Sieger 30 und dem anderen Spieler 0 Punkte, ohne Besiegt-Punkte für eine der Seiten. Ein Gleichstand in der Tabelle wird durch Zusatzspiele des Organisators entschieden, nicht durch eine Wertungsformel.',
        ),
      },
      {
        id: 'junk_roles',
        title: ltext('en', 'The junk gift roles', 'Die Rollen der Schrottgeschenke'),
        body: ltext(
          'en',
          'Every junk gift Pokémon has exactly one primary role: hazard removal (spinners and defoggers), hazard setter (Stealth Rock, Spikes, Sticky Web), wall or stall (defensive staying power), support (screens, status, disruption), weather setter (automatic or manual weather) or attacker (offense and setup). A giver must choose two junk gifts with different primary roles. The role is a selection tag only: it does not require any move, ability or item in battle.',
          'Jedes Schrottgeschenk-Pokémon hat genau eine Hauptrolle: Fallenentferner (Rapid Spin und Defog), Fallensteller (Stealth Rock, Spikes, Sticky Web), Wall oder Stall (defensive Ausdauer), Support (Schutzwände, Status, Störung), Wettersetzer (automatisches oder manuelles Wetter) oder Angreifer (Offensive und Aufbau). Ein Schenkender muss zwei Schrottgeschenke mit verschiedenen Hauptrollen wählen. Die Rolle ist nur ein Auswahl-Etikett: Sie verlangt keine Attacke, Fähigkeit oder Item im Kampf.',
        ),
      },
      {
        id: 'pinned_ruleset',
        title: ltext('en', 'This format relies on its pinned ruleset', 'Dieses Format stützt sich auf sein festgelegtes Regelwerk'),
        body: ltext(
          'en',
          'The exact list of allowed formes (for Vivillon only the Icy Snow pattern), the banned items and abilities, the Species Clause, the Item Clause and the level limits come from the pinned Wichtelcup rule preset. This format only adds the per-player pools and the weekly gift rules. If you switch the stage to another ruleset, those checks are gone. A break of the ruleset layer (a banned item, a wrong forme) is shown while you build the team, but it is not part of the check after the match: the organizer reviews it by hand.',
          'Die genaue Liste der erlaubten Formen (bei Vivillon nur das Eisschnee-Muster), die gesperrten Items und Fähigkeiten, die Spezies-Klausel, die Item-Klausel und die Level-Grenzen kommen aus dem festgelegten Wichtelcup-Regelwerk. Dieses Format ergänzt nur die Pools je Spieler und die wöchentlichen Geschenkregeln. Wechselst du die Stufe auf ein anderes Regelwerk, entfallen diese Prüfungen. Ein Verstoß gegen das Regelwerk (ein gesperrtes Item, eine falsche Form) wird beim Teambau angezeigt, gehört aber nicht zur Prüfung nach dem Match: Der Organisator prüft ihn von Hand.',
        ),
      },
      {
        id: 'organizer_items',
        title: ltext('en', 'What the organizer handles', 'Was der Organisator übernimmt'),
        body: ltext(
          'en',
          'The organizer draws the Secret Santa once the field is final, confirms the roles of the junk gifts, sets the season start date before attaching this format, switches the league to the format engine, and decides the consequence of an illegal team, a missed gift window, a missed match deadline, a tie of three or more players and a drawn or invalid battle result. Late changes (a dropout, a missing gift) are corrections that are logged with a reason.',
          'Der Organisator lost die Wichtel aus, sobald das Teilnehmerfeld feststeht, bestätigt die Rollen der Schrottgeschenke, legt vor dem Anhängen dieses Formats das Startdatum der Saison fest, schaltet die Liga auf die Format-Engine um und entscheidet über die Folgen eines illegalen Teams, eines verpassten Geschenkfensters, einer verpassten Match-Frist, eines Gleichstands von drei oder mehr Spielern und eines unentschiedenen oder ungültigen Kampfergebnisses. Spätere Änderungen (ein Ausstieg, ein fehlendes Geschenk) sind Korrekturen, die mit Begründung protokolliert werden.',
        ),
      },
    ],
  },
  theme: { world: 'auto' },
  modules: [],
};
