/**
 * The EvoLiga plaza's rules surfaces follow the league's FORMAT, never
 * whether a `format_rules` row exists: the two stone plaques, the REGELWERK
 * passage board, the threshold plate, the `?rules=left|right` panel and the
 * Lite #rules section (the German counterpart of
 * `sections/__tests__/rules-format-aware.test.tsx`).
 *
 * Only Evolution Point Buy seasons get a `format_rules` row, and a format
 * change can leave a stale one behind; an admin pin or `?world=plaza` (the
 * route theme, not the world id) can put a singles, doubles or draft league
 * on the plaza.
 *
 * The EPB branch is pinned against the active format pack (the public example
 * pack in this project): the shaped rows are built from its defaults and
 * words, and SHA-256 digests of the painted canvas calls (text, fonts, inks,
 * positions, every rect) and of the panel and section markup were captured
 * under it. Re-capture the digests when the example pack's defaults or rule
 * words change. The league's own pack keeps a byte-identity copy of this test
 * pinned to the pre-format literals (design spec §F.1).
 *
 * Rendered through react-dom/server (vitest 'node' env). `next/link` is a
 * marked anchor; the preview fixtures import the route-data module, whose
 * query modules import the Supabase client: a stub that throws on use.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const navigation = vi.hoisted(() => ({ search: '' }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock('next/link', async () => {
  const { createElement: h } = await import('react');
  function Link({
    href,
    children,
    scroll: _scroll,
    prefetch: _prefetch,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
    scroll?: boolean;
    prefetch?: boolean | null;
    [key: string]: unknown;
  }) {
    return h('a', { ...rest, href, 'data-soft': '' }, children);
  }
  return { default: Link };
});

vi.mock('@/lib/supabase/client', () => ({
  get supabase(): never {
    throw new Error('section render must not reach Supabase');
  },
}));

// EvoligaOverlays hands its panels to OverlaySwitch (a client dialog bridge);
// here it just renders the rules contents, each between two marker tags.
vi.mock('@/components/world/route/focus/OverlaySwitch', async () => {
  const { createElement: h, Fragment } = await import('react');
  function OverlaySwitch({ paramName, contents }: { paramName: string; contents: Record<string, ReactNode> }) {
    if (paramName !== 'rules') return null;
    return h(
      Fragment,
      null,
      Object.entries(contents).map(([value, body]) =>
        h(Fragment, { key: value }, h('i', { 'data-start': value }), body, h('i', { 'data-end': value })),
      ),
    );
  }
  return { default: OverlaySwitch };
});

import { buildPreviewRoute, buildPreviewWorld } from '@/app/(public)/route-preview/fixtures';
import { WorldStateContext, type WorldStateValue } from '@/components/world/route/WorldStateProvider';
import type { RulesCopyContext } from '@/components/world/sections/types';
import { formatStationDigest, stationDigestFacts } from '@/lib/route-world/station-digest';
import { resolveViewerWorld } from '@/lib/worlds/registry';
import { getMessages } from '@/i18n/core';
import { paintMessages } from '@/i18n/messages/paint';
import { epbPack, formatPack, participationLineBase } from '@/lib/format-pack';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { FormatRules, TiebreakerStep } from '@/types/format-rules';
import type { SeasonFormatType } from '@/types/season';
import {
  BOARD_ROWS,
  CTA_TEX_H,
  CTA_TEX_W,
  FIELD_TEX_H,
  FIELD_TEX_W,
  PLAQUE_ROWS,
  PLAQUE_TEX_H,
  PLAQUE_TEX_W,
  PLAQUE_VALUE_MIN_PX,
  ctaDraftText,
  ctaPlayText,
  ctaText,
  fieldBoardPage,
  paintCta,
  paintFieldBoard,
  paintPlaque,
  plaquePages,
  resolveRuleSet,
  rulesNoneNote,
  rulesNoneText,
  rulesTabNote,
  type RuleRow,
} from '../route/plaza/gate-painters';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import EvoligaOverlays from '../EvoligaOverlays';
import RulesFocusPanel from '../RulesFocusPanel';
import RulesSection from '../RulesSection';

// ─── Fixtures and helpers ─────────────────────────────────────────────────

const LEAGUE_ID = 'preview-season';
const RULESET = 'EvoLiga Standard';

function epbRow(): FormatRules {
  const rules = buildPreviewRoute().formatRules;
  if (!rules) throw new Error('the plaza preview carries a format_rules row');
  return rules;
}

/** A configured row that differs from the defaults in every painted number. */
function customRow(): FormatRules {
  return {
    ...epbRow(),
    draft_budget: 150,
    draft_picks: 8,
    draft_token_ratio: 4,
    draft_token_max: 3,
    draft_token_max_per_line: 2,
    redraft_phase_open: true,
    banned_moves: ['Move A', 'Move B'],
    banned_items: [],
    tiebreaker_order: ['match_points', 'head_to_head'],
  };
}

type EpbCase = 'row' | 'null' | 'custom';
const EPB_CASES: Record<EpbCase, () => [FormatRules | null, string | null]> = {
  row: () => [epbRow(), RULESET],
  null: () => [null, null],
  custom: () => [customRow(), 'Custom Rules'],
};

const EPB: RulesCopyContext = { format: 'evolution_point_buy', bestOf: 3 };
const SINGLES: RulesCopyContext = { format: 'singles', bestOf: 3 };
/** ChallengeGate.tsx `toneFor(night).brass` — the plaques' and board's brass per mode. */
const BRASS = { light: '#c99a45', dark: '#a8823f' } as const;
/** The plaza `--poke-live` token, light theme (the threshold plate's arrow). */
const LIVE = '#166534';

/**
 * A 2D context that logs every draw call with the state it paints in (font,
 * inks, line width, alignment). Text is measured at 0.55 em per glyph, so the
 * log (and its digest) is deterministic on any machine.
 */
function recordingContext(log: string[]): CanvasRenderingContext2D {
  let gradients = 0;
  const state: Record<string, unknown> = {
    font: '10px sans-serif',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
  const style = (value: unknown) => (typeof value === 'string' ? value : String((value as { id: string }).id));
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 10);
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      log.push(
        `${name}(${args.map((a) => JSON.stringify(a)).join(',')}) font=${String(state.font)} fill=${style(state.fillStyle)} stroke=${style(state.strokeStyle)} lw=${String(state.lineWidth)} align=${String(state.textAlign)} base=${String(state.textBaseline)}`,
      );
    };
  const ctx: Record<string, unknown> = {
    measureText: (text: string) => ({ width: [...String(text)].length * px() * 0.55 }),
    createLinearGradient: (...args: number[]) => {
      const id = `gradient${gradients++}`;
      log.push(`createLinearGradient(${args.join(',')}) -> ${id}`);
      return { id, addColorStop: (o: number, c: string) => log.push(`${id}.addColorStop(${o},${c})`) };
    },
  };
  for (const name of ['fillRect', 'strokeRect', 'fillText', 'beginPath', 'moveTo', 'lineTo', 'arcTo', 'closePath', 'fill', 'stroke']) {
    ctx[name] = rec(name);
  }
  for (const key of Object.keys(state)) {
    Object.defineProperty(ctx, key, {
      get: () => state[key],
      set: (value: unknown) => {
        state[key] = value;
      },
    });
  }
  return ctx as unknown as CanvasRenderingContext2D;
}

type Paint = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function paintLog(paint: Paint, w: number, h: number): string[] {
  const log: string[] = [];
  paint(recordingContext(log), w, h);
  return log;
}

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const paintDigest = (paint: Paint, w: number, h: number) => sha(paintLog(paint, w, h).join('\n'));

/** Every painted string with the px it was painted at. */
function paintedTexts(paint: Paint, w: number, h: number): { text: string; px: number }[] {
  return paintLog(paint, w, h)
    .filter((line) => line.startsWith('fillText('))
    .map((line) => {
      const args = JSON.parse(`[${/^fillText\((.*)\) font=/.exec(line)?.[1] ?? ''}]`) as [string, number, number];
      return { text: args[0], px: Number(/font=\d+ (\d+)px/.exec(line)?.[1]) };
    });
}

function render(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>);
}

/** Visible text of static markup, whitespace squashed. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((match) => match[1].replace(/&amp;/g, '&'));
}

/** EPB-only copy: draft numbers, the defaults notice, evolution / Tera / points. */
const EPB_ONLY = [
  'Draft-Budget',
  'Entwicklungslinien',
  'Entwicklung',
  'Redraft',
  'Drafttoken',
  'Token',
  'Killtoken',
  formatPack.messages.de.paint.gate.label.cosmoPoints,
  'Tera',
  'Punkte',
  'Tiebreaker',
  'Verbotene Attacken',
  'Standardregeln',
  'Standardwerte',
  'Evolution Point Buy',
];

function expectNoEpbCopy(value: string): void {
  for (const phrase of EPB_ONLY) expect(value).not.toContain(phrase);
}

const HUB_HREF = `/leagues/${LEAGUE_ID}?world=plaza&tab=rules#league-hub`;

beforeEach(() => {
  // A plaza visitor who forced the world and tapped the left plaque.
  navigation.search = 'world=plaza&rules=left';
});

// ─── (a) EPB is byte-identical to the captured example-pack output ────────

/** German paint words the expectations below are built from (public messages, not pack values). */
const PAINT_DE = getMessages(paintMessages, 'de');
/** The league's own words and defaults come from the active format pack (the example pack here). */
const PACK_DE = formatPack.messages.de;
const DEFAULTS = epbPack.defaults;

/** The rows and notes `resolveRuleSet` shapes for an EPB row with these numbers. */
function epbSections(v: {
  rulesetName: string;
  budget: number;
  picks: number;
  redraftOpen: boolean;
  tiebreakers: readonly TiebreakerStep[];
  bannedMoves: readonly string[];
  bannedItems: readonly string[];
  ratio: number;
  max: number;
  perLine: number;
}) {
  const tera = epbPack.teraByStage;
  const list = (names: readonly string[]) => (names.length > 0 ? names.join(', ') : PAINT_DE.gate.none);
  return [
    {
      id: 'format',
      heading: 'Format',
      rows: [
        { label: 'Regelwerk', value: v.rulesetName },
        { label: 'Draft-Budget', value: `${v.budget} Punkte` },
        { label: 'Entwicklungslinien', value: String(v.picks) },
        { label: 'Redraft-Phase', value: v.redraftOpen ? 'geöffnet' : 'geschlossen' },
      ],
      note: `Tiebreaker: ${v.tiebreakers.map((step) => PAINT_DE.gate.tiebreaker[step]).join(' → ')}`,
    },
    {
      id: 'klauseln',
      heading: 'Klauseln',
      rows: [
        { label: 'Tera — Stufe 1', value: PAINT_DE.gate.teraRule[tera.stage1] },
        { label: 'Tera — Stufe 2', value: PAINT_DE.gate.teraRule[tera.stage2] },
        { label: 'Tera — Stufe 3', value: PAINT_DE.gate.teraRule[tera.stage3] },
        { label: 'Verbotene Attacken', value: String(v.bannedMoves.length) },
        { label: 'Verbotene Items', value: String(v.bannedItems.length) },
      ],
      note: `Attacken: ${list(v.bannedMoves)} · Items: ${list(v.bannedItems)}`,
    },
    {
      id: 'draft',
      heading: 'Draft-Regeln',
      rows: [
        { label: 'Drafttoken', value: `${v.ratio} Punkte → 1 Token` },
        { label: 'Token je Spieler', value: `max. ${v.max}` },
        { label: 'Token je Linie', value: `max. ${v.perLine}` },
        { label: 'Killtoken', value: PACK_DE.paint.gate.value.shutout },
        { label: PACK_DE.paint.gate.label.cosmoPoints, value: PACK_DE.paint.gate.value.participation },
      ],
    },
  ];
}

/** `resolveRuleSet(<preview row>, 'EvoLiga Standard')`: the preview row carries the pack defaults. */
const EPB_ROW_SECTIONS = epbSections({
  rulesetName: 'EvoLiga Standard',
  budget: DEFAULTS.draftBudget,
  picks: DEFAULTS.draftPicks,
  redraftOpen: false,
  tiebreakers: epbPack.tiebreakerChain,
  bannedMoves: DEFAULTS.bannedMoves,
  bannedItems: DEFAULTS.bannedItems,
  ratio: DEFAULTS.tokenRatio,
  max: DEFAULTS.tokenMax,
  perLine: DEFAULTS.tokenMaxPerLine,
});

/** The same for the configured custom row, named 'Custom Rules'. */
const EPB_CUSTOM_SECTIONS = epbSections({
  rulesetName: 'Custom Rules',
  budget: 150,
  picks: 8,
  redraftOpen: true,
  tiebreakers: ['match_points', 'head_to_head'],
  bannedMoves: ['Move A', 'Move B'],
  bannedItems: [],
  ratio: 4,
  max: 3,
  perLine: 2,
});

const EPB_LEAD = { left: 'Draft-Budget', right: 'Tera — Stufe 1' };
const FOOTER = 'ANTIPPEN FÜR DAS GANZE REGELWERK';

/** SHA-256 of the painted call log, captured under the example pack. */
const EPB_PAINT: Record<EpbCase, Record<keyof typeof BRASS, Record<'left' | 'right' | 'board', string>>> = {
  row: {
    light: {
      left: 'd0c4276b997c910c802614fb5a2ecd2342bc0ec06381309bb0c040451ef6830a',
      right: '27d2513f05ea56963ca1e0f1f663d11720e78ee8311c874667e69ddc25f26af8',
      board: 'cded91e43e9ff6e59e502f74894c5ac738be69346a56cf15bf33789945c55c53',
    },
    dark: {
      left: '4789de65e56aa07b7ab2228baba8778d9f7854be3afbfeaf17aa70711eea1438',
      right: 'd0193c7ce6c04b9d3d8399c638e7eeb2e1ed20abc5d96eb491d01db26b744249',
      board: '3c553700c58ec51849fe5f1a4097d167a18e5ce9086771e93c683a35ffdd49a1',
    },
  },
  null: {
    light: {
      left: 'd0c4276b997c910c802614fb5a2ecd2342bc0ec06381309bb0c040451ef6830a',
      right: '27d2513f05ea56963ca1e0f1f663d11720e78ee8311c874667e69ddc25f26af8',
      board: '3e59ae428588dae4a5685d3f8456b1cc5dad240f09d052b8ee3256d03c9aad3e',
    },
    dark: {
      left: '4789de65e56aa07b7ab2228baba8778d9f7854be3afbfeaf17aa70711eea1438',
      right: 'd0193c7ce6c04b9d3d8399c638e7eeb2e1ed20abc5d96eb491d01db26b744249',
      board: '94b5a107c65b92c27bfdc82996bf36cfc6316ef0ee51697b45ab124685439067',
    },
  },
  custom: {
    light: {
      left: '5e706f2d12a9565d37362fca927f19dfe0f775f5aaa981c56765b69f7053f71c',
      right: '922e4a59b03266f935741f9630e7170a39af08361c64fd9745e1a30539203361',
      board: '0626de43c22566ba16942c018aa79c15dad2bfb7e784c757df31e3f6d491a734',
    },
    dark: {
      left: 'c19d23a371997854d0b3fe52e4e1d1ddd4355daa57d064eacb6f03e6983fd58c',
      right: 'b94a14598fe1fc459592b9a4d36e9c8593bc9fa35f5f9f59a06e8222553ca738',
      board: 'd97f73d7115e31753ec4e2dca7f0f720518457ca137f256c555bf9c13f935baf',
    },
  },
};

/** The 'JETZT DRAFTEN' threshold plate, painted with the light `--poke-live`. */
const EPB_CTA = 'dca06ca9b88712a7dcb962b8a6c5e1136b96274d704190b1179a2d605b58e362';

/**
 * SHA-256 of the `?rules=` panel and Lite #rules markup, captured under the
 * example pack and rendered for a German viewer who keeps Pokémon terms in
 * English (the pre-i18n plaza painted English move and item names).
 * Re-captured 2026-10-18 for the league wording rulings (KOs, "KO-Differenz",
 * the comeback copy that states what is measured, the pack's `rules.passRule`).
 */
const EPB_MARKUP: Record<EpbCase, { left: string; right: string; section: string }> = {
  row: {
    left: 'f5f1067675eef9c01b14a1d9ffbc215677e02fcdeb86d43b3b33947bf76c7bba',
    right: '65653cf07da0e1583b6c81699ad6009e2bafdbafdd530313ef976907fbd0cf0b',
    section: 'ec13ed889a52ab8793386e2977327f894b38b3bef5602174673b55e2e7519ff7',
  },
  null: {
    left: 'bab9c11e37c0d88c00f1480b8905a19b2150d109aedc631b7653844884c9ab8d',
    right: 'e443547b4880348c96afcec3a8042894682b7ab9bdae9d51149929943a64bf08',
    section: '46fdd2ac1fbabcf6e60c906193da3d490ac75b3105bde13194d9c29811ce82be',
  },
  custom: {
    left: 'c022a08ab6147c6205d3a9e07b96c50a53fcd930878368b7c3629656b9105ee4',
    right: '9c1bd07051ddb9beef9359b93be02cb7919668b60995d1e5bcc705f4634a9001',
    section: 'e12fcdf0976246d7df3c8439cb680cebf81912a66511710a4ab916b9339a17a0',
  },
};

const CASE_NAMES = Object.keys(EPB_CASES) as EpbCase[];

describe('EPB shaping (pinned to the active pack defaults)', () => {
  it('the preview row resolves to the same rows, notes and leads', () => {
    expect(resolveRuleSet(epbRow(), RULESET, EPB, 'de')).toStrictEqual({
      rulesetName: RULESET,
      configured: true,
      pointBuy: true,
      formatLabel: 'Evolution Point Buy',
      lead: EPB_LEAD,
      sections: EPB_ROW_SECTIONS,
    });
  });

  it('no row runs the EPB defaults under the format’s own name', () => {
    const sections = structuredClone(EPB_ROW_SECTIONS);
    sections[0].rows[0] = { label: 'Regelwerk', value: 'Evolution Point Buy' };
    expect(resolveRuleSet(null, null, EPB, 'de')).toStrictEqual({
      rulesetName: null,
      configured: false,
      pointBuy: true,
      formatLabel: 'Evolution Point Buy',
      lead: EPB_LEAD,
      sections,
    });
  });

  it('every configured number flows through', () => {
    expect(resolveRuleSet(customRow(), 'Custom Rules', EPB, 'de').sections).toStrictEqual(EPB_CUSTOM_SECTIONS);
  });

  it('the plaques and the passage board keep their pages', () => {
    const set = resolveRuleSet(epbRow(), RULESET, EPB, 'de');
    const pages = plaquePages(set, 'de');
    expect(pages).toStrictEqual({
      left: {
        kicker: 'TAFEL I',
        title: 'FORMAT & DRAFT',
        rows: [...EPB_ROW_SECTIONS[0].rows.slice(1), ...EPB_ROW_SECTIONS[2].rows.slice(0, 2)],
        lead: 'Draft-Budget',
        footer: FOOTER,
      },
      right: {
        kicker: 'TAFEL II',
        title: 'TERA & KLAUSELN',
        rows: EPB_ROW_SECTIONS[1].rows,
        lead: 'Tera — Stufe 1',
        footer: FOOTER,
      },
    });
    expect(fieldBoardPage(set, pages, 'de')).toStrictEqual({
      kicker: 'REGELWERK',
      title: RULESET,
      rows: [...EPB_ROW_SECTIONS[0].rows.slice(1), ...EPB_ROW_SECTIONS[1].rows.slice(0, 3)],
      lead: 'Draft-Budget',
      footer: FOOTER,
    });
    expect(fieldBoardPage(resolveRuleSet(null, null, EPB, 'de'), plaquePages(resolveRuleSet(null, null, EPB, 'de'), 'de'), 'de').title).toBe(
      'Evolution Point Buy',
    );
  });

  it('the best-of never reaches an EPB surface', () => {
    for (const make of Object.values(EPB_CASES)) {
      const [rules, name] = make();
      expect(resolveRuleSet(rules, name, { format: 'evolution_point_buy', bestOf: null }, 'de')).toStrictEqual(
        resolveRuleSet(rules, name, { format: 'evolution_point_buy', bestOf: 5 }, 'de'),
      );
    }
  });
});

describe('EPB painted faces (byte-identical canvas calls)', () => {
  it.each(CASE_NAMES)('%s: both plaques and the passage board, light and dark', (name) => {
    const [rules, rulesetName] = EPB_CASES[name]();
    const set = resolveRuleSet(rules, rulesetName, EPB, 'de');
    const pages = plaquePages(set, 'de');
    const board = fieldBoardPage(set, pages, 'de');
    for (const tone of ['light', 'dark'] as const) {
      const brass = BRASS[tone];
      expect({
        left: paintDigest(paintPlaque(pages.left, brass), PLAQUE_TEX_W, PLAQUE_TEX_H),
        right: paintDigest(paintPlaque(pages.right, brass), PLAQUE_TEX_W, PLAQUE_TEX_H),
        board: paintDigest(
          paintFieldBoard(board.kicker, board.title, board.rows, board.lead, board.footer, brass),
          FIELD_TEX_W,
          FIELD_TEX_H,
        ),
      }).toStrictEqual(EPB_PAINT[name][tone]);
    }
  });

  it('the threshold plate still engraves JETZT DRAFTEN for EPB', () => {
    expect(ctaText('evolution_point_buy', 'de')).toBe(ctaDraftText('de'));
    expect(paintDigest(paintCta(LIVE, ctaDraftText('de')), CTA_TEX_W, CTA_TEX_H)).toBe(EPB_CTA);
    expect(paintDigest(paintCta(LIVE, ctaText('evolution_point_buy', 'de')), CTA_TEX_W, CTA_TEX_H)).toBe(EPB_CTA);
  });
});

describe('EPB DOM surfaces (byte-identical markup)', () => {
  it.each(CASE_NAMES)('%s: the ?rules=left|right panel and the Lite #rules section', (name) => {
    const [rules, rulesetName] = EPB_CASES[name]();
    const panel = (side: 'left' | 'right') =>
      sha(
        renderToStaticMarkup(
          <RulesFocusPanel side={side} formatRules={rules} rulesetName={rulesetName} context={EPB} leagueId={LEAGUE_ID} locale="de" dataLocale="en" />,
        ),
      );
    expect({
      left: panel('left'),
      right: panel('right'),
      section: sha(
        renderToStaticMarkup(
          <RulesSection formatRules={rules} rulesetName={rulesetName} context={EPB} leagueId={LEAGUE_ID} locale="de" dataLocale="en" />,
        ),
      ),
    }).toStrictEqual(EPB_MARKUP[name]);
  });

  it('EvoligaOverlays builds the EPB panels from the league and stages, unchanged', () => {
    const html = overlays(buildPreviewWorld().league.format_type);
    expect(sha(panelOf(html, 'left'))).toBe(EPB_MARKUP.row.left);
    expect(sha(panelOf(html, 'right'))).toBe(EPB_MARKUP.row.right);
    expect(hrefs(html)).not.toContain(HUB_HREF);
  });
});

// ─── (b) Every other format: ruleset, format, best-of, Regeln tab ─────────

const FORMATS: [SeasonFormatType, string][] = [
  ['singles', 'Einzel'],
  ['doubles', 'Doppel'],
  ['draft', 'Draft'],
];

const POINTER_ROWS: RuleRow[] = [
  { label: 'Klauseln', value: 'im Regeln-Tab' },
  { label: 'Verbote', value: 'im Regeln-Tab' },
  { label: 'Eigene Regeln', value: 'im Regeln-Tab' },
];

/** The clause rows without a ruleset: nothing on record, no pointer to a tab that lists none (5B-2). */
const NONE_ROWS: RuleRow[] = [
  { label: 'Klauseln', value: 'nicht hinterlegt' },
  { label: 'Verbote', value: 'nicht hinterlegt' },
  { label: 'Eigene Regeln', value: 'nicht hinterlegt' },
];

describe('non-EPB shaping', () => {
  it.each(FORMATS)('%s: ruleset, format and best-of, whatever row is (or is not) there', (format, label) => {
    for (const rules of [epbRow(), customRow(), null]) {
      const set = resolveRuleSet(rules, RULESET, { format, bestOf: 3 }, 'de');
      expect(set).toStrictEqual({
        rulesetName: RULESET,
        configured: false,
        pointBuy: false,
        formatLabel: label,
        lead: { left: 'Format', right: 'Klauseln' },
        sections: [
          {
            id: 'format',
            heading: 'Format',
            rows: [
              { label: 'Regelwerk', value: RULESET },
              { label: 'Format', value: label },
              { label: 'Best-of', value: '3' },
            ],
          },
          { id: 'klauseln', heading: 'Klauseln', rows: POINTER_ROWS, note: rulesTabNote('de') },
        ],
      });
      expectNoEpbCopy(JSON.stringify(set));
    }
  });

  it('no ruleset name drops the Regelwerk row; no stage drops the best-of', () => {
    const set = resolveRuleSet(epbRow(), null, { format: 'doubles', bestOf: null }, 'de');
    expect(set.sections[0].rows).toStrictEqual([{ label: 'Format', value: 'Doppel' }]);
    expect(set.rulesetName).toBeNull();
  });

  it('no ruleset: the clause rows and note say nothing is on record, in the hub’s own words (5B-2)', () => {
    const set = resolveRuleSet(null, null, SINGLES, 'de');
    expect(set.sections[1]).toStrictEqual({ id: 'klauseln', heading: 'Klauseln', rows: NONE_ROWS, note: rulesNoneNote('de') });
    expect(rulesNoneText('de')).toBe('nicht hinterlegt');
    expect(rulesNoneNote('de')).toBe('Kein Regelwerk zugewiesen. Klauseln, Verbote und eigene Regeln sind nicht hinterlegt.');
    expect(JSON.stringify(set)).not.toContain('im Regeln-Tab');
    expect(JSON.stringify(set)).not.toContain(rulesTabNote('de'));
  });

  it('a stale EPB row on a singles league is ignored', () => {
    expect(resolveRuleSet(epbRow(), RULESET, SINGLES, 'de')).toStrictEqual(resolveRuleSet(null, RULESET, SINGLES, 'de'));
    expect(resolveRuleSet(customRow(), RULESET, SINGLES, 'de')).toStrictEqual(resolveRuleSet(null, RULESET, SINGLES, 'de'));
  });
});

describe('non-EPB plaques, passage board and threshold plate', () => {
  it('Tafel I carries the format rows, Tafel II the Regeln-tab pointers, within the five slots', () => {
    const set = resolveRuleSet(epbRow(), RULESET, SINGLES, 'de');
    const pages = plaquePages(set, 'de');
    expect(pages).toStrictEqual({
      left: {
        kicker: 'TAFEL I',
        title: 'FORMAT',
        rows: [
          { label: 'Regelwerk', value: RULESET },
          { label: 'Format', value: 'Einzel' },
          { label: 'Best-of', value: '3' },
        ],
        lead: 'Format',
        footer: FOOTER,
      },
      right: { kicker: 'TAFEL II', title: 'KLAUSELN & VERBOTE', rows: POINTER_ROWS, lead: 'Klauseln', footer: FOOTER },
    });
    expect(pages.left.rows.length).toBeLessThanOrEqual(PLAQUE_ROWS);
    expect(pages.right.rows.length).toBeLessThanOrEqual(PLAQUE_ROWS);
  });

  it('the board titles the ruleset (else the format) and lists the format and pointers, within six slots', () => {
    const named = resolveRuleSet(epbRow(), RULESET, SINGLES, 'de');
    expect(fieldBoardPage(named, plaquePages(named, 'de'), 'de')).toStrictEqual({
      kicker: 'REGELWERK',
      title: RULESET,
      rows: [{ label: 'Format', value: 'Einzel' }, { label: 'Best-of', value: '3' }, ...POINTER_ROWS],
      lead: 'Format',
      footer: FOOTER,
    });
    const unnamed = resolveRuleSet(null, null, { format: 'draft', bestOf: null }, 'de');
    const board = fieldBoardPage(unnamed, plaquePages(unnamed, 'de'), 'de');
    expect(board.title).toBe('Draft');
    expect(board.rows).toStrictEqual([{ label: 'Format', value: 'Draft' }, ...NONE_ROWS]);
    expect(plaquePages(unnamed, 'de').right.rows).toStrictEqual(NONE_ROWS);
    expect(board.rows.length).toBeLessThanOrEqual(BOARD_ROWS);
  });

  it.each(FORMATS)('%s: the painted faces carry the format and best-of at full size, no EPB copy', (format, label) => {
    const set = resolveRuleSet(epbRow(), RULESET, { format, bestOf: 3 }, 'de');
    const pages = plaquePages(set, 'de');
    const board = fieldBoardPage(set, pages, 'de');
    const left = paintedTexts(paintPlaque(pages.left, BRASS.light), PLAQUE_TEX_W, PLAQUE_TEX_H);
    const right = paintedTexts(paintPlaque(pages.right, BRASS.light), PLAQUE_TEX_W, PLAQUE_TEX_H);
    const field = paintedTexts(
      paintFieldBoard(board.kicker, board.title, board.rows, board.lead, board.footer, BRASS.light),
      FIELD_TEX_W,
      FIELD_TEX_H,
    );

    const leftTexts = left.map((t) => t.text);
    expect(leftTexts).toEqual(expect.arrayContaining(['FORMAT', 'Regelwerk', RULESET, 'Format', label, 'Best-of', '3']));
    expect(right.map((t) => t.text)).toEqual(
      expect.arrayContaining(['KLAUSELN & VERBOTE', 'Klauseln', 'Verbote', 'Eigene Regeln', 'im Regeln-Tab']),
    );
    expect(field.map((t) => t.text)).toEqual(expect.arrayContaining([RULESET, 'Format', label, 'Best-of', 'Eigene Regeln']));
    for (const painted of [left, right, field]) expectNoEpbCopy(painted.map((t) => t.text).join(' | '));

    // The painters' width budgets hold every row at its nominal size (plaque
    // label 28 / value 30 px, board 38 / 42 px), so no row is shrunk.
    for (const row of [...pages.left.rows, ...pages.right.rows]) {
      expect(left.concat(right).find((t) => t.text === row.label)?.px).toBe(28);
      expect(left.concat(right).find((t) => t.text === row.value)?.px).toBe(30);
    }
    for (const row of board.rows) {
      expect(field.find((t) => t.text === row.label)?.px).toBe(38);
      expect(field.find((t) => t.text === row.value)?.px).toBe(42);
    }
  });

  it('a long ruleset name on Tafel I wraps to two lines at the value floor, inside its column (5B-3)', () => {
    const long = 'Core Liga: Hinrunde (NFE Phase) mit Sonderregeln für Doppelkämpfe, Tera und Items';
    const calls = paintLog(paintPlaque(plaquePages(resolveRuleSet(null, long, SINGLES, 'de'), 'de').left, BRASS.light), PLAQUE_TEX_W, PLAQUE_TEX_H)
      .filter((line) => line.startsWith('fillText('))
      .map((line) => {
        const [text, x, y] = JSON.parse(`[${/^fillText\((.*)\) font=/.exec(line)?.[1] ?? ''}]`) as [string, number, number];
        return { text, x, y, px: Number(/font=\d+ (\d+)px/.exec(line)?.[1]) };
      });
    const label = calls.find((call) => call.text === 'Regelwerk');
    if (!label) throw new Error('Tafel I paints no Regelwerk row');
    const valueX = PLAQUE_TEX_W - 74;
    const lines = calls.filter((call) => call.x === valueX && Math.abs(call.y - label.y) < 40);
    expect(lines).toHaveLength(2);
    const labelRight = 74 + label.text.length * label.px * 0.55;
    for (const line of lines) {
      expect(line.px).toBe(PLAQUE_VALUE_MIN_PX);
      const width = [...line.text].length * line.px * 0.55;
      expect(width).toBeLessThanOrEqual(PLAQUE_TEX_W - 320);
      expect(valueX - width).toBeGreaterThan(labelRight);
    }
    expect(long.startsWith(lines[0].text)).toBe(true);
    expect(lines[1].text.endsWith('…')).toBe(true);
    // A name that fits keeps its one full-size line.
    const short = paintedTexts(paintPlaque(plaquePages(resolveRuleSet(null, RULESET, SINGLES, 'de'), 'de').left, BRASS.light), PLAQUE_TEX_W, PLAQUE_TEX_H);
    expect(short.filter((t) => t.text === RULESET)).toStrictEqual([{ text: RULESET, px: 30 }]);
  });

  it('the threshold plate engraves JETZT DRAFTEN for a draft format and JETZT ANTRETEN for singles/doubles', () => {
    expect(ctaText('draft', 'de')).toBe(ctaDraftText('de'));
    expect(ctaText('singles', 'de')).toBe(ctaPlayText('de'));
    expect(ctaText('doubles', 'de')).toBe(ctaPlayText('de'));
    const engraved = paintedTexts(paintCta(LIVE, ctaText('singles', 'de')), CTA_TEX_W, CTA_TEX_H)
      .map((t) => t.text)
      .join('');
    expect(engraved).toBe(ctaPlayText('de'));
  });
});

// ─── (c) Non-EPB ?rules= panel and Lite #rules section ────────────────────

function panelMarkup(side: 'left' | 'right', rules: FormatRules | null, context: RulesCopyContext, name: string | null = RULESET) {
  return render(
    <RulesFocusPanel side={side} formatRules={rules} rulesetName={name} context={context} leagueId={LEAGUE_ID} locale="de" />,
  );
}

function sectionMarkup(rules: FormatRules | null, context: RulesCopyContext, name: string | null = RULESET) {
  return render(<RulesSection formatRules={rules} rulesetName={name} context={context} leagueId={LEAGUE_ID} locale="de" />);
}

describe('non-EPB DOM surfaces', () => {
  it.each(FORMATS)('%s: ruleset, format, best-of and the Regeln-tab link that keeps ?world=', (format, label) => {
    const context = { format, bestOf: 3 };
    for (const html of [panelMarkup('left', epbRow(), context), sectionMarkup(epbRow(), context)]) {
      const body = text(html);
      expectNoEpbCopy(body);
      expect(body).toContain(RULESET);
      expect(body).toMatch(/Regelwerk:? ?EvoLiga Standard/);
      expect(body).toMatch(new RegExp(`Format:? ?${label}`));
      expect(body).toMatch(/Best-of:? ?3/);
      expect(body).toContain(rulesTabNote('de'));
      expect(body).toContain('Zum Regeln-Tab');
      expect(hrefs(html)).toEqual([HUB_HREF]);
    }
  });

  it.each(FORMATS)('%s: the Tafel II panel (titled Klauseln) shows the clause rows Tafel II paints (R11)', (format) => {
    const html = panelMarkup('right', epbRow(), { format, bestOf: 3 });
    const body = text(html);
    expectNoEpbCopy(body);
    expect(body).toBe(
      `Klauseln im Regeln-Tab Verbote im Regeln-Tab Eigene Regeln im Regeln-Tab ${rulesTabNote('de')} Zum Regeln-Tab`,
    );
    // The tapped plaque's lead row is the selected one, as on the stone face.
    expect(html).toMatch(/bg-white text-teal-950"><span class="min-w-0 font-medium">Klauseln</);
    expect(hrefs(html)).toEqual([HUB_HREF]);
  });

  it('no ruleset: no pointer to clauses the Regeln tab does not list (5B-2)', () => {
    for (const html of [panelMarkup('left', null, SINGLES, null), panelMarkup('right', null, SINGLES, null), sectionMarkup(null, SINGLES, null)]) {
      const body = text(html);
      expect(body).toContain(rulesNoneNote('de'));
      expect(body).not.toContain(rulesTabNote('de'));
      expect(body).not.toContain('im Regeln-Tab');
    }
    expect(text(panelMarkup('right', null, SINGLES, null))).toContain('Klauseln nicht hinterlegt');
  });

  it('a stale EPB row on a singles league renders exactly what no row does', () => {
    for (const side of ['left', 'right'] as const) {
      expect(panelMarkup(side, epbRow(), SINGLES)).toBe(panelMarkup(side, null, SINGLES));
      expect(panelMarkup(side, customRow(), SINGLES)).toBe(panelMarkup(side, null, SINGLES));
    }
    expect(sectionMarkup(epbRow(), SINGLES)).toBe(sectionMarkup(null, SINGLES));
  });

  it('each plaque opens its own page; no ruleset name or stage leaves those rows out', () => {
    expect(panelMarkup('right', null, SINGLES)).not.toBe(panelMarkup('left', null, SINGLES));
    expect(text(panelMarkup('left', null, SINGLES))).toContain('Format Einzel');
    expect(text(panelMarkup('right', null, SINGLES))).not.toContain('Einzel');
    const body = text(sectionMarkup(null, { format: 'doubles', bestOf: null }, null));
    expect(body).toContain('Format: Doppel');
    expect(body).not.toContain('Best-of');
    expect(body).not.toMatch(/Regelwerk:/);
  });

  it('on the route tier the link is the Lite exit (a plain anchor), keeping the world', () => {
    const state = {
      tier: 'route',
      theme: { focusVocabulary: { kinds: [], panelParams: ['team', 'mon', 'board', 'rules'] } },
    } as unknown as WorldStateValue;
    navigation.search = 'world=plaza&rules=right&board=pulse&routeDebug=1';
    const html = render(
      createElement(WorldStateContext.Provider, { value: state }, panelMarkupNode('right', SINGLES)),
    );
    expect(hrefs(html)).toEqual([`/leagues/${LEAGUE_ID}?world=plaza&tier=lite&tab=rules#league-hub`]);
    expect(html).not.toContain('data-soft');
  });

  it('EvoligaOverlays builds the non-EPB panels from a singles league carrying the stale row', () => {
    const html = overlays('singles');
    for (const side of ['left', 'right'] as const) expectNoEpbCopy(text(panelOf(html, side)));
    const left = text(panelOf(html, 'left'));
    expect(left).toContain('Format Einzel');
    expect(left).toContain('Best-of 3');
    expect(text(panelOf(html, 'right'))).toContain('Klauseln im Regeln-Tab');
    expect(hrefs(html)).toEqual([HUB_HREF, HUB_HREF]);
  });
});

function panelMarkupNode(side: 'left' | 'right', context: RulesCopyContext) {
  return <RulesFocusPanel side={side} formatRules={epbRow()} rulesetName={RULESET} context={context} leagueId={LEAGUE_ID} locale="de" />;
}

/** EvoligaOverlays over the plaza preview (stale row kept), the league moved to `format`. */
function overlays(format: SeasonFormatType): string {
  const world = buildPreviewWorld();
  return render(
    <EvoligaOverlays
      league={{ ...world.league, format_type: format }}
      stages={world.stages}
      participants={world.participants}
      trackers={world.trackers}
      entries={world.entries}
      standings={world.standings}
      fixtures={world.fixtures}
      formatRules={world.formatRules}
      rulesetName={buildPreviewRoute().rulesetName}
      locale="de"
      dataLocale="en"
    />,
  );
}

/** The rules panel body the mocked OverlaySwitch rendered for `value`. */
function panelOf(html: string, value: 'left' | 'right'): string {
  const start = `<i data-start="${value}"></i>`;
  const from = html.indexOf(start);
  const to = html.indexOf(`<i data-end="${value}"></i>`);
  if (from < 0 || to < from) throw new Error(`no ${value} rules panel in ${html.slice(0, 200)}`);
  return html.slice(from + start.length, to);
}

// ─── (d) The rules station card's digest fact ─────────────────────────────

describe('plaza station card rules fact', () => {
  it('reports the draft budget for EPB only, never from a stale row on another format', () => {
    const route = buildPreviewRoute();
    expect(stationDigestFacts(route).rules).toStrictEqual({
      rulesetName: RULESET,
      draftBudget: DEFAULTS.draftBudget,
      format: 'evolution_point_buy',
    });
    if (!route.league) throw new Error('the plaza preview carries a league row');
    const singles = { ...route, league: { ...route.league, format_type: 'singles' as const } };
    const facts = stationDigestFacts(singles);
    expect(facts.rules).toStrictEqual({ rulesetName: RULESET, draftBudget: null, format: 'singles' });
    expect(formatStationDigest('rulesHeadline', facts, 'de')).toBe(`Regelwerk: ${RULESET}`);
  });

  it('without a ruleset, names the format and the hub’s notice off EPB, never league default rules (5B-1)', () => {
    const route = buildPreviewRoute();
    if (!route.league) throw new Error('the plaza preview carries a league row');
    const unnamed = { ...route, rulesetName: null, league: { ...route.league, format_type: 'singles' as const } };
    const facts = stationDigestFacts(unnamed);
    expect(formatStationDigest('rulesHeadline', facts, 'de')).toBe('Einzel · Kein Regelwerk zugewiesen');
    expect(formatStationDigest('rulesHeadline', facts, 'en')).toBe('Singles · No ruleset assigned');
    // EPB without a row really does run its default rules.
    const epb = { ...route, rulesetName: null, formatRules: null };
    expect(formatStationDigest('rulesHeadline', stationDigestFacts(epb), 'de')).toBe('Liga-Standardregeln');
  });
});

// ─── (e) docs/worlds.md states what the code does ─────────────────────────

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** docs/worlds.md's EvoLiga plaza rules paragraph, whitespace squashed. */
function plazaDoc(): string {
  const doc = read('docs/worlds.md').replace(/\r\n/g, '\n');
  const from = doc.indexOf('The German EvoLiga plaza follows the same rule');
  const to = doc.indexOf('\n\n', from);
  if (from < 0 || to < from) throw new Error('docs/worlds.md lost its EvoLiga plaza rules paragraph');
  return doc.slice(from, to).replace(/\s+/g, ' ');
}

const worldParams = (source: string) => [...source.matchAll(/\?world=([a-z0-9]+)/g)].map((match) => match[1]);

/** No admin pin: only a `?world=` naming the plaza's route theme puts it there. */
const UNPINNED_SINGLES = { format_type: 'singles', route_theme: null } as const;

describe('docs/worlds.md and the plaza fixtures', () => {
  it('every ?world= they name puts an unpinned singles league on the plaza', () => {
    const doc = worldParams(plazaDoc());
    const section = worldParams(read('src/components/world/evoliga/RulesSection.tsx'));
    expect(doc).not.toHaveLength(0);
    expect(section).not.toHaveLength(0);
    const fixtures = [
      new URLSearchParams(navigation.search).get('world'),
      new URLSearchParams(HUB_HREF.split('?')[1].split('#')[0]).get('world'),
    ];
    for (const value of [...doc, ...section, ...fixtures]) {
      expect(resolveViewerWorld(UNPINNED_SINGLES, value).id).toBe('evoliga');
    }
    // The world id is not its route theme: `?world=evoliga` keeps the sakura park.
    expect(resolveViewerWorld(UNPINNED_SINGLES, 'evoliga').id).toBe('sakura');
  });

  it('the non-EPB plaque and board row counts are the ones the painters lay out', () => {
    const epb = resolveRuleSet(epbRow(), RULESET, EPB, 'de');
    const epbPages = plaquePages(epb, 'de');
    const counts = { left: new Set<number>(), right: new Set<number>(), board: new Set<number>() };
    for (const [format] of FORMATS) {
      for (const name of [RULESET, null]) {
        for (const bestOf of [3, null]) {
          const set = resolveRuleSet(epbRow(), name, { format, bestOf }, 'de');
          const pages = plaquePages(set, 'de');
          counts.left.add(pages.left.rows.length);
          counts.right.add(pages.right.rows.length);
          counts.board.add(fieldBoardPage(set, pages, 'de').rows.length);
        }
      }
    }
    const range = (values: Set<number>) => {
      const [min, max] = [Math.min(...values), Math.max(...values)];
      return min === max ? `${min}` : `${min}–${max}`;
    };
    expect(plazaDoc()).toContain(
      `paints ${range(counts.left)} plaque rows instead of ${epbPages.left.rows.length} on Tafel I, ` +
        `${range(counts.right)} instead of ${epbPages.right.rows.length} on Tafel II, ` +
        `and ${range(counts.board)} board rows instead of ${fieldBoardPage(epb, epbPages, 'de').rows.length}`,
    );
  });
});

// ─── (f) The #rules token economy uses the spec names (draft-frontend §8.3) ──

describe('EPB #rules token economy (T19, draft-frontend §8.3)', () => {
  const section = (locale: 'de' | 'en') =>
    text(
      render(
        <RulesSection formatRules={epbRow()} rulesetName={RULESET} context={EPB} leagueId={LEAGUE_ID} locale={locale} />,
      ),
    );

  /** A pack rule sentence as the section renders it: `<b>{token}:</b>` -> `token:`, `{line}` named. */
  const rule = (template: string, token: string, line = '') =>
    template.replace('<b>{token}:</b>', `${token}:`).replace('{line}', line);
  const participation = participationLineBase();

  it('German: glossary token names, the pack comeback rule, participation tokens per matchday', () => {
    const body = section('de');
    const pack = formatPack.messages.de;
    expect(body).toContain('Draft-Kill-Token:');
    expect(body).toContain(rule(pack.worldEvoliga.rules.comebackRule, pack.glossary.token.comeback));
    if (!participation) throw new Error('the example pack has a participation line');
    expect(body).toContain(
      rule(pack.worldEvoliga.rules.cosmoRule, pack.glossary.token.cosmo, localizeSpecies(participation, 'de')),
    );
    expect(body).toContain('Regelwerk');
  });

  it('English: the same rules in English for an English viewer', () => {
    const body = section('en');
    expect(body).toContain('Draft Kill Token:');
    const pack = formatPack.messages.en;
    expect(body).toContain(rule(pack.worldEvoliga.rules.comebackRule, pack.glossary.token.comeback));
    if (!participation) throw new Error('the example pack has a participation line');
    expect(body).toContain(rule(pack.worldEvoliga.rules.cosmoRule, pack.glossary.token.cosmo, participation));
    expect(body).toContain('Budget & draft');
    expect(body).not.toMatch(/Verbotene|Spieltag/);
  });

  it('names banned moves and items in the viewer’s Pokémon-data language', () => {
    const rules = epbRow();
    const move = rules.banned_moves[0];
    expect(move).toBeDefined();
    expect(section('de')).toContain(`Verbotene Attacken: ${localizeMove(move, 'de')}`);
    expect(section('en')).toContain(`Banned moves: ${move}`);
  });

  it.each(['de', 'en'] as const)('%s: no legacy token words and no Cosmog 2:1 rule', (locale) => {
    const body = section(locale);
    expect(body).not.toMatch(/Killtoken|Drafttoken|Cosmo-Punkte|Cosmo Points|Shutout|2:1/);
    expect(body).not.toMatch(/(?<!Draft )\bKill ?Token\b/);
  });
});
