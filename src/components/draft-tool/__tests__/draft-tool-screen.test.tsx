import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import { runFinder } from '@/lib/draft-finder/engine';
import { EMPTY_FILTERS, initialFinderState, type FinderViewState } from '@/lib/draft-finder/filter-types';
import { prepareIndex } from '@/lib/draft-finder/prepare';
import { BANNED, buildFixtureCatalog, buildFixtureIndex, stubNames } from '@/lib/draft-finder/__tests__/fixture-index';
import { computeClock } from '@/lib/draft-ui/clock';
import { toDraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { DraftSnapshotDTO } from '@/lib/draft-ui/snapshot-types';
import { DAWN, MISTY, snapshot } from '@/lib/draft-ui/__tests__/fixtures';
import DraftToolScreen, { type DraftToolScreenProps } from '../DraftToolScreen';
import DraftToast from '../feedback/DraftToast';
import { NOTIFY_UNSUPPORTED } from '../hooks/use-turn-watch';
import { ctaStateOf } from '../left/cta-state';
import styles from '../draft-tool.module.css';

const catalog = buildFixtureCatalog();
const ix = prepareIndex(buildFixtureIndex(), stubNames);
const noop = () => {};

function props(dto: DraftSnapshotDTO, view: FinderViewState = initialFinderState({ pinnedLineId: 'gastly--gengar' })): DraftToolScreenProps {
  const vm = toDraftViewModel(dto, catalog);
  return {
    vm,
    catalog,
    finder: runFinder({ ix, catalog, view, taken: dto.taken, favorites: new Set(), dataLocale: 'en', names: stubNames, banned: BANNED }),
    view,
    dispatch: noop,
    favorites: new Set(),
    clock: computeClock(vm.activeSlot, vm.serverNow),
    notify: NOTIFY_UNSUPPORTED,
    onNotifyToggle: noop,
    onDraft: noop,
    onExtension: noop,
    onToggleFavorite: noop,
    onAdminOverride: noop,
    adminOverride: false,
    links: { redraft: '/leagues/s/redraft', tokens: '/leagues/s/tokens', admin: null, adminAudit: null, trainerCreator: '/draft-room/trainer-creator' },
    ix,
    weaknessStage: 'final',
    onWeaknessStage: noop,
    makeupSeconds: 150,
  };
}

function paused(): DraftSnapshotDTO {
  const base = snapshot();
  return snapshot({
    pool: { ...base.pool, paused: true, paused_at: '2026-10-09T12:00:00.000Z', pause_reason: 'admin' },
    active_slot: base.active_slot ? { ...base.active_slot, deadline_at: null, remaining_ms_at_pause: 83_000 } : null,
  });
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A `class="…"` attribute holding the (hashed) CSS-module class `name`. */
const cls = (name: string) => `class="(?:[^"]* )?${esc(name)}(?: [^"]*)?"`;

/** The text of every element whose class list contains the CSS-module class `caps`. */
function capsTexts(html: string): string[] {
  const re = new RegExp(`<[a-z]+ [^>]*${cls(styles.caps)}[^>]*>([^<]*)<`, 'g');
  return [...html.matchAll(re)].map((m) => m[1]);
}

const KILL_TOKEN = /(?<!Draft[ -])Kill[ -]?Token/i;

describe('DraftToolScreen', () => {
  it('renders the on-clock banner in caps, the pinned line and its draftability reason (EN)', () => {
    const html = renderWithI18n(<DraftToolScreen {...props(snapshot())} />);
    expect(capsTexts(html)).toContain('You are on the clock');
    expect(html).toContain('Round 2 · Pick 3');
    expect(html).toContain('Already drafted by Misty.');
    expect(html).toContain('Misty');
    expect(html).toContain('Next: Misty');
    expect(html).toContain('My roster (1/9)');
    expect(html).not.toMatch(KILL_TOKEN);
  });

  it('renders the same screen in German', () => {
    const html = renderWithI18n(<DraftToolScreen {...props(snapshot())} />, { locale: 'de' });
    expect(capsTexts(html)).toContain('Du bist am Zug');
    expect(html).toContain('Runde 2 · Pick 3');
    expect(html).toContain('Bereits von Misty gedraftet.');
    expect(html).toContain('Danach: Misty');
    expect(html).not.toMatch(KILL_TOKEN);
  });

  it('shows "Draft paused" in caps with the frozen time, in both languages', () => {
    const en = renderWithI18n(<DraftToolScreen {...props(paused())} />);
    expect(capsTexts(en)).toContain('Draft paused');
    expect(en).toContain('1:23');
    const de = renderWithI18n(<DraftToolScreen {...props(paused())} />, { locale: 'de' });
    expect(capsTexts(de)).toContain('Draft pausiert');
  });

  it('keeps the DRAFT button enabled for an available line on the viewer’s turn, with the CTA label in caps', () => {
    const html = renderWithI18n(<DraftToolScreen {...props(snapshot(), initialFinderState({ pinnedLineId: 'oshawott--samurott' }))} />);
    expect(capsTexts(html)).toContain('Draft');
    expect(html).toMatch(new RegExp(`<button type="button" ${cls(styles.cta)}><span ${cls(styles.caps)}>Draft</span>`));
    expect(html).toContain('Remaining after pick:');
  });

  it('greys the button with a viewer-level reason when it is not the viewer’s turn', () => {
    const dto = snapshot({ viewer: { ...snapshot().viewer, player_id: MISTY, pick_block: { code: 'NOT_YOUR_TURN' } } });
    const html = renderWithI18n(<DraftToolScreen {...props(dto, initialFinderState({ pinnedLineId: 'oshawott--samurott' }))} />);
    expect(html).toContain('It is not your turn.');
    expect(html).toMatch(new RegExp(`<button type="button" disabled="" aria-describedby="[^"]+" ${cls(styles.cta)}>`));
    expect(capsTexts(html)).not.toContain('You are on the clock');
  });

  it('asks for a selection when nothing is pinned', () => {
    const html = renderWithI18n(<DraftToolScreen {...props(snapshot(), initialFinderState())} />);
    expect(html).toContain('Select a line first.');
    expect(html).toContain('Select a line on the wall to see it here.');
  });

  it('renders in English without an i18n provider', () => {
    const html = renderToStaticMarkup(<DraftToolScreen {...props(snapshot())} />);
    expect(capsTexts(html)).toContain('You are on the clock');
    expect(html).toContain('Already drafted by Misty.');
  });

  it('shows the spectator note for a signed-out viewer', () => {
    const dto = snapshot({ viewer: { ...snapshot().viewer, player_id: null, is_participant: false, pick_block: { code: 'SIGNED_OUT' } } });
    const html = renderWithI18n(<DraftToolScreen {...props(dto)} />, { locale: 'de' });
    expect(html).toContain('Du schaust als Gast zu.');
    expect(html).toMatch(/<a [^>]*href="\/auth\/signin"[^>]*>Anmelden<\/a>/);
  });

  it('links every visible disabled reason to its DRAFT button, including the phone bottom bar', () => {
    const dto = snapshot({ viewer: { ...snapshot().viewer, player_id: MISTY, pick_block: { code: 'NOT_YOUR_TURN' } } });
    const html = renderWithI18n(<DraftToolScreen {...props(dto, initialFinderState({ pinnedLineId: 'oshawott--samurott' }))} />);
    const ids = [...html.matchAll(/<button type="button" disabled="" aria-describedby="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(html).toMatch(new RegExp(`<p id="${esc(id)}"[^>]*>It is not your turn.</p>`));
  });

  it('docks cost, DRAFT and the admin switch outside the card; only the stage DRAFT button hides on phones', () => {
    const dto = snapshot({
      viewer: { ...snapshot().viewer, player_id: MISTY, is_pool_admin: true, pick_block: { code: 'NOT_YOUR_TURN' }, active_player_line_status: {} },
    });
    const html = renderWithI18n(<DraftToolScreen {...props(dto, initialFinderState({ pinnedLineId: 'oshawott--samurott' }))} />);
    // The dock follows the card, so `sticky` is bounded by the whole left column (§5.3).
    expect(html).toMatch(new RegExp(`</section><div ${cls(styles.ctaDock)}>`));
    // `.stageCta` (display: none below 768 px) sits on the DRAFT button's wrapper only.
    expect(html.split(styles.stageCta)).toHaveLength(2);
    expect(html).toMatch(new RegExp(`<div ${cls(styles.stageCta)}><button`));
    expect(html).toMatch(/<input type="checkbox" role="switch"/);
    expect(html).not.toContain(styles.ctaDockPhoneEmpty);
  });

  it('shows the price once in the left column (the info box title) and not on the DRAFT dock or the phone bar', () => {
    const html = renderWithI18n(<DraftToolScreen {...props(snapshot(), initialFinderState({ pinnedLineId: 'oshawott--samurott' }))} />);
    // The stage card and the dock, up to the roster/picks/compare column (which lists prices of other lines).
    const stage = html.slice(html.indexOf(styles.stageCard), html.indexOf(styles.extras));
    expect(stage.match(/(?<!\d)14 P/g)).toHaveLength(1);
    expect(stage).toMatch(/<h2[^>]*>Oshawott \(14 P\)<\/h2>/);
    expect(stage).toContain('Remaining after pick: 136 P');
    const bar = html.slice(html.search(new RegExp(cls(styles.bottomBar))));
    expect(bar).toContain('Remaining after pick: 136 P');
    expect(bar).not.toMatch(/(?<!\d)14 P/);
  });

  it('names the player whose budget it is when an admin picks on behalf', () => {
    const dto = snapshot({
      viewer: { ...snapshot().viewer, player_id: MISTY, is_pool_admin: true, pick_block: { code: 'NOT_YOUR_TURN' }, active_player_line_status: {} },
    });
    const view = initialFinderState({ pinnedLineId: 'oshawott--samurott' });
    const own = renderWithI18n(<DraftToolScreen {...props(dto, view)} />);
    expect(own).not.toContain('Remaining for');
    const admin = renderWithI18n(<DraftToolScreen {...props(dto, view)} adminOverride />);
    expect(admin.match(/Remaining for Dawn after pick: 136 P/g)).toHaveLength(2);
    const de = renderWithI18n(<DraftToolScreen {...props(dto, view)} adminOverride />, { locale: 'de' });
    expect(de).toContain('Restbudget von Dawn nach dem Pick: 136 P');
  });

  it('hides the dock on phones when it would hold only the budget line the bottom bar already shows', () => {
    const view = initialFinderState({ pinnedLineId: 'oshawott--samurott' });
    // Available line, plain player: nothing but the budget (and the hidden DRAFT button) is in the dock.
    expect(renderWithI18n(<DraftToolScreen {...props(snapshot(), view)} />)).toContain(styles.ctaDockPhoneEmpty);
    // A line-level verdict next to a different viewer-level reason keeps it.
    const dto = snapshot({ viewer: { ...snapshot().viewer, player_id: MISTY, pick_block: { code: 'NOT_YOUR_TURN' } } });
    const taken = renderWithI18n(<DraftToolScreen {...props(dto, initialFinderState({ pinnedLineId: 'gastly--gengar' }))} />);
    expect(taken).not.toContain(styles.ctaDockPhoneEmpty);
  });

  it('keeps the team weakness overview collapsed inside the roster section, for a seated viewer with a line', () => {
    const html = renderWithI18n(<DraftToolScreen {...props(snapshot())} />);
    const opening = /<details([^>]*)><summary [^>]*>Team weaknesses<\/summary>/.exec(html);
    expect(opening).not.toBeNull();
    expect(opening![1]).not.toContain('open');
    // It lives in the roster's section: after the roster tiles, before the last picks. The phone toggles stay
    // the three pinned below (it is not a section of its own).
    expect(html.indexOf('Team weaknesses')).toBeGreaterThan(html.indexOf('My roster (1/9)'));
    expect(html.indexOf('Team weaknesses')).toBeLessThan(html.indexOf('Last picks'));
    expect(renderWithI18n(<DraftToolScreen {...props(snapshot())} />, { locale: 'de' })).toContain('Team-Schwächen');
  });

  it('has no team weakness overview without a roster: spectators, and viewers who own no line', () => {
    const guest = snapshot({ viewer: { ...snapshot().viewer, player_id: null, is_participant: false, pick_block: { code: 'SIGNED_OUT' } } });
    expect(renderWithI18n(<DraftToolScreen {...props(guest)} />)).not.toContain('Team weaknesses');
    expect(renderWithI18n(<DraftToolScreen {...props(snapshot({ taken: {} }))} />)).not.toContain('Team weaknesses');
  });

  it('hides the overview when the index failed and shows a loading line while it loads', () => {
    const failed = renderWithI18n(<DraftToolScreen {...props(snapshot())} ix={null} indexFailed />);
    expect(failed).not.toContain('Team weaknesses');
    const loading = renderWithI18n(<DraftToolScreen {...props(snapshot())} ix={null} />);
    expect(loading).toContain('Team weaknesses');
    expect(loading).toContain('Loading types …');
  });

  it('puts the stale and spectator notices in one slim status strip above the info box', () => {
    const dto = snapshot({ viewer: { ...snapshot().viewer, player_id: null, is_participant: false, pick_block: { code: 'SIGNED_OUT' } } });
    const html = renderWithI18n(<DraftToolScreen {...props(dto)} stale />);
    const strip = html.indexOf('Connection lost');
    expect(strip).toBeGreaterThan(0);
    expect(html.indexOf('You are watching as a guest')).toBeGreaterThan(strip);
    expect(html.indexOf('<h2')).toBeGreaterThan(html.indexOf('You are watching as a guest'));
    expect(html).not.toMatch(/<p[^>]*rounded-lg border[^>]*>(?:<svg[^>]*><\/svg>)?(?:Connection lost|You are)/);
    expect(renderWithI18n(<DraftToolScreen {...props(snapshot())} />)).not.toContain('Connection lost');
  });

  it('says "not in the current price tab" only when the tab hides a matching line', () => {
    const ghost = { ...EMPTY_FILTERS, types: { ids: ['Ghost'] as never[], match: 'any' as const } };
    const base = initialFinderState({ pinnedLineId: 'gastly--gengar' });
    // Gengar (29 P) is drafted by Misty: with "show drafted" off it is hidden for that reason, not by the tab.
    const drafted = renderWithI18n(<DraftToolScreen {...props(snapshot(), { ...base, filters: ghost, showDrafted: false })} />);
    expect(drafted).not.toContain('Not in the current price tab');
    expect(drafted).toContain('Why this line matches');
    const otherTab = renderWithI18n(<DraftToolScreen {...props(snapshot(), { ...base, filters: ghost, tab: '9-1' })} />);
    expect(otherTab).toContain('Not in the current price tab');
  });

  it('explains the pinned line like the hover popover: the Pokémon it holds on, no stage numbers', () => {
    const filters = { ...EMPTY_FILTERS, utility: [{ key: 'hazards' as const, members: [] }] };
    const view = { ...initialFinderState({ pinnedLineId: 'oshawott--samurotthisui' }), filters };
    const en = renderWithI18n(<DraftToolScreen {...props(snapshot(), view)} />);
    expect(en).toContain('Hazards ✓');
    expect(en).toContain('Spikes, from Samurott-Hisui');
    expect(en).not.toMatch(/from Stage \d/);
    const de = renderWithI18n(<DraftToolScreen {...props(snapshot(), view)} />, { locale: 'de' });
    expect(de).toMatch(/Stachler, ab \S+/);
    expect(de).not.toMatch(/ab Stufe \d/);
  });

  it('evaluates compared lines that have no row in the current tab', () => {
    const ghost = { ...EMPTY_FILTERS, types: { ids: ['Ghost'] as never[], match: 'any' as const } };
    const view = { ...initialFinderState({ pinnedLineId: 'gastly--gengar' }), filters: ghost, tab: '9-1' as const, compareLineIds: ['gastly--gengar'] };
    const html = renderWithI18n(<DraftToolScreen {...props(snapshot(), view)} />);
    expect(html).toContain(' ✓');
    expect(html).not.toContain(' ✕');
  });

  it('collapses the order strip into a "Next 5" row in the clock bar for tablets (§5.3)', () => {
    const html = renderWithI18n(<DraftToolScreen {...props(snapshot())} />);
    expect(html).toMatch(new RegExp(`<div ${cls(styles.nextFive)}><span[^>]*>Next 5:</span><ol `));
    // The single "Next:" label is the one hidden at tablet width.
    expect(html).toMatch(new RegExp(`<span ${cls(styles.nextSingle)}[^>]*>Next: Misty</span>`));
    const de = renderWithI18n(<DraftToolScreen {...props(snapshot())} />, { locale: 'de' });
    expect(de).toContain('Nächste 5:');
  });

  it('gives phones the compact timer and collapsible sections, and one responsive line preview (§5.3 items 1, 3, 8)', () => {
    const html = renderWithI18n(<DraftToolScreen {...props(snapshot())} />);
    expect(html).toContain(styles.timerTrackCompact);
    // One instance for every width: no second, compact copy of the sprites and no wide/phone wrappers around it.
    expect(html.split(styles.previewStage)).toHaveLength(2);
    expect(html).not.toMatch(new RegExp(`<div ${cls(styles.phoneOnly)}><ol `));
    expect(html).not.toMatch(new RegExp(`<div ${cls(styles.wideOnly)}><ol `));
    const toggles = [...html.matchAll(new RegExp(`<button type="button" ${cls(styles.phoneToggle)} aria-expanded="true" aria-controls="[^"]+"><span[^>]*>([^<]+)</span>`, 'g'))].map(
      (m) => m[1],
    );
    expect(toggles).toEqual(['Selected line', 'My roster (1/9)', 'Last picks']);
  });

  it('always renders the chip row with the match count once, also before the index loads', () => {
    const loading = renderWithI18n(<DraftToolScreen {...props(snapshot())} finder={null} ix={null} />);
    expect(loading).toContain('No filters');
    expect(loading.split(`>${catalog.lines.length} lines<`)).toHaveLength(2);
    const view = { ...initialFinderState(), filters: { ...EMPTY_FILTERS, maxPrice: 20 } };
    const filtered = renderWithI18n(<DraftToolScreen {...props(snapshot(), view)} />);
    expect(filtered).not.toContain('No filters');
    expect(filtered).toContain('≤20 P');
    expect(filtered).toContain('Filters (1)');
    expect(filtered.match(/\d+ lines?</g)).toHaveLength(1);
  });

  it('gives the toast stack the draft tokens without the screen root', () => {
    const html = renderWithI18n(<DraftToast toasts={[{ id: 1, tone: 'info', message: { kind: 'yourTurn' } }]} onDismiss={noop} />);
    expect(html).toMatch(new RegExp(`<div ${cls(styles.tokens)}`));
    expect(html).toContain(styles.toastStack);
    expect(html).not.toContain(styles.root);
  });
});

describe('ctaStateOf', () => {
  const vm = toDraftViewModel(snapshot(), catalog);

  it('is enabled for an available line on the viewer’s turn and reports the remaining budget', () => {
    const cta = ctaStateOf(vm, { lineId: 'oshawott--samurott', price: 20 }, false);
    expect(cta).toMatchObject({ variant: 'player', enabled: true, block: null, remainingAfter: 130 });
  });

  it('blocks a taken line with LINE_TAKEN naming the owner', () => {
    const cta = ctaStateOf(vm, { lineId: 'gastly--gengar', price: 28 }, false);
    expect(cta.enabled).toBe(false);
    expect(cta.block).toEqual({ kind: 'reason', reason: { code: 'LINE_TAKEN', params: { player_id: MISTY } } });
  });

  it('keeps the viewer-level reason on the button and the line-level reason beside the cost', () => {
    const notMine = toDraftViewModel(
      snapshot({ viewer: { ...snapshot().viewer, player_id: MISTY, pick_block: { code: 'NOT_YOUR_TURN' } } }),
      catalog,
    );
    const cta = ctaStateOf(notMine, { lineId: 'gastly--gengar', price: 28 }, false);
    expect(cta.block).toEqual({ kind: 'reason', reason: { code: 'NOT_YOUR_TURN' } });
    expect(cta.lineReason?.code).toBe('LINE_TAKEN');
  });

  it('switches to the admin variant for a pool admin who is not on the clock', () => {
    const dto = snapshot({
      viewer: { ...snapshot().viewer, player_id: MISTY, is_pool_admin: true, pick_block: { code: 'NOT_YOUR_TURN' }, active_player_line_status: {} },
    });
    const admin = toDraftViewModel(dto, catalog);
    const cta = ctaStateOf(admin, { lineId: 'oshawott--samurott', price: 20 }, true);
    expect(cta).toMatchObject({ variant: 'admin', enabled: true, target: { playerId: DAWN, name: 'Dawn' }, remainingAfter: 130 });
  });

  it('never enables a pick while the draft is paused', () => {
    const cta = ctaStateOf(toDraftViewModel(paused(), catalog), { lineId: 'oshawott--samurott', price: 20 }, false);
    expect(cta.block).toEqual({ kind: 'reason', reason: { code: 'DRAFT_PAUSED' } });
  });
});
