/**
 * Station Card data and placement (fidelity wave 2, seat 2B; D15).
 *
 * Two pure halves, both unit-tested without a DOM:
 *
 *  1. **Digest facts.** `stationDigestFacts(data)` reduces the page-loaded
 *     `WorldRouteData` to the handful of plain, JSON-serializable facts a
 *     Station Card can show at 390 — computed on the SERVER (WorldShell), so
 *     the client never receives the full payload twice. Every fact is read
 *     off the SAME builder the boards paint from (`buildBoardContent`; the
 *     roster count is `deriveRosterTiles`' length, test-pinned): the
 *     digest's standings fact IS row 1 of the painter's table, its schedule
 *     fact IS row 1 of
 *     the SPIELPLAN / FIXTURES page. `formatStationDigest(kind, facts,
 *     locale)` turns one fact into the card line in the VIEWER's language
 *     (`world-route.digest`; i18n D11 — a world has no language of its own).
 *     The facts carry both board date shapes (the sanctioned cache-safe
 *     both-locale precompute, so the server never reads the viewer locale)
 *     and the neutral fixture status keys (`upcoming` / `live` / `done`).
 *     Nothing here names a Pokémon, a type or a stat: team chips carry the
 *     participant's own `gym_type` string through untouched.
 *
 *  2. **Placement.** `placeStationCard(theme, station, viewport, {keepOuts})`
 *     returns the card's screen rect at a station's frozen pose, built on
 *     2A's `portraitBands` / padded face rects (data-surfaces.ts): at ≤ 767 px
 *     the top of the caption band (capped at CARD_BAND_MAX_H / 30 % vh), else
 *     the life band above the HUD; above it, the 360-wide box at a 24 px
 *     inset, a narrow column, the bottom corners, the compact card (kicker +
 *     one digest line + actions), then a free-slot scan down both edges.
 *     Every slot is at least its variant's content height (wave-2 r3: the
 *     64 px compact slot clipped its own CTA). Live keep-outs (projected
 *     subject rects: aces, the focus subject) rank the face-clear slots.
 *     `placeCollapsedPill` places the kicker-only pill at a FOCUS pose, or
 *     yields it (null) when every slot meets a keep-out. LOOK r6 (C1, the
 *     r2–r5 "caption over the Sceptile ace" residual): StationCard now
 *     projects the registered subjects through the live camera once it
 *     rests at the settled station (and again at a landed focus pose for
 *     the pill) and passes `subjectKeepOuts` / `collapsedPillKeepOuts` in —
 *     at plaza #teams 1440 both top corners meet a rear ace, so the top
 *     strip above the crowns wins.
 *
 *  3. **CTA.** `resolveStationCta` — one label table keyed by what the link
 *     opens (CARD_CTA_LABELS); Teams opens the rank-1 trainer's panel.
 *
 * Honest limits:
 *  - Placement is computed for the frozen station pose. Mid-crossing the card
 *    is not shown at all (it keys on the latched `settled`), so no crossing
 *    pose needs a placement.
 *  - The rect is only as clear as 2A's face table is complete: a data face
 *    missing from `<THEME>_DATA_FACES` is invisible to this law.
 *  - The plaza renders only point-buy seasons; with no list bound its roster
 *    fact falls back to the participant count (the themes' tile fallback),
 *    while the plaza kiosk shows its empty state.
 */

import type { ScreenRect } from './evidence-probe';
import {
  DESKTOP_CAPTION,
  HUD_BAND_PX,
  isMobileViewport,
  portraitBands,
  rectClearOfFaces,
  type DataSurfaceTheme,
  type Viewport,
} from './data-surfaces';
import type { ResolvedStationCta, StationCardCopy, StationCardCta, StationDigestKind } from './theme-types';
import { LOCALES, type Locale } from '@/i18n/config';
import { upperForPaint } from '@/i18n/core';
import { routeT } from './paint-copy';
// Type-only: route-data.ts also holds the Supabase fetch fan-out, which must
// never reach the browser bundle (this module is imported by the client card).
import type { WorldRouteData } from '@/lib/worlds/route-data';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { leagueHubCopy } from '@/lib/league-hub/copy';
import type { SeasonFormatType } from '@/types/season';
import {
  buildBoardContent,
  type BoardFixtureStatusKey,
} from '@/components/world/evoliga/route/plaza/board/board-content';

// ── Digest facts ─────────────────────────────────────────────────────────────

/** One trainer chip on the Teams roll-call rail. */
export interface TeamChip {
  /** Participant id — the `?team=<id>` panel key. */
  id: string;
  name: string;
  /** The participant's gym band as stored (a type key), or null. */
  gymType: string | null;
  /** 1-based standings rank; null for a participant with no table row yet. */
  rank: number | null;
  points: number | null;
}

/** Row 1 of the schedule board, with its date in both locales (picked by the viewer's). */
export interface FixtureFact {
  home: string;
  away: string;
  /** Neutral status key; labelled only when the line is written. */
  status: BoardFixtureStatusKey;
  matchday: number;
  date: Record<Locale, string>;
  time: string;
}

/**
 * The facts a Station Card can show. Plain JSON: WorldShell (a server
 * component) builds it and hands it to the client card as a prop.
 */
export interface StationDigestFacts {
  /** Row 1 of the painted table (`BoardContent.table[0]`). */
  standingsTop: { name: string; points: number } | null;
  /** The live match the boards' LIVE pill names (`BoardContent.live`). */
  live: { home: string; away: string } | null;
  /** Row 1 of the schedule page (`BoardContent.upcoming[0]`). */
  nextFixture: FixtureFact | null;
  /** The roster the friezes paint: tile count, and whether tiles are list lines. */
  roster: { count: number; lines: boolean };
  /**
   * The rules fact: the ruleset name, the EPB draft budget, and the league's
   * format (absent or null without a season row), which names the rules when
   * neither of the others can.
   */
  rules: { rulesetName: string | null; draftBudget: number | null; format?: SeasonFormatType | null };
  /** Every participant, in standings order (the roll-call rail). */
  teams: TeamChip[];
}

export const EMPTY_DIGEST_FACTS: StationDigestFacts = {
  standingsTop: null,
  live: null,
  nextFixture: null,
  roster: { count: 0, lines: false },
  rules: { rulesetName: null, draftBudget: null },
  teams: [],
};

/**
 * Participants in standings order: the table's first row per player sets the
 * rank (the same "first row wins" rule the team panels use), players without
 * a table row follow in participant order. The rail and the ledger agree on
 * this order (D16: teams order is the data order).
 */
export function teamChipsInStandingsOrder(
  participants: WorldRouteData['participants'],
  standings: WorldRouteData['standings'],
): TeamChip[] {
  const rankOf = new Map<string, { rank: number; points: number }>();
  standings.forEach((row, index) => {
    if (!rankOf.has(row.player_id)) rankOf.set(row.player_id, { rank: index + 1, points: row.points });
  });
  const chips = participants.map((participant, order) => {
    const standing = rankOf.get(participant.id) ?? null;
    return {
      order,
      chip: {
        id: participant.id,
        name: participant.name,
        gymType: participant.gym_type ?? null,
        rank: standing?.rank ?? null,
        points: standing?.points ?? null,
      },
    };
  });
  chips.sort((a, b) => {
    const ra = a.chip.rank ?? Number.POSITIVE_INFINITY;
    const rb = b.chip.rank ?? Number.POSITIVE_INFINITY;
    return ra !== rb ? ra - rb : a.order - b.order;
  });
  return chips.map((entry) => entry.chip);
}

/**
 * Reduce the route payload to the card's facts. Pure; server-safe. A payload
 * without a season row has no boards, so it yields the empty facts.
 */
export function stationDigestFacts(data: WorldRouteData): StationDigestFacts {
  const { league } = data;
  if (!league) return { ...EMPTY_DIGEST_FACTS, teams: teamChipsInStandingsOrder(data.participants, data.standings) };
  // The boards' own view of the contract (the evoliga adapter's mapping; the
  // adapter itself lives in a 'use client' module).
  const view = {
    league,
    stages: data.stages,
    participants: data.participants,
    entries: data.rosterLines ?? [],
    trackers: data.trackers,
    standings: data.standings,
    fixtures: data.fixtures,
    formatRules: data.formatRules,
    hasDraftPool: data.hasDraftPool,
  };
  // Both locales' date shapes (cache-safe: no viewer read on the server);
  // the client card picks the viewer's.
  const de = buildBoardContent(view, 'de');
  const en = buildBoardContent(view, 'en');
  const top = de.table[0] ?? null;
  const fixtureDe = de.upcoming[0] ?? null;
  const fixtureEn = en.upcoming[0] ?? null;
  // `deriveRosterTiles(data).length`, without importing route-data's values:
  // list lines when any exist, else one participant tile per trainer (the
  // unit test pins the two against each other).
  const lines = data.rosterLines?.length ?? 0;
  return {
    standingsTop: top ? { name: top.name, points: top.points } : null,
    live: de.live ? { home: de.live.home, away: de.live.away } : null,
    nextFixture:
      fixtureDe && fixtureEn
        ? {
            home: fixtureDe.home,
            away: fixtureDe.away,
            status: fixtureDe.status,
            matchday: fixtureDe.matchday,
            date: { de: fixtureDe.date, en: fixtureEn.date },
            time: fixtureDe.time,
          }
        : null,
    roster: { count: lines > 0 ? lines : data.participants.length, lines: lines > 0 },
    // Only Evolution Point Buy has a draft budget; another format's row is a
    // stale one left by a format change, so it never surfaces here.
    rules: {
      rulesetName: data.rulesetName,
      draftBudget: isEvolutionPointBuy(league.format_type) ? (data.formatRules?.draft_budget ?? null) : null,
      format: league.format_type,
    },
    teams: teamChipsInStandingsOrder(data.participants, data.standings),
  };
}

// ── Card copy ────────────────────────────────────────────────────────────────

const NBSP = ' ';

/** Chrome copy of the card, in one language (`world-route.card`). */
export interface StationCardChrome {
  /** The Lite exit link. */
  readAsText: string;
  /** Accessible name of the card region. */
  regionLabel: string;
  /** Accessible name of the roll-call rail. */
  railLabel: string;
}

/** The card chrome in `locale` (the viewer's). */
export function stationCardChrome(locale: Locale): StationCardChrome {
  const t = routeT(locale);
  return { readAsText: t('card.readAsText'), regionLabel: t('card.regionLabel'), railLabel: t('card.railLabel') };
}

/** Both languages' chrome, keyed by locale (tests and non-React readers). */
export const STATION_CARD_CHROME: Readonly<Record<Locale, StationCardChrome>> = Object.fromEntries(
  LOCALES.map((locale) => [locale, stationCardChrome(locale)]),
) as Record<Locale, StationCardChrome>;

/** The card region's accessible name, `Station: Kaderliste`. */
export function cardRegionName(title: string, locale: Locale): string {
  const t = routeT(locale);
  return t('card.regionName', { region: t('card.regionLabel'), title });
}

/** `2/5 · Kaderliste` — where the visitor is (1-based). */
export function cardKicker(index: number, total: number, title: string, locale: Locale = 'en'): string {
  return routeT(locale)('card.kicker', { index: String(index + 1), total: String(total), title });
}

/** A match pair that never breaks inside a name (board-text `liveMatchPair`). */
function pair(home: string, away: string): string {
  return `${home}${NBSP}vs${NBSP}${away}`;
}

/** `LIVE · A vs B` — the broadcast tag in capitals, as every board letters it. */
function liveLine(home: string, away: string, locale: Locale): string {
  const t = routeT(locale);
  return t('digest.live', { live: upperForPaint(t('digest.liveTag'), locale), pair: pair(home, away) });
}

function fixtureLine(fixture: FixtureFact, locale: Locale): string {
  const t = routeT(locale);
  const matchday = t('digest.matchday', { n: String(fixture.matchday) });
  const teams = pair(fixture.home, fixture.away);
  const { status } = fixture;
  if (status === 'live') return liveLine(fixture.home, fixture.away, locale);
  if (status === 'done') return t('digest.fixtureDone', { matchday, teams });
  const when = fixture.time === '—' ? fixture.date[locale] : `${fixture.date[locale]} ${fixture.time}`;
  return t('digest.fixtureWhen', { matchday, teams, when });
}

/**
 * The single digest line for a station kind, or null when the kind renders
 * something other than a sentence (`teamChips` with trainers to list). Every
 * kind has an honest empty state — a card never shows an empty slot.
 */
export function formatStationDigest(
  kind: StationDigestKind,
  facts: StationDigestFacts,
  locale: Locale,
  options: { rail?: boolean } = {},
): string | null {
  const rail = options.rail ?? true;
  const t = routeT(locale);
  switch (kind) {
    case 'standingsTop':
      return facts.standingsTop
        ? t('digest.standingsTop', { name: facts.standingsTop.name, points: facts.standingsTop.points })
        : t('digest.noStandings');
    case 'liveMatch':
      if (facts.live) return liveLine(facts.live.home, facts.live.away, locale);
      return formatStationDigest('nextKickoff', facts, locale);
    case 'nextKickoff':
      return facts.nextFixture ? fixtureLine(facts.nextFixture, locale) : t('digest.noMatches');
    case 'rosterCount': {
      const n = facts.roster.count;
      if (n === 0) return t('digest.noLines');
      if (facts.roster.lines) return t('digest.linesOnRoster', { count: n });
      return t('digest.trainersOnRoster', { count: n });
    }
    case 'rulesHeadline':
      if (facts.rules.rulesetName) return t('digest.ruleset', { name: facts.rules.rulesetName });
      if (facts.rules.draftBudget !== null) return t('digest.draftBudget', { budget: facts.rules.draftBudget });
      // Off EPB there are no league default rules to name (only EPB has a
      // rulebook of defaults): the format, and the hub Rules tab's own notice
      // (PR #65 test pass, 5B-1 — the card said 'Liga-Standardregeln' while
      // the tab said 'Kein Regelwerk zugewiesen.').
      if (facts.rules.format && !isEvolutionPointBuy(facts.rules.format)) {
        const copy = leagueHubCopy(locale);
        return t('digest.formatNoRuleset', {
          format: copy.formatType[facts.rules.format] ?? facts.rules.format,
          noRuleset: copy.noRuleset.replace(/\.$/, ''),
        });
      }
      return t('digest.leagueDefaults');
    case 'teamChips': {
      const n = facts.teams.length;
      if (n === 0) return t('digest.noTrainers');
      // The phone card lists the trainers as the roll-call rail instead.
      if (rail) return null;
      // Desktop / compact: one sentence — the count and the leader (row 1).
      const lead = facts.teams[0];
      return lead.rank !== null
        ? t('digest.trainerCountLead', { count: n, name: lead.name })
        : t('digest.trainerCount', { count: n });
    }
  }
}

// ── Call to action ───────────────────────────────────────────────────────────

/** What a CTA opens — the key of the one label table. */
export type CardCtaTarget = 'standings' | 'roster' | 'schedule' | 'rules' | 'team';

/**
 * THE label table (wave-2 r3, W1 judge): every CTA label is derived from what
 * the link opens (`world-route.cta.<target>`), in the viewer's locale, so a
 * station can never carry a label for a different panel ("Open the table" on
 * the roster, a standings link on Teams).
 */
export function cardCtaLabel(target: CardCtaTarget, locale: Locale): string {
  return routeT(locale)(`cta.${target}`);
}

const CTA_TARGETS: readonly CardCtaTarget[] = ['standings', 'roster', 'schedule', 'rules', 'team'];

/** Both languages' labels per target (tests and non-React readers). */
export const CARD_CTA_LABELS: Readonly<Record<CardCtaTarget, Readonly<Record<Locale, string>>>> = Object.fromEntries(
  CTA_TARGETS.map((target) => [
    target,
    Object.fromEntries(LOCALES.map((locale) => [locale, cardCtaLabel(target, locale)])) as Record<Locale, string>,
  ]),
) as Record<CardCtaTarget, Record<Locale, string>>;

/** The table key of a CTA target (`board=roster` → roster, `rules=*` → rules, …). */
export function ctaTarget(cta: Pick<StationCardCta, 'param' | 'value'>): CardCtaTarget {
  if (cta.param === 'team') return 'team';
  if (cta.param === 'rules') return 'rules';
  if (cta.param === 'board') {
    if (cta.value === 'roster') return 'roster';
    if (cta.value === 'schedule') return 'schedule';
  }
  return 'standings';
}

/**
 * The card's CTA: the theme's fallback target, except at Teams, where it opens
 * the rank-1 trainer's own panel (`?team=<first standings id>` — the ledger's
 * first column, the same link as the rail's first chip). Label from the table.
 */
export function resolveStationCta(
  card: Pick<StationCardCopy, 'cta' | 'digest'>,
  facts: StationDigestFacts,
  locale: Locale,
): ResolvedStationCta {
  const lead = card.digest === 'teamChips' ? (facts.teams[0] ?? null) : null;
  const target: StationCardCta = lead ? { param: 'team', value: lead.id } : { param: card.cta.param, value: card.cta.value };
  return { ...target, label: cardCtaLabel(ctaTarget(target), locale) };
}

// ── Links ────────────────────────────────────────────────────────────────────

/**
 * The CTA's href: the current query with every docked-panel param dropped
 * (one panel at a time — FocusUrlSync's own rule) and the CTA's param set.
 * Other params (`?tier=route`, `?routeDebug=1`) survive, so the CTA never
 * throws a forced-route session back to auto-detection.
 */
export function panelHref(search: string, panelParams: readonly string[], cta: Pick<StationCardCta, 'param' | 'value'>): string {
  const next = new URLSearchParams(search);
  for (const param of panelParams) next.delete(param);
  next.set(cta.param, cta.value);
  return `?${next.toString()}`;
}

/**
 * The Lite exit: `?tier=lite` (WorldStateProvider's URL override) landing on
 * the same station's section. Panel and route-forcing params are dropped.
 */
export function liteHref(search: string, panelParams: readonly string[], stationId: string): string {
  const next = new URLSearchParams(search);
  for (const param of panelParams) next.delete(param);
  next.delete('routeDebug');
  next.set('tier', 'lite');
  return `?${next.toString()}#${encodeURIComponent(stationId)}`;
}

// ── Placement ────────────────────────────────────────────────────────────────

/** Gap kept between the card and the viewport edge on a phone. */
export const CARD_BAND_INSET_PX = 8;
/**
 * The phone card's slot is capped at its content maximum (kicker + beat +
 * rail or digest + actions ≈ 195–215 px at the 18 px root), never the whole
 * free caption band: a tall sky above the faces must not become a tall box
 * (wave-2 r1 judge: the band rect ran the full frame at 390). Also never more
 * than 30 % of the viewport height, so a short phone keeps the world in view.
 */
export const CARD_BAND_MAX_H = 220;
export const CARD_BAND_MAX_VH = 0.3;
/** Gap kept between the card and the HUD band on desktop. */
export const CARD_HUD_GAP_PX = 8;
/**
 * Slot heights are content maxima at the 18 px root (the box itself is
 * `height: auto` and hugs its content inside them). Rows: padding 27 +
 * border 2, kicker 18, beat 20.25 / line, digest 22.5 / line (clamped to 2),
 * actions 38.25 (one row at 360 wide), gaps 6.75.
 *
 *  - compact: kicker + digest (≤ 2 lines) + actions ≈ 144 → 148. Wave-2 r3
 *    (W1 judge): the old 64 px compact slot clipped its own CTA chips and
 *    had no room for a data line at all.
 *  - full: compact + beat (2 lines) ≈ 191 → 196.
 *  - narrow (240–320 wide): beat 3 lines, digest 2, actions wrapped to two
 *    rows ≈ 236 → 240.
 */
export const CARD_COMPACT_H = 148;
export const CARD_FULL_H = 196;
/** Narrow desktop column: taller box so the beat line can wrap and the actions stack. */
export const CARD_NARROW_H = 240;
export const CARD_NARROW_WIDTHS = [320, 280, 240] as const;
/**
 * The strip: a wide, short compact card (kicker row, then the digest and the
 * actions side by side) for a frame whose only free room is the row above
 * the HUD — sakura's schedule at 1440 leaves ≈ 100 px under a wall of
 * faces. Kicker 18 + gap 6.75 + actions 38.25 + padding/border 29 ≈ 92 → 96.
 */
export const CARD_STRIP_H = 96;
export const CARD_STRIP_WIDTHS = [840, 720] as const;
/** Vertical step of the free-slot scan (desktop edges, phone life band). */
export const CARD_SCAN_STEP_PX = 16;
/** Keep-out padding around a live subject rect (an ace, the focus subject). */
export const SUBJECT_KEEP_OUT_PAD_PX = 8;
/**
 * The collapsed pill (kicker only) — content maxima at the 18 px root, the
 * size `placeCollapsedPill` is asked to place. Height: the collapsed padding
 * (0.5rem × 2) + the kicker line (1rem desktop, 1.125rem phone) + border ≈
 * 38–41 → 44. Width: the longest kicker ("2/5 · KADERLISTE", uppercase
 * 0.75rem bold, 0.06em tracking) + padding ≈ 190 → 240; a longer title
 * ellipsizes inside it (`.world-station-card-kicker`).
 */
export const CARD_PILL_W = 240;
export const CARD_PILL_H = 44;

/**
 * - `band`: the phone card (full width) — the caption band at the top, or
 *   the life band above the HUD when the sky is too short.
 * - `full`: the 360 × CARD_FULL_H desktop box.
 * - `narrow`: a narrower, taller column beside a face.
 * - `compact`: kicker, ONE digest line and the actions (no beat) — the
 *   desktop resort, never shorter than its content.
 * - `strip`: the compact content laid out wide and short (digest beside the
 *   actions) for the row above the HUD.
 */
export type CardVariant = 'band' | 'full' | 'narrow' | 'compact' | 'strip';

export interface CardPlacement {
  /** The rect the card is drawn inside (CSS px, viewport space). */
  rect: ScreenRect;
  variant: CardVariant;
  /** Which edge the card's box hangs from inside `rect`. */
  anchor: 'top' | 'bottom';
  side: 'left' | 'right' | 'full';
  /** True when `rect` meets no padded face and stays out of the HUD band. */
  clear: boolean;
  /**
   * True when `rect` also meets none of the live keep-outs (projected
   * subject rects — aces, the focus subject). When no face-clear slot is
   * also keep-out-clear, the face-clear slot with the least keep-out overlap
   * is returned with this false (the card still states its fact).
   */
  keepOutClear: boolean;
}

export interface CardPlacementOptions {
  /**
   * Live screen rects (viewport CSS px) the card must also avoid: the
   * projected bounds of the scene's focus subjects (aces, boards, the ledger),
   * already padded. The static face table knows only data faces; these are
   * what the camera actually shows around them.
   */
  keepOuts?: readonly ScreenRect[];
}

interface Candidate {
  rect: ScreenRect;
  variant: CardVariant;
  anchor: 'top' | 'bottom';
  side: 'left' | 'right' | 'full';
}

function rectsMeet(a: ScreenRect, b: ScreenRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function overlapArea(a: ScreenRect, b: ScreenRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function keepOutOverlap(rect: ScreenRect, keepOuts: readonly ScreenRect[]): number {
  let sum = 0;
  for (const keepOut of keepOuts) sum += overlapArea(rect, keepOut);
  return sum;
}

function desktopCandidates(viewport: Viewport): Candidate[] {
  const { w, inset } = DESKTOP_CAPTION;
  const W = viewport.width;
  const floor = viewport.height - HUD_BAND_PX - CARD_HUD_GAP_PX;
  const at = (width: number, height: number, side: 'left' | 'right', y: number): ScreenRect => ({
    x: side === 'left' ? inset : W - inset - width,
    y,
    w: width,
    h: height,
  });
  const top = inset;
  const bottom = (height: number) => floor - height;
  const out: Candidate[] = [];
  const sides = ['left', 'right'] as const;
  for (const side of sides)
    out.push({ rect: at(w, CARD_FULL_H, side, top), variant: 'full', anchor: 'top', side });
  for (const width of CARD_NARROW_WIDTHS)
    for (const side of sides)
      out.push({ rect: at(width, CARD_NARROW_H, side, top), variant: 'narrow', anchor: 'top', side });
  for (const side of sides)
    out.push({ rect: at(w, CARD_FULL_H, side, bottom(CARD_FULL_H)), variant: 'full', anchor: 'bottom', side });
  for (const side of sides)
    out.push({ rect: at(w, CARD_COMPACT_H, side, top), variant: 'compact', anchor: 'top', side });
  for (const side of sides)
    out.push({ rect: at(w, CARD_COMPACT_H, side, bottom(CARD_COMPACT_H)), variant: 'compact', anchor: 'bottom', side });
  for (const width of CARD_STRIP_WIDTHS)
    for (const [y, anchor] of [
      [bottom(CARD_STRIP_H), 'bottom'],
      [top, 'top'],
    ] as const)
      out.push({ rect: at(width, CARD_STRIP_H, 'left', y), variant: 'strip', anchor, side: 'left' });
  // Free-slot scan down each edge (wave-2 r3): a corner that meets a face no
  // longer ends the search — the full box, then the compact one, slide down
  // the edge until a clear slot turns up.
  for (const [variant, height] of [
    ['full', CARD_FULL_H],
    ['compact', CARD_COMPACT_H],
  ] as const) {
    for (let y = top + CARD_SCAN_STEP_PX; y + height <= floor; y += CARD_SCAN_STEP_PX)
      for (const side of sides) out.push({ rect: at(w, height, side, y), variant, anchor: 'top', side });
  }
  return out;
}

function insideViewport(rect: ScreenRect, viewport: Viewport): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= viewport.width && rect.y + rect.h <= viewport.height - HUD_BAND_PX;
}

/** Phone slots: the caption band at the top, then the life band above the HUD. */
function phoneCandidates(theme: DataSurfaceTheme, stationIndex: number, viewport: Viewport, keepOuts: readonly ScreenRect[]): Candidate[] {
  const bands = portraitBands(theme, stationIndex, viewport);
  const inset = CARD_BAND_INSET_PX;
  const w = viewport.width - 2 * inset;
  const cap = Math.min(CARD_BAND_MAX_H, Math.floor(CARD_BAND_MAX_VH * viewport.height));
  const out: Candidate[] = [];
  const top = inset;
  const free = Math.max(0, bands.caption.bottom - inset - top);
  const h = Math.min(free, cap);
  // The caption band shrunk above any keep-out that reaches into it.
  let shrunk = h;
  for (const keepOut of keepOuts) {
    if (rectsMeet({ x: inset, y: top, w, h: shrunk }, keepOut)) shrunk = Math.max(0, Math.floor(keepOut.y - inset - top));
  }
  if (shrunk >= CARD_COMPACT_H) out.push({ rect: { x: inset, y: top, w, h: shrunk }, variant: 'band', anchor: 'top', side: 'full' });
  // The life band above the HUD, bottom-anchored (wave-2 r3: a short sky
  // moves the card, never shrinks it under its content).
  const floor = bands.hud.top - inset;
  const lifeFree = Math.max(0, floor - Math.max(bands.life.top + inset, top));
  const lh = Math.min(lifeFree, cap);
  if (lh >= CARD_COMPACT_H) out.push({ rect: { x: inset, y: floor - lh, w, h: lh }, variant: 'band', anchor: 'bottom', side: 'full' });
  // Last: the unshrunk caption band (face-clear; the keep-out rule decides).
  if (h >= CARD_COMPACT_H && shrunk !== h) out.push({ rect: { x: inset, y: top, w, h }, variant: 'band', anchor: 'top', side: 'full' });
  return out;
}

/**
 * Where the Station Card goes at a station's frozen pose. Deterministic in
 * (theme, station, viewport, keep-outs); the component memoizes it.
 *
 * A candidate must be face-clear (2A's padded face table) and inside the
 * frame above the HUD. Among those, the first that also meets no live
 * keep-out wins; failing that, the one with the least keep-out overlap.
 * Every slot is at least its variant's content height — a card never clips
 * its own rows.
 */
export function placeStationCard(
  theme: DataSurfaceTheme,
  stationIndex: number,
  viewport: Viewport,
  options: CardPlacementOptions = {},
): CardPlacement {
  const keepOuts = options.keepOuts ?? [];
  const mobile = isMobileViewport(viewport);
  const candidates = mobile ? phoneCandidates(theme, stationIndex, viewport, keepOuts) : desktopCandidates(viewport);
  let best: { candidate: Candidate; overlap: number } | null = null;
  for (const candidate of candidates) {
    if (!insideViewport(candidate.rect, viewport)) continue;
    if (!rectClearOfFaces(theme, stationIndex, viewport, candidate.rect)) continue;
    const overlap = keepOutOverlap(candidate.rect, keepOuts);
    if (overlap === 0) return { ...candidate, clear: true, keepOutClear: true };
    if (!best || overlap < best.overlap) best = { candidate, overlap };
  }
  if (best) return { ...best.candidate, clear: true, keepOutClear: false };
  // Nothing clear: 2A's least-overlap slot, flagged (the placement test fails
  // on it and the component shows no card rather than chrome over data).
  const bands = portraitBands(theme, stationIndex, viewport);
  const side = mobile ? 'full' : bands.captionSide === 'right' ? 'right' : 'left';
  return { rect: bands.captionRect, variant: mobile ? 'band' : 'full', anchor: 'top', side, clear: false, keepOutClear: false };
}

// ── Collapsed pill (a panel open / a focus running) ──────────────────────────

/**
 * Where the collapsed card — the kicker pill — sits while a docked panel is
 * open or a focus blend runs. The camera is at a FOCUS pose then, not the
 * station pose the card was placed for, so the pill takes the live
 * projected rects (the focus subject, every ace) as keep-outs and searches
 * the top row (its own corner first), then the row above the HUD. Returns
 * null when no slot is clear: the pill yields (hides) rather than covering
 * a face (wave-2 r3: the full-width pill sat on the aces at 390).
 */
export function placeCollapsedPill(
  size: { w: number; h: number },
  viewport: Viewport,
  keepOuts: readonly ScreenRect[],
  prefer: { x: number; y: number } | null = null,
): ScreenRect | null {
  const inset = isMobileViewport(viewport) ? CARD_BAND_INSET_PX : DESKTOP_CAPTION.inset;
  const w = Math.min(size.w, viewport.width - 2 * inset);
  const h = size.h;
  if (w <= 0 || h <= 0) return null;
  const left = inset;
  const right = viewport.width - inset - w;
  const centre = Math.round((viewport.width - w) / 2);
  const topY = inset;
  const bottomY = viewport.height - HUD_BAND_PX - CARD_HUD_GAP_PX - h;
  const points: { x: number; y: number }[] = [];
  if (prefer) points.push({ x: Math.min(Math.max(prefer.x, left), right), y: Math.min(Math.max(prefer.y, topY), bottomY) });
  for (const y of [topY, bottomY]) for (const x of [left, right, centre]) points.push({ x, y });
  for (const point of points) {
    const rect: ScreenRect = { x: point.x, y: point.y, w, h };
    if (rect.y < 0 || rect.y + rect.h > viewport.height - HUD_BAND_PX) continue;
    if (keepOuts.every((keepOut) => !rectsMeet(rect, keepOut))) return rect;
  }
  return null;
}

/** Root font size (globals.css `html { font-size: 18px }`): the rem the panel CSS is written in. */
const ROOT_PX = 18;

/**
 * The most room the docked Focus panel can take (globals.css
 * `.world-focus-panel`), as a keep-out for the collapsed pill: on a phone the
 * bottom sheet (`inset: auto 0.75rem 0.75rem`, `max-height: 46vh`); on wider
 * viewports the right rail (`right: 1rem`, `top: 56px + 1rem`, `width:
 * min(26rem, 100vw − 2rem)`, down to 1rem above the bottom edge). The final
 * geometry, not the element's live box, so a panel still sliding in cannot
 * under-report its extent.
 */
export function dockedPanelRegion(viewport: Viewport): ScreenRect {
  if (isMobileViewport(viewport)) {
    const inset = 0.75 * ROOT_PX;
    const h = 0.46 * viewport.height;
    return { x: inset, y: viewport.height - inset - h, w: viewport.width - 2 * inset, h };
  }
  const edge = ROOT_PX;
  const w = Math.min(26 * ROOT_PX, viewport.width - 2 * edge);
  const top = 56 + edge;
  return { x: viewport.width - edge - w, y: top, w, h: viewport.height - edge - top };
}

/** A focus subject projected through the live camera (viewport CSS px). */
export interface ProjectedSubject {
  id: string;
  kind: string;
  rect: ScreenRect | null;
  onScreenFraction: number;
}

/**
 * The live keep-outs the card and the pill avoid: every on-screen ace (the
 * faces a caption must never sit on — wave-2 r3 `captionOverlaps` 0005 at
 * 390) and the subject being focused, each padded by
 * SUBJECT_KEEP_OUT_PAD_PX. Boards and plaques are already in 2A's static face
 * table; everything else the camera shows is scenery the card may cover.
 */
export function subjectKeepOuts(
  subjects: readonly ProjectedSubject[],
  focusId: string | null,
  pad: number = SUBJECT_KEEP_OUT_PAD_PX,
): ScreenRect[] {
  const out: ScreenRect[] = [];
  for (const subject of subjects) {
    if (!subject.rect || subject.onScreenFraction <= 0) continue;
    if (subject.kind !== 'ace' && subject.id !== focusId) continue;
    const { x, y, w, h } = subject.rect;
    out.push({ x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad });
  }
  return out;
}

/**
 * The collapsed pill's keep-outs at the pose the camera rests in (a focus
 * pose, or the station pose when a panel opened without a focus): the
 * subject keep-outs (every on-screen ace + the focused subject) and, while a
 * panel is docked, the panel's region (`dockedPanelRegion`).
 */
export function collapsedPillKeepOuts(
  subjects: readonly ProjectedSubject[],
  focusId: string | null,
  viewport: Viewport,
  panelOpen: boolean,
): ScreenRect[] {
  const out = subjectKeepOuts(subjects, focusId);
  if (panelOpen) out.push(dockedPanelRegion(viewport));
  return out;
}

/** The pill's preferred top-left: the card's own corner (its anchor edge), so a clear pill stays where the card was. */
export function pillPreferPoint(place: Pick<CardPlacement, 'rect' | 'anchor'>): { x: number; y: number } {
  const { rect, anchor } = place;
  return { x: rect.x, y: anchor === 'top' ? rect.y : rect.y + rect.h - CARD_PILL_H };
}

// ── Enter / exit edge (W6 residual, wave-2 r2) ───────────────────────────────

/** The viewport edge a card leaves by, or arrives from. */
export type CardEdge = 'top' | 'bottom';

/** One card episode: the station shown, and the edge latched for it. */
export interface CardEpisode {
  station: number;
  edge: CardEdge;
  exiting: boolean;
}

export interface CardEpisodeState {
  /** The card on screen (entering, shown, or exiting); null when none. */
  shown: CardEpisode | null;
  /** The target the state was last stepped with. */
  target: number | null;
  /** Station of the last card that was shown (survives its exit). */
  lastStation: number | null;
}

/**
 * The travel evidence at a transition. `velocitySign` is the sign of the
 * SMOOTHED progress velocity (the rendered world's motion), 0 while it is
 * under the card's epsilon; `direction` is the conductor's last non-zero
 * latched direction, the fallback only.
 */
export interface CardTravel {
  velocitySign: -1 | 0 | 1;
  direction: 1 | -1;
}

/**
 * Smoothed-progress speed (stations / s) under which the world counts as not
 * moving for the edge choice (the exponential follower's tail sits below it).
 */
export const CARD_VELOCITY_EPS = 0.05;

export const INITIAL_CARD_EPISODE: CardEpisodeState = { shown: null, target: null, lastStation: null };

/** The sign of travel the visitor SEES: the smoothed velocity, else the latch. */
function travelSign(travel: CardTravel): 1 | -1 {
  return travel.velocitySign !== 0 ? travel.velocitySign : travel.direction;
}

/**
 * Enter edge. Arriving at a higher station than the last card came from
 * (forward travel) the card rises from the bottom; at a lower one it drops
 * from the top. Only when there is no previous card, or it is the same
 * station (a jitter out and back), does the travel sign decide.
 */
export function cardEnterEdge(target: number, lastStation: number | null, travel: CardTravel): CardEdge {
  if (lastStation !== null && lastStation !== target) return target > lastStation ? 'bottom' : 'top';
  return travelSign(travel) > 0 ? 'bottom' : 'top';
}

/**
 * Exit edge: the card leaves the way the world is moving at exit start —
 * forward (smooth increasing) leaves upward, backward leaves downward. The
 * smoothed velocity wins over the direction latch, which can lag a jitter
 * reversal by its dwell (wave-2 r1: 2 of 8 jitter episodes exited downward
 * while the world advanced).
 */
export function cardExitEdge(travel: CardTravel): CardEdge {
  return travelSign(travel) > 0 ? 'top' : 'bottom';
}

/**
 * Step the card's episode bookkeeping with a new target (the settled station
 * the card may show, or null). Returns the SAME object when nothing changed,
 * so a render-time "adjust state on change" caller never loops. Each episode
 * latches its edge once, at its transition; a later travel change never
 * rewrites a running animation's edge.
 */
export function stepCardEpisode(state: CardEpisodeState, target: number | null, travel: CardTravel): CardEpisodeState {
  if (target === state.target) return state;
  if (target !== null) {
    return {
      shown: { station: target, edge: cardEnterEdge(target, state.lastStation, travel), exiting: false },
      target,
      lastStation: target,
    };
  }
  if (state.shown && !state.shown.exiting) {
    return { ...state, target, shown: { ...state.shown, edge: cardExitEdge(travel), exiting: true } };
  }
  return { ...state, target };
}

/** The exit animation finished: the box goes (only an exiting one). */
export function finishCardExit(state: CardEpisodeState): CardEpisodeState {
  return state.shown?.exiting ? { ...state, shown: null } : state;
}
