/**
 * Rule shaping and canvas painters for the south challenge gate (`#rules`).
 *
 * One painter module per station, mirroring `desk-painters.ts`: the pier
 * plaques, the frieze lettering and the threshold plate all draw here, and
 * `ChallengeGate` only uploads the result. Pure 2D — no React, no three
 * imports. (The crest medallion painters retired with C-054's prop swap.)
 *
 * `resolveRuleSet` is the single shaping of the season's format rules into
 * label/value rows; the stone plaques, the passage board, the `?rules=` panel
 * and the Lite `RulesSection` all read it, so the surfaces can never
 * disagree. The words come from `paint.gate` in the viewer's `locale` (i18n
 * D11); the `'de'` default is the plaza's reviewed German, kept for callers
 * that have not threaded the locale yet. The league's FORMAT picks the
 * shaping (`RulesCopyContext`), never whether a `format_rules` row exists:
 * only Evolution Point Buy seasons get a row, and a format change can leave a
 * stale one behind.
 */
import type { FormatRules, TiebreakerStep } from '@/types/format-rules';
import { epbPack } from '@/lib/format-pack';
import { effectiveTiebreakerChain } from '@/lib/tournament/standings-rules';
import { LOCALES, type Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/core';
import { paintMessages } from '@/i18n/messages/paint';
import { leagueHubCopy } from '@/lib/league-hub/copy';
import { isDraftLike } from '@/lib/season/format-utils';
import { paintCaps, paintT } from '@/lib/route-world/paint-copy';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { isPointBuyRules } from '@/components/world/sections/rules-context';
import type { RulesCopyContext } from '@/components/world/sections/types';

const FONT = "system-ui, 'Segoe UI', sans-serif";

/** Portrait plaque face, 5:7 — matches the `GATE.plaqueW / plaqueH` ratio. */
export const PLAQUE_TEX_W = 640;
export const PLAQUE_TEX_H = 896;
/** Frieze band, 19.6:1 — matches the lettered face over the opening. */
export const FRIEZE_TEX_W = 1920;
export const FRIEZE_TEX_H = 98;
/**
 * Center passage board, 1.216:1 — matches the `GATE.doorW × 4.4` face plane
 * it is mounted on (C-108: the board that replaced the threshold field).
 */
export const FIELD_TEX_W = 1216;
export const FIELD_TEX_H = 1000;
/** Bronze threshold plate on the sill riser, 12.8:1. */
export const CTA_TEX_W = 1024;
export const CTA_TEX_H = 80;

// ── Rule shaping ──────────────────────────────────────────────────

export type RuleSide = 'left' | 'right';

/** Tera rule values (`paint.gate.teraRule`) in `locale`, keyed by the stored rule. */
export function teraRuleText(locale: Locale): Readonly<Record<string, string>> {
  return getMessages(paintMessages, locale).gate.teraRule;
}

/** Tiebreaker step names (`paint.gate.tiebreaker`) in `locale`, keyed by the stored step. */
export function tiebreakerText(locale: Locale): Readonly<Record<string, string>> {
  return getMessages(paintMessages, locale).gate.tiebreaker;
}

/** The ruleset row's label in every locale (`fieldBoardPage` drops that row by label). */
const RULESET_LABELS: ReadonlySet<string> = new Set(LOCALES.map((locale) => paintT(locale)('gate.label.ruleset')));

export interface RuleRow {
  label: string;
  value: string;
}

export interface RuleSection {
  id: 'format' | 'klauseln' | 'draft';
  heading: string;
  rows: RuleRow[];
  /** Long-form detail the row grid cannot carry (chains, name lists). */
  note?: string;
}

export interface RuleSet {
  /** Explicit ruleset name, or null when the season runs the EPB defaults. */
  rulesetName: string | null;
  /**
   * Whether the EPB draft numbers come from a `format_rules` row (false: the
   * EPB defaults). Always false off EPB, where a row is a stale one.
   */
  configured: boolean;
  /** Whether the league runs Evolution Point Buy: the format decides, never the row. */
  pointBuy: boolean;
  /**
   * The format's German name (`leagueHubCopy('de').formatType`). It names the
   * rules when no ruleset does: the EPB fallback 'Evolution Point Buy' is it.
   */
  formatLabel: string;
  sections: RuleSection[];
  /** Row each plaque highlights — the ZA selected row. */
  lead: Record<RuleSide, string>;
}

function teraText(rules: typeof epbPack.teraByStage, locale: Locale): [string, string, string] {
  const text = teraRuleText(locale);
  return [text[rules.stage1] ?? rules.stage1, text[rules.stage2] ?? rules.stage2, text[rules.stage3] ?? rules.stage3];
}

function tiebreakerChain(order: readonly TiebreakerStep[], locale: Locale): string {
  const text = tiebreakerText(locale);
  return order.map((step) => text[step] ?? step).join(' → ');
}

/** Stored English move / item names, shown in the viewer's Pokémon-data language. */
function nameList(names: readonly string[], localize: (name: string) => string, locale: Locale): string {
  return names.length > 0 ? names.map(localize).join(', ') : paintT(locale)('gate.none');
}

/** Where a non-EPB league's clauses, bans and custom rules live (the painted value), in `locale`. */
export function rulesTabText(locale: Locale): string {
  return paintT(locale)('gate.rulesTabText');
}

/** The pointer sentence the DOM surfaces put before their link to the Rules tab, in `locale`. */
export function rulesTabNote(locale: Locale): string {
  return paintT(locale)('gate.rulesTabNote');
}

/** The painted value of the clause rows when the league has no ruleset: nothing is on record. */
export function rulesNoneText(locale: Locale): string {
  return paintT(locale)('gate.rulesNoneText');
}

/**
 * The sentence in place of `rulesTabNote` when the league has no ruleset:
 * the hub's own wording ('No ruleset assigned.' / 'Kein Regelwerk
 * zugewiesen.', the Rules tab's notice), so the world never promises clauses
 * the tab does not list.
 */
export function rulesNoneNote(locale: Locale): string {
  return paintT(locale)('gate.rulesNoneNote', { noRuleset: leagueHubCopy(locale).noRuleset });
}

/**
 * Every format but Evolution Point Buy: the ruleset name (only when one is
 * set; the board title falls back to the format), the format and the current
 * stage's best-of. Clauses, bans and custom rules are not on the season row
 * at all: they live in the league hub's Regeln tab, which reads the ruleset
 * live, so the second page points there instead of inventing rows. Any
 * `format_rules` row is a stale one here and is never read.
 *
 * With no ruleset (neither the season nor its first stage names one — the
 * hub reads the same fallback and shows 'Kein Regelwerk zugewiesen.') the
 * clause rows say so ('nicht hinterlegt') instead of pointing at a tab that
 * lists none (PR #65 test pass, 5B-2). Same rows, so the layout is unchanged.
 */
function formatRuleSet(rulesetName: string | null, formatLabel: string, bestOf: number | null, locale: Locale): RuleSet {
  const t = paintT(locale);
  const clauseValue = rulesetName ? rulesTabText(locale) : rulesNoneText(locale);
  const label = {
    ruleset: t('gate.label.ruleset'),
    format: t('gate.label.format'),
    bestOf: t('gate.label.bestOf'),
    clauses: t('gate.label.clauses'),
    bans: t('gate.label.bans'),
    customRules: t('gate.label.customRules'),
  };
  return {
    rulesetName,
    configured: false,
    pointBuy: false,
    formatLabel,
    lead: { left: label.format, right: label.clauses },
    sections: [
      {
        id: 'format',
        heading: t('gate.heading.format'),
        rows: [
          ...(rulesetName ? [{ label: label.ruleset, value: rulesetName }] : []),
          { label: label.format, value: formatLabel },
          ...(bestOf === null ? [] : [{ label: label.bestOf, value: String(bestOf) }]),
        ],
      },
      {
        id: 'klauseln',
        heading: t('gate.heading.clauses'),
        rows: [
          { label: label.clauses, value: clauseValue },
          { label: label.bans, value: clauseValue },
          { label: label.customRules, value: clauseValue },
        ],
        note: rulesetName ? rulesTabNote(locale) : rulesNoneNote(locale),
      },
    ],
  };
}

/**
 * The season's rules as label/value rows in `locale`. The first two inputs
 * are exactly the generic world contract's rule fields
 * (`WorldRouteData.formatRules` / `.rulesetName`), both nullable; `context`
 * is the league's format and current best-of (`rulesCopyContext`).
 *
 * Evolution Point Buy resolves the draft numbers from the row, with the EPB
 * defaults filled in when the season has none (the fallback ruleset label is
 * the format's own name). Every other format resolves through
 * `formatRuleSet` and never reads the row. A row's `lead` match is by label,
 * which is unambiguous inside one locale. `dataLocale` names the banned moves
 * and items (`useDataLocale()`); absent, they stay as stored (English).
 */
export function resolveRuleSet(
  formatRules: FormatRules | null,
  rulesetName: string | null,
  context: RulesCopyContext,
  locale: Locale,
  dataLocale: Locale = 'en',
): RuleSet {
  const formatLabel = leagueHubCopy(locale).formatType[context.format] ?? context.format;
  if (!isPointBuyRules(context)) return formatRuleSet(rulesetName, formatLabel, context.bestOf, locale);
  const t = paintT(locale);

  const fallbackLabel = formatLabel;
  const defaults = epbPack.defaults;
  const budget = formatRules?.draft_budget ?? defaults.draftBudget;
  const picks = formatRules?.draft_picks ?? defaults.draftPicks;
  const tokenRatio = formatRules?.draft_token_ratio ?? defaults.tokenRatio;
  const tokenMax = formatRules?.draft_token_max ?? defaults.tokenMax;
  const tokenMaxPerLine = formatRules?.draft_token_max_per_line ?? defaults.tokenMaxPerLine;
  const tera = teraText(formatRules?.tera_rules ?? epbPack.teraByStage, locale);
  const bannedMoves = formatRules?.banned_moves ?? defaults.bannedMoves;
  const bannedItems = formatRules?.banned_items ?? defaults.bannedItems;
  // The chain the table ranks by (the stored order when usable, else the pack's).
  const order = effectiveTiebreakerChain(formatRules);
  const draftBudget = t('gate.label.draftBudget');
  const teraStage = (n: number) => t('gate.label.teraStage', { n: String(n) });

  return {
    rulesetName,
    configured: formatRules !== null,
    pointBuy: true,
    formatLabel,
    lead: { left: draftBudget, right: teraStage(1) },
    sections: [
      {
        id: 'format',
        heading: t('gate.heading.format'),
        rows: [
          { label: t('gate.label.ruleset'), value: rulesetName ?? fallbackLabel },
          { label: draftBudget, value: t('gate.value.budgetPoints', { budget: String(budget) }) },
          { label: t('gate.label.evolutionLines'), value: String(picks) },
          {
            label: t('gate.label.redraftPhase'),
            value: formatRules?.redraft_phase_open ? t('gate.value.open') : t('gate.value.closed'),
          },
        ],
        note: t('gate.note.tiebreaker', { chain: tiebreakerChain(order, locale) }),
      },
      {
        id: 'klauseln',
        heading: t('gate.heading.clauses'),
        rows: [
          { label: teraStage(1), value: tera[0] },
          { label: teraStage(2), value: tera[1] },
          { label: teraStage(3), value: tera[2] },
          { label: t('gate.label.bannedMoves'), value: String(bannedMoves.length) },
          { label: t('gate.label.bannedItems'), value: String(bannedItems.length) },
        ],
        note: t('gate.note.banned', {
          moves: nameList(bannedMoves, (name) => localizeMove(name, dataLocale), locale),
          items: nameList(bannedItems, (name) => localizeItem(name, dataLocale), locale),
        }),
      },
      {
        id: 'draft',
        heading: t('gate.heading.draftRules'),
        rows: [
          { label: t('gate.label.draftTokens'), value: t('gate.value.tokenRatio', { ratio: String(tokenRatio) }) },
          { label: t('gate.label.tokensPerPlayer'), value: t('gate.value.max', { n: String(tokenMax) }) },
          { label: t('gate.label.tokensPerLine'), value: t('gate.value.max', { n: String(tokenMaxPerLine) }) },
          { label: t('gate.label.killTokens'), value: t('gate.value.shutout') },
          { label: t('gate.label.cosmoPoints'), value: t('gate.value.participation') },
        ],
      },
    ],
  };
}

export interface PlaquePage {
  kicker: string;
  title: string;
  rows: RuleRow[];
  /** Label of the row the plaque inverts, ZA-style. */
  lead: string;
  footer: string;
}

/**
 * The two pier plaques: the same rows the docked `?rules=` panel lists, the
 * lettering (`paint.gate.plaque`) in `locale` — pass the locale the set was
 * resolved in.
 *
 * Off EPB the plaques carry fewer rows than their five slots (rows stay
 * top-aligned, the lower slots stay empty glass): Tafel I the ruleset name
 * (when set), the format and the best-of; Tafel II the three pointers to the
 * Regeln tab.
 */
export function plaquePages(set: RuleSet, locale: Locale): Record<RuleSide, PlaquePage> {
  const byId = (id: RuleSection['id']) => set.sections.find((s) => s.id === id)?.rows ?? [];
  const format = byId('format');
  const draft = byId('draft');
  const footer = paintCaps(locale, 'gate.plaque.footer');
  const kickerLeft = paintCaps(locale, 'gate.plaque.kickerLeft');
  const kickerRight = paintCaps(locale, 'gate.plaque.kickerRight');

  if (!set.pointBuy) {
    return {
      left: { kicker: kickerLeft, title: paintCaps(locale, 'gate.plaque.titleFormat'), rows: format, lead: set.lead.left, footer },
      right: {
        kicker: kickerRight,
        title: paintCaps(locale, 'gate.plaque.titleClausesBans'),
        rows: byId('klauseln'),
        lead: set.lead.right,
        footer,
      },
    };
  }

  return {
    left: {
      kicker: kickerLeft,
      title: paintCaps(locale, 'gate.plaque.titleFormatDraft'),
      rows: [...format.slice(1), ...draft.slice(0, 2)],
      lead: set.lead.left,
      footer,
    },
    right: {
      kicker: kickerRight,
      title: paintCaps(locale, 'gate.plaque.titleTeraClauses'),
      rows: byId('klauseln'),
      lead: set.lead.right,
      footer,
    },
  };
}

/** The passage board's face: the ruleset (else the format) over the plaques' head rows. */
export interface FieldBoardPage {
  kicker: string;
  title: string;
  rows: RuleRow[];
  lead: string;
  footer: string;
}

/**
 * The center passage board (C-108). EPB shows the head three rows of each
 * plaque. Off EPB the title already names the ruleset, so the board drops
 * that row and shows the format, the best-of and the Regeln-tab pointers
 * (four or five of its six rows).
 */
export function fieldBoardPage(
  set: RuleSet,
  pages: Record<RuleSide, PlaquePage>,
  locale: Locale,
): FieldBoardPage {
  const rows = set.pointBuy
    ? [...pages.left.rows.slice(0, 3), ...pages.right.rows.slice(0, 3)]
    : [...pages.left.rows.filter((row) => !RULESET_LABELS.has(row.label)), ...pages.right.rows].slice(0, BOARD_ROWS);
  return {
    kicker: paintCaps(locale, 'gate.plaque.boardKicker'),
    title: set.rulesetName ?? set.formatLabel,
    rows,
    lead: pages.left.lead,
    footer: pages.left.footer,
  };
}

// ── Canvas helpers ────────────────────────────────────────────────

/** `#rrggbb` + alpha → `rgba()`. */
export function hexA(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function font(weight: number, size: number): string {
  return `${weight} ${size}px ${FONT}`;
}

/** Rounded-rect path — never relies on `CanvasRenderingContext2D.roundRect`. */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Letter-spaced run centred on `cx`; `ctx.letterSpacing` is not portable. */
function tracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  tracking: number,
): void {
  const chars = [...text];
  const width =
    chars.reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) + tracking * (chars.length - 1);
  let x = cx - width / 2;
  ctx.textAlign = 'left';
  for (const ch of chars) {
    ctx.fillText(ch, x, cy);
    x += ctx.measureText(ch).width + tracking;
  }
}

/** Shrink `text` until it fits `max`, so a long league name never clips. */
function fitted(ctx: CanvasRenderingContext2D, text: string, max: number, size: number, weight: number): number {
  let px = size;
  ctx.font = font(weight, px);
  while (px > 12 && ctx.measureText(text).width > max) {
    px -= 2;
    ctx.font = font(weight, px);
  }
  return px;
}

/** `text` cut to fit `max` at the current font, with an ellipsis when it was cut. */
function ellipsized(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  const chars = [...text];
  let end = chars.length;
  while (end > 1 && ctx.measureText(`${chars.slice(0, end).join('').trimEnd()}…`).width > max) end -= 1;
  return `${chars.slice(0, end).join('').trimEnd()}…`;
}

/**
 * Greedy word wrap of `text` into at most two lines of `max` px at the
 * current font. A word wider than a line breaks by characters; whatever does
 * not fit the second line is ellipsized, so nothing leaves the box.
 */
export function wrapTwoLines(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let rest = text.trim();
  while (rest.length > 0 && lines.length < 2) {
    if (lines.length === 1 || ctx.measureText(rest).width <= max) {
      lines.push(lines.length === 1 ? ellipsized(ctx, rest, max) : rest);
      rest = '';
      break;
    }
    const words = rest.split(/\s+/);
    let line = '';
    let used = 0;
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > max) break;
      line = next;
      used += 1;
    }
    if (used === 0) {
      // One word wider than the line: break it by characters.
      const chars = [...words[0]];
      let end = chars.length;
      while (end > 1 && ctx.measureText(chars.slice(0, end).join('')).width > max) end -= 1;
      line = chars.slice(0, end).join('');
      rest = rest.slice(line.length).trimStart();
    } else {
      rest = words.slice(used).join(' ');
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Smallest px a plaque row value shrinks to on one line. Below it a value
 * (a long ruleset name on non-EPB Tafel I) wraps to two lines at this size
 * instead — the old 12 px floor left it illegible or, past ~47 characters,
 * running over its label (PR #65 test pass, 5B-3).
 */
export const PLAQUE_VALUE_MIN_PX = 22;

/**
 * A plaque row's value, right-aligned at `x`: one line at the largest px
 * ≤ 30 that fits `max` (exactly the pre-5B-3 call whenever that px is at
 * least PLAQUE_VALUE_MIN_PX, so every EPB value paints byte-identically),
 * else two wrapped lines at PLAQUE_VALUE_MIN_PX, the second ellipsized.
 */
function paintPlaqueValue(ctx: CanvasRenderingContext2D, text: string, x: number, cy: number, max: number): void {
  const px = fitted(ctx, text, max, 30, 700);
  if (px >= PLAQUE_VALUE_MIN_PX) {
    ctx.font = font(700, px);
    ctx.fillText(text, x, cy);
    return;
  }
  ctx.font = font(700, PLAQUE_VALUE_MIN_PX);
  const lines = wrapTwoLines(ctx, text, max);
  const step = Math.round(PLAQUE_VALUE_MIN_PX * 1.2);
  const top = cy - ((lines.length - 1) * step) / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, top + i * step));
}

/**
 * Ink for BOTH halves of a selected (brass-filled) rule row. Fidelity wave-2
 * r3: the label was painted weight 600 in a slightly lighter ink than its
 * value, and on the self-lit boards the bright brass bloom ate its thin
 * strokes — "Draft-Budget" rendered pale gold on gold while the value ("<n> Punkte")
 * held. One ink and a heavy weight for label and value on the lead row;
 * ≥ 4.5:1 on both mode brasses (pinned in gate-painters.test.ts).
 */
export const LEAD_ROW_INK = '#120d04';
/** Label weight on the selected row — heavy enough to survive the brass bloom. */
export const LEAD_ROW_LABEL_WEIGHT = 800;

// ── Plaque ────────────────────────────────────────────────────────

/** Row slots on a plaque face; a page never paints more. */
export const PLAQUE_ROWS = 5;
const PLAQUE_ROW_TOP = 268;
const PLAQUE_ROW_STEP = 106;

/**
 * Dark-glass plaque face: kicker, title, and the rule rows in ZA list grammar
 * (label left, value right, the plaque's own rule inverted onto brass). The
 * same bitmap drives `map` and `emissiveMap`, so the deep field stays dark
 * while the glyphs carry the HDR luminance Bloom reads at night.
 */
export function paintPlaque(page: PlaquePage, brass: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const field = ctx.createLinearGradient(0, 0, w * 0.35, h);
    field.addColorStop(0, '#12212a');
    field.addColorStop(0.55, '#0a141b');
    field.addColorStop(1, '#050b10');
    ctx.fillStyle = field;
    ctx.fillRect(0, 0, w, h);

    // Raking sheen across the glass, so the face is never one flat value.
    const sheen = ctx.createLinearGradient(0, h * 0.1, w, h * 0.55);
    sheen.addColorStop(0, 'rgba(150, 210, 226, 0.10)');
    sheen.addColorStop(0.4, 'rgba(150, 210, 226, 0.02)');
    sheen.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = hexA(brass, 0.5);
    ctx.lineWidth = 3;
    ctx.strokeRect(26, 26, w - 52, h - 52);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = hexA(brass, 0.92);
    ctx.font = font(700, 26);
    ctx.fillText(page.kicker, 60, 86);

    ctx.fillStyle = '#f7eeda';
    const titleSize = fitted(ctx, page.title, w - 120, 50, 800);
    ctx.font = font(800, titleSize);
    ctx.fillText(page.title, 60, 148);

    ctx.fillStyle = hexA(brass, 0.75);
    ctx.fillRect(60, 184, 188, 4);

    const rows = page.rows.slice(0, PLAQUE_ROWS);
    rows.forEach((row, i) => {
      const cy = PLAQUE_ROW_TOP + i * PLAQUE_ROW_STEP;
      const lead = row.label === page.lead;
      rr(ctx, 48, cy - 40, w - 96, 80, 12);
      ctx.fillStyle = lead ? brass : 'rgba(214, 236, 240, 0.06)';
      ctx.fill();
      if (!lead) {
        ctx.strokeStyle = 'rgba(214, 236, 240, 0.12)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.textAlign = 'left';
      ctx.fillStyle = lead ? LEAD_ROW_INK : '#bcd2d6';
      const labelWeight = lead ? LEAD_ROW_LABEL_WEIGHT : 600;
      ctx.font = font(labelWeight, fitted(ctx, row.label, w - 300, 28, labelWeight));
      ctx.fillText(row.label, 74, cy);

      ctx.textAlign = 'right';
      ctx.fillStyle = lead ? LEAD_ROW_INK : '#f7eeda';
      paintPlaqueValue(ctx, row.value, w - 74, cy, w - 320);
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = hexA(brass, 0.7);
    ctx.font = font(700, 20);
    tracked(ctx, page.footer, w / 2, h - 56, 2.5);
  };
}

// ── Center passage board ──────────────────────────────────────────

/** Row slots on the passage board. */
export const BOARD_ROWS = 6;
const BOARD_ROW_TOP = 300;
const BOARD_ROW_STEP = 96;

/**
 * The passage's center board (C-108): the Regelwerk summary at jumbotron
 * grade, in the plaques' dark-glass grammar scaled up. The field is PURE
 * #000000 — the C-104 zero-emission law: AgX grades the whole frame at a
 * heavy exposure, so ANY non-zero field lifts toward the same pastel and
 * the ink's contrast dies; exactly zero emission maps to exactly black at
 * any exposure, and the ink reads by its own emission alone (the same
 * bitmap drives `map` and `emissiveMap`). No sheen, no gradient: every
 * non-ink pixel stays 0.
 */
export function paintFieldBoard(kicker: string, title: string, rows: RuleRow[], lead: string, footer: string, brass: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = hexA(brass, 0.55);
    ctx.lineWidth = 4;
    ctx.strokeRect(28, 28, w - 56, h - 56);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = hexA(brass, 0.92);
    ctx.font = font(700, 34);
    // `tracked` CENTRES on its x: the kicker was centred on x 72, so its
    // first half ran off the canvas ("GELWERK" at 768, wave-2 r2). Anchor its
    // left edge at 72, the title's column.
    const kickerW = [...kicker].reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) + 5 * Math.max(0, [...kicker].length - 1);
    tracked(ctx, kicker, 72 + kickerW / 2, 96, 5);

    ctx.fillStyle = '#f7eeda';
    const titleSize = fitted(ctx, title, w - 144, 76, 800);
    ctx.font = font(800, titleSize);
    ctx.fillText(title, 70, 176);

    ctx.fillStyle = hexA(brass, 0.75);
    ctx.fillRect(70, 232, 260, 5);

    rows.slice(0, BOARD_ROWS).forEach((row, i) => {
      const cy = BOARD_ROW_TOP + i * BOARD_ROW_STEP;
      const isLead = row.label === lead;
      rr(ctx, 56, cy - 38, w - 112, 76, 12);
      ctx.fillStyle = isLead ? brass : 'rgba(214, 236, 240, 0.07)';
      ctx.fill();
      if (!isLead) {
        ctx.strokeStyle = 'rgba(214, 236, 240, 0.14)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.textAlign = 'left';
      ctx.fillStyle = isLead ? LEAD_ROW_INK : '#bcd2d6';
      const labelWeight = isLead ? LEAD_ROW_LABEL_WEIGHT : 600;
      ctx.font = font(labelWeight, fitted(ctx, row.label, w - 420, 38, labelWeight));
      ctx.fillText(row.label, 92, cy);

      ctx.textAlign = 'right';
      ctx.fillStyle = isLead ? LEAD_ROW_INK : '#f7eeda';
      ctx.font = font(700, fitted(ctx, row.value, w - 440, 42, 700));
      ctx.fillText(row.value, w - 92, cy);
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = hexA(brass, 0.7);
    ctx.font = font(700, 24);
    tracked(ctx, footer, w / 2, h - 72, 3);
  };
}

// ── Frieze lettering ──────────────────────────────────────────────

function friezeText(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  label: string,
  ink: { letter: string; ornament: string },
  shadow: string | null,
): void {
  ctx.textBaseline = 'middle';
  const size = fitted(ctx, label, w * 0.62, h * 0.62, 800);
  ctx.font = font(800, size);
  if (shadow) {
    ctx.fillStyle = shadow;
    tracked(ctx, label, w / 2, h / 2 + Math.max(3, h * 0.075), size * 0.19);
  }
  ctx.fillStyle = ink.letter;
  tracked(ctx, label, w / 2, h / 2, size * 0.19);

  ctx.fillStyle = ink.ornament;
  const inset = w * 0.035;
  ([inset, w - inset] as const).forEach((x) => {
    ctx.beginPath();
    ctx.moveTo(x, h * 0.5 - h * 0.2);
    ctx.lineTo(x + h * 0.16, h * 0.5);
    ctx.lineTo(x, h * 0.5 + h * 0.2);
    ctx.lineTo(x - h * 0.16, h * 0.5);
    ctx.closePath();
    ctx.fill();
  });
}

/** Frieze albedo — raised letters catch the key, their undercut goes to soot. */
export function paintFrieze(label: string, stone: string, letter: string) {
  const ink = friezeInk(stone, letter);
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const field = ctx.createLinearGradient(0, 0, 0, h);
    field.addColorStop(0, stone);
    field.addColorStop(1, hexA(stone, 0.72));
    ctx.fillStyle = field;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(0, 0, w, Math.max(2, h * 0.06));
    ctx.fillRect(0, h - Math.max(2, h * 0.06), w, Math.max(2, h * 0.06));
    friezeText(ctx, w, h, label, { letter: ink.letter, ornament: ink.letter }, ink.shadow);
  };
}

/** Minimum letter-to-stone contrast of the frieze inscription (fidelity W1 r4). */
export const FRIEZE_MIN_CONTRAST = 3;

/** Dark bronze inlay — the league ink (#241A0C) at ≈ 70 % over pale stone. */
export const FRIEZE_INLAY_DARK = '#4a3a24';

function friezeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return Number.NaN;
  const ch = (i: number) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

/** WCAG contrast of two `#rrggbb` colours (1 when either is unparseable). */
export function friezeContrast(a: string, b: string): number {
  const la = friezeLuminance(a);
  const lb = friezeLuminance(b);
  if (Number.isNaN(la) || Number.isNaN(lb)) return 1;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The inscription's inlay ink against its stone (fidelity W1 r4): the light
 * theme painted `#fffaf0` letters on `#e6dac4` stone (≈ 1.2:1 — "EVOLIGA
 * SAISON 3 (VORSCHAU)" was white-on-white embossing). Candidates in order —
 * the authored letter, pure white, then the dark bronze inlay; the first to
 * clear `FRIEZE_MIN_CONTRAST` wins (the dark theme's grey stone keeps a pale
 * letter). A dark inlay trades the drop shadow for a pale lower lip, the
 * engraved read.
 */
export function friezeInk(stone: string, letter: string): { letter: string; shadow: string } {
  const candidates = [letter, '#ffffff', FRIEZE_INLAY_DARK];
  let chosen = candidates.find((c) => friezeContrast(c, stone) >= FRIEZE_MIN_CONTRAST);
  if (!chosen) {
    chosen = candidates.reduce((best, c) => (friezeContrast(c, stone) > friezeContrast(best, stone) ? c : best));
  }
  const darkInlay = friezeLuminance(chosen) < friezeLuminance(stone);
  return { letter: chosen, shadow: darkInlay ? 'rgba(255, 250, 240, 0.55)' : 'rgba(24, 16, 8, 0.68)' };
}

/** Frieze height field — the letters are the only thing standing proud. */
export function paintFriezeHeight(label: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(0, 0, w, h);
    friezeText(ctx, w, h, label, { letter: '#ffffff', ornament: '#dcdcdc' }, null);
  };
}

// ── Threshold plate ───────────────────────────────────────────────

/** The threshold plate's engraving for a draft format (EPB and plain draft), in `locale`. */
export function ctaDraftText(locale: Locale): string {
  return paintCaps(locale, 'gate.cta.draft');
}
/** The engraving for singles and doubles, which have no draft to call to, in `locale`. */
export function ctaPlayText(locale: Locale): string {
  return paintCaps(locale, 'gate.cta.play');
}

/** The threshold plate's engraving for the league's format. */
export function ctaText(format: RulesCopyContext['format'], locale: Locale): string {
  return isDraftLike(format) ? ctaDraftText(locale) : ctaPlayText(locale);
}

/** Bronze plate on the sill riser: the call-to-action (`ctaText`), engraved. */
export function paintCta(live: string, label: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const plate = ctx.createLinearGradient(0, 0, 0, h);
    plate.addColorStop(0, '#6d5327');
    plate.addColorStop(0.45, '#3d2f18');
    plate.addColorStop(1, '#241b0e');
    ctx.fillStyle = plate;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(240, 214, 150, 0.55)';
    ctx.lineWidth = Math.max(2, h * 0.035);
    ctx.strokeRect(h * 0.12, h * 0.12, w - h * 0.24, h - h * 0.24);

    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f4e3bd';
    const size = fitted(ctx, label, w * 0.66, h * 0.5, 800);
    ctx.font = font(800, size);
    tracked(ctx, label, w * 0.46, h / 2, size * 0.16);

    ctx.fillStyle = live;
    const ax = w * 0.9;
    ctx.beginPath();
    ctx.moveTo(ax - h * 0.2, h / 2 - h * 0.2);
    ctx.lineTo(ax + h * 0.2, h / 2);
    ctx.lineTo(ax - h * 0.2, h / 2 + h * 0.2);
    ctx.closePath();
    ctx.fill();
  };
}
