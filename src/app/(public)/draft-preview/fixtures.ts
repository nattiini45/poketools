/**
 * `/draft-preview` scenarios (draft-frontend §11.1, DF3). Deterministic draft
 * states over the example pack's synthetic list (`fixture-lines.example.json`,
 * written by `scripts/draft/make-example-list-fixtures.ts`), anchored to the
 * request's "now" so clocks and deadlines are live. Server only in practice (the
 * page builds the scenario and hands the client JSON); no Supabase, no network.
 *
 * The list is always the example list; the numbers (budget, roster size, redraft
 * and token limits, comeback table) come from the active format pack
 * (`@/lib/format-pack`), and the roster size is capped so the eight fixture
 * players can always fill their rosters from the list.
 *
 * Players are fixture names; the viewer is Dawn unless a scenario says
 * otherwise. Dev-only data, allowlisted for `check-i18n-strings` (critique
 * F16). The picker copy is product UI and lives in `draft/screen` `preview.*`.
 */
import { EMPTY_FILTERS, type FinderFilters } from '@/lib/draft-finder/filter-types';
import type {
  AdminPoolSummary,
  AdminSubmissionDTO,
  AuditEntryDTO,
  DraftRecentEvent,
  DraftSnapshotDTO,
  DraftSnapshotParticipant,
  DraftSnapshotPick,
  DraftUpcomingSlot,
  LineId,
  RedraftSubmissionDTO,
  SlotKind,
  TokenOverviewDTO,
} from '@/lib/draft-ui/snapshot-types';
import { DEFAULT_DRAFT_CONFIG } from '@/lib/draft-ui/snapshot-types';
import type { DraftAdminRedraftSlot } from '@/types/draft-queue';
import type { RoomAdminTab } from '@/components/draft-admin/RoomAdminSheet';
import { comebackEarnWindow, comebackTokensPerProgress, epbPack, lineOverrideFor } from '@/lib/format-pack';
import type { PointBuyListEntry } from '@/types/point-buy';
import rawLines from './fixture-lines.example.json';
import { advanceSlot, UPCOMING_SHOWN, withViewerVerdicts, type FakeLine, type FakeSourceInit } from './fake-source';

// ── the list ───────────────────────────────────────────────────────────────

export const PREVIEW_ENTRIES: readonly PointBuyListEntry[] = rawLines as PointBuyListEntry[];
export const PREVIEW_LIST_VERSION_ID = PREVIEW_ENTRIES[0]?.list_version_id ?? 'preview-list-v1';
export const PREVIEW_SEASON_ID = 'preview-season';
export const PREVIEW_LEAGUE_NAME = 'EvoLiga Preview';

const LINES: FakeLine[] = PREVIEW_ENTRIES.map((e) => ({ lineId: e.line_id ?? '', entryId: e.id, price: e.price }));
const LINE = new Map(LINES.map((l) => [l.lineId, l]));
const LINE_NUMBER = new Map(PREVIEW_ENTRIES.map((e) => [e.line_id ?? '', e.line_number]));
const ENTRY = new Map(PREVIEW_ENTRIES.map((e) => [e.line_id ?? '', e]));
const MAX_PRICE = Math.max(...LINES.map((l) => l.price));

/** The fixture's participation line (stored flag `special_rules.cosmog`); null when the list has none. */
export const PREVIEW_PARTICIPATION_LINE: LineId | null = PREVIEW_ENTRIES.find((e) => e.special_rules?.cosmog)?.line_id ?? null;

/** Lines that can never be dropped in a redraft (stored flag `special_rules.no_redraft`). */
const REDRAFT_LOCKED = new Set(PREVIEW_ENTRIES.filter((e) => e.special_rules?.no_redraft).map((e) => e.line_id ?? ''));

/** KOs to the next stage shown on the token screen: the league override when the pack has one, else the list. */
function nextThreshold(lineId: LineId): number {
  return lineOverrideFor(lineId)?.kills_to_stage2 ?? ENTRY.get(lineId)?.kills_to_stage2 ?? 0;
}

function line(id: LineId): FakeLine {
  const found = LINE.get(id);
  if (!found) throw new Error(`[draft-preview] unknown fixture line ${id}`);
  return found;
}

// ── players ────────────────────────────────────────────────────────────────

const pid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Seat order of the initial draft (seat 1 first). The snake turn sits at Dawn / Misty (SPEC:598-606). */
const PLAYERS = [
  { id: pid(1), name: 'Lea' },
  { id: pid(2), name: 'Cilan' },
  { id: pid(4), name: 'Gary' },
  { id: pid(6), name: 'Serena' },
  { id: pid(7), name: 'Dawn' },
  { id: pid(8), name: 'Misty' },
] as const;

const DAWN = pid(7);
const MISTY = pid(8);
const SERENA = pid(6);
const SPECTATOR = pid(20);

/** Lines the presets pin: nobody else drafts them, so their verdicts stay what the scenario shows. */
export const PREVIEW_PRESET_LINES = {
  /** Too expensive for Dawn on her turn. */
  reasons: 'fuecoco--skeledirge',
  /** A Water line for the filter preset. */
  filters: 'froakie--greninja',
  /** Affordable for Dawn on her turn (the confirm dialog). */
  confirm: 'quaxly--quaquaval',
} as const satisfies Record<string, LineId>;
const PRESET_LINES: LineId[] = Object.values(PREVIEW_PRESET_LINES);

/**
 * `live-wall` pins this branched line (the longest branch label in this fixture list: "→ Raichu-Alola", German
 * "→ Alola-Raichu"; real lists have longer ones, e.g. "→ Ursaluna-Bloodmoon", which truncate the same way). Not a
 * reserved preset line: the wall scenario shows whatever state the simulation leaves it in.
 */
export const PREVIEW_WALL_PIN: LineId = 'pichu--raichualola';
/** `live-wall`'s price cap: most lines still match (the grid scrolls), and the tabs show matching/total. */
export const PREVIEW_WALL_MAX_PRICE = 22;

/** The pack's roster size, capped so every player can fill a roster from the unreserved list. */
export const PREVIEW_ROSTER = Math.min(
  epbPack.defaults.draftPicks,
  Math.floor((LINES.length - PRESET_LINES.length) / PLAYERS.length),
);
const ROSTER = PREVIEW_ROSTER;
const BUDGET = epbPack.defaults.draftBudget;
/** The pack's redraft cap (`epb.defaults.redraftMaxLines`). */
const REDRAFT_MAX = epbPack.defaults.redraftMaxLines;
const PICK_MS = DEFAULT_DRAFT_CONFIG.pick_seconds * 1000;
const MAKEUP_MS = DEFAULT_DRAFT_CONFIG.makeup_seconds * 1000;
const LADDER = [...DEFAULT_DRAFT_CONFIG.slow_ladder_seconds];

/**
 * Dawn's scripted roster (the first `ROSTER` lines are used): the participation line (a no-redraft line)
 * first, then the expensive lines. With the example pack: 74 P after four picks (26 P left, so the top
 * price is budget-infeasible on her fifth pick), 88 P in all, 12 P left for tokens.
 */
const DAWN_ROSTER: LineId[] = [
  'dratini--dragonite',
  'charmander--charizard',
  'dreepy--dragapult',
  'growlithe--arcanine',
  'pawmi--pawmot',
  'mareep--ampharos',
  'nacli--garganacl',
  'beldum--metagross',
  'capsakid--scovillain',
];

// ── scenario ids and picker copy ───────────────────────────────────────────

export const PREVIEW_SCENARIOS = [
  'live-my-turn',
  'live-waiting',
  'live-up-next',
  'live-paused',
  'live-makeup',
  'live-ext-used',
  'live-reasons',
  'live-filters',
  'live-confirm',
  'live-wall',
  'live-filters-more',
  'live-index-loading',
  'live-index-failed',
  'slow-my-turn',
  'slow-penalty',
  'redraft-submission',
  'redraft-locked',
  'redraft-reveal',
  'redraft-picking',
  'complete',
  'spectator',
  'signed-out',
  'admin-panel',
  'admin-publish-refused',
  'admin-tokens',
  'admin-audit',
  'admin-room',
  'admin-room-sheet',
  'admin-room-refused',
  'tokens-before',
  'tokens-open',
  'tokens-comeback',
  'many-drafted',
] as const;
export type PreviewScenarioId = (typeof PREVIEW_SCENARIOS)[number];
export const DEFAULT_SCENARIO: PreviewScenarioId = 'live-my-turn';

export function isPreviewScenario(value: string | undefined): value is PreviewScenarioId {
  return value !== undefined && (PREVIEW_SCENARIOS as readonly string[]).includes(value);
}

export type ScenarioGroup = 'live' | 'slow' | 'redraft' | 'misc';
export const SCENARIO_GROUPS: Record<ScenarioGroup, readonly PreviewScenarioId[]> = {
  live: PREVIEW_SCENARIOS.filter((s) => s.startsWith('live-')),
  slow: PREVIEW_SCENARIOS.filter((s) => s.startsWith('slow-')),
  redraft: PREVIEW_SCENARIOS.filter((s) => s.startsWith('redraft-')),
  misc: PREVIEW_SCENARIOS.filter((s) => !/^(live|slow|redraft)-/.test(s)),
};

export const PREVIEW_WORLDS = ['evoliga', 'sakura', 'mountain', 'clouds', 'none'] as const;
export type PreviewWorld = (typeof PREVIEW_WORLDS)[number];

export function isPreviewWorld(value: string | undefined): value is PreviewWorld {
  return value !== undefined && (PREVIEW_WORLDS as readonly string[]).includes(value);
}

// ── schedule and simulated picks ───────────────────────────────────────────

interface ScheduledSlot {
  pickNumber: number;
  round: number;
  playerId: string;
}

function snake(players: readonly { id: string }[], rounds: number): ScheduledSlot[] {
  const out: ScheduledSlot[] = [];
  for (let r = 1; r <= rounds; r += 1) {
    const order = r % 2 === 1 ? players : [...players].reverse();
    for (const p of order) out.push({ pickNumber: out.length + 1, round: r, playerId: p.id });
  }
  return out;
}

/** The cheapest `n` free prices, excluding `except`. */
function cheapestSum(taken: ReadonlyMap<LineId, string>, n: number, except: LineId, reserved: ReadonlySet<LineId>): number {
  if (n <= 0) return 0;
  const prices = LINES.filter((l) => !taken.has(l.lineId) && l.lineId !== except && !reserved.has(l.lineId))
    .map((l) => l.price)
    .sort((a, b) => a - b);
  return prices.slice(0, n).reduce((sum, p) => sum + p, 0);
}

interface Simulated {
  picks: DraftSnapshotPick[];
  taken: Map<LineId, string>;
  spent: Map<string, number>;
  count: Map<string, number>;
}

/**
 * Plays the first `count` slots: scripted rosters first, everyone else takes the
 * free line closest to a target price (expensive early, then their average left),
 * never one that would leave the rest of the roster unaffordable.
 */
function simulate(order: readonly ScheduledSlot[], count: number, startMs: number, scripted: ReadonlyMap<string, LineId[]>): Simulated {
  const reserved = new Set<LineId>([...scripted.values()].flat().concat(PRESET_LINES));
  const taken = new Map<LineId, string>();
  const spent = new Map<string, number>();
  const made = new Map<string, number>();
  const picks: DraftSnapshotPick[] = [];
  for (const slot of order.slice(0, count)) {
    const n = made.get(slot.playerId) ?? 0;
    const left = BUDGET - (spent.get(slot.playerId) ?? 0);
    const openAfter = ROSTER - n - 1;
    let chosen: FakeLine | undefined;
    const script = scripted.get(slot.playerId);
    if (script) {
      chosen = line(script[n]);
    } else {
      const seat = PLAYERS.findIndex((p) => p.id === slot.playerId);
      const target = slot.round <= 2 ? MAX_PRICE - seat : Math.floor(left / (ROSTER - n)) + (seat % 3);
      const candidates = LINES.filter((l) => !taken.has(l.lineId) && !reserved.has(l.lineId) && l.price <= left)
        .filter((l) => left - l.price >= cheapestSum(taken, openAfter, l.lineId, reserved))
        .sort(
          (a, b) =>
            Math.abs(a.price - target) - Math.abs(b.price - target) ||
            ((LINE_NUMBER.get(a.lineId) ?? 0) * (seat + 3)) % 101 - ((LINE_NUMBER.get(b.lineId) ?? 0) * (seat + 3)) % 101,
        );
      chosen = candidates[0];
    }
    if (!chosen) throw new Error(`[draft-preview] no affordable line for pick ${slot.pickNumber}`);
    taken.set(chosen.lineId, slot.playerId);
    spent.set(slot.playerId, (spent.get(slot.playerId) ?? 0) + chosen.price);
    made.set(slot.playerId, n + 1);
    picks.push({
      pick_id: `preview-pick-${slot.pickNumber}`,
      slot_id: `preview-slot-${slot.pickNumber}`,
      pick_number: slot.pickNumber,
      round: slot.round,
      player_id: slot.playerId,
      line_id: chosen.lineId,
      entry_id: chosen.entryId,
      price: chosen.price,
      made_at: new Date(startMs + slot.pickNumber * 150_000).toISOString(),
      admin_override: false,
      redraft_slot_id: null,
    });
  }
  return { picks, taken, spent, count: made };
}

function upcomingOf(slots: readonly ScheduledSlot[], durationMs: number, kind: SlotKind = 'normal'): DraftUpcomingSlot[] {
  return slots.map((s) => ({
    slot_id: `preview-slot-${s.pickNumber}`,
    player_id: s.playerId,
    pick_number: s.pickNumber,
    round: s.round,
    kind,
    duration_ms: durationMs,
  }));
}

// ── snapshot builder ───────────────────────────────────────────────────────

const iso = (ms: number): string => new Date(ms).toISOString();

interface DraftStateOptions {
  now: number;
  /** Slots already played. */
  played: number;
  mode?: 'live' | 'slow';
  viewer?: string | null;
  admin?: boolean;
  /** Elapsed time of the active slot. */
  elapsedMs?: number;
  durationMs?: number;
  penalty?: Partial<Record<string, number>>;
  scenarioId: PreviewScenarioId;
}

interface BuiltState {
  dto: DraftSnapshotDTO;
  queue: DraftUpcomingSlot[];
}

function participants(sim: Simulated, players: readonly { id: string; name: string }[], slots: number, budgetOf: (id: string) => number): DraftSnapshotParticipant[] {
  return players.map((p, i) => {
    const made = sim.count.get(p.id) ?? 0;
    const budget = budgetOf(p.id);
    return {
      player_id: p.id,
      name: p.name,
      avatar_url: null,
      seat: i + 1,
      standing_rank: null,
      slots_total: slots,
      picks_made: made,
      open_slots: Math.max(0, slots - made),
      budget_start: budget,
      budget_remaining: budget - (sim.spent.get(p.id) ?? 0),
      penalty_stage: 0,
      timeout_count: 0,
      extensions: { plus120_used: false, plus60_used: false },
      done: made >= slots,
    };
  });
}

function initialDraft(o: DraftStateOptions): BuiltState {
  const mode = o.mode ?? 'live';
  const ladder0 = LADDER[0] * 1000;
  const order = snake(PLAYERS, ROSTER);
  const start = o.now - 3 * 3_600_000;
  const sim = simulate(order, o.played, start, new Map([[DAWN, DAWN_ROSTER]]));
  const base: DraftSnapshotDTO = {
    state_version: 100 + o.played,
    server_now: iso(o.now),
    pool: {
      id: `preview-pool-${o.scenarioId}`,
      season_id: PREVIEW_SEASON_ID,
      kind: 'initial',
      mode,
      status: 'in_progress',
      paused: false,
      paused_at: null,
      roster_size: ROSTER,
      budget: BUDGET,
      started_at: iso(start),
      ended_at: null,
      phase: 'drafting',
      pause_reason: null,
      list_version_id: PREVIEW_LIST_VERSION_ID,
      league_time_zone: 'Europe/Berlin',
    },
    config: {
      pick_seconds: DEFAULT_DRAFT_CONFIG.pick_seconds,
      makeup_seconds: DEFAULT_DRAFT_CONFIG.makeup_seconds,
      slow_ladder_seconds: LADDER,
      extension_seconds: mode === 'live' ? [...DEFAULT_DRAFT_CONFIG.extension_seconds] : null,
      redraft_max_lines: REDRAFT_MAX,
      quiet_hours: null,
    },
    participants: participants(sim, PLAYERS, ROSTER, () => BUDGET).map((p) => {
      const stage = o.penalty?.[p.player_id] ?? 0;
      return stage > 0 ? { ...p, penalty_stage: stage, timeout_count: stage } : p;
    }),
    active_slot: null,
    upcoming: [],
    picks: sim.picks,
    taken: Object.fromEntries(sim.taken),
    redraft: null,
    recent_events: sim.picks
      .slice(-6)
      .reverse()
      .map((p): DraftRecentEvent => ({ at: p.made_at, action: 'pick_confirmed', actor_role: 'player', player_id: p.player_id, line_id: p.line_id, slot_id: p.slot_id })),
    viewer: {
      player_id: o.viewer === undefined ? DAWN : o.viewer,
      is_participant: o.viewer === undefined || PLAYERS.some((p) => p.id === o.viewer),
      is_pool_admin: o.admin ?? false,
      pick_block: null,
      line_status: {},
      restricted_line_ids: [],
    },
  };
  const rest = order.slice(o.played);
  const duration = (playerId: string): number => {
    if (o.durationMs !== undefined) return o.durationMs;
    if (mode === 'live') return PICK_MS;
    const stage = o.penalty?.[playerId] ?? 0;
    return (LADDER[stage] ?? LADDER[LADDER.length - 1]) * 1000;
  };
  const queue = rest.map((s) => ({ ...upcomingOf([s], mode === 'live' ? PICK_MS : ladder0)[0], duration_ms: duration(s.playerId) }));
  const elapsed = o.elapsedMs ?? 70_000;
  const advanced = advanceSlot(base, queue, o.now - elapsed);
  return { dto: { ...advanced.dto, server_now: iso(o.now) }, queue: advanced.queue };
}

/** The finished initial draft (`ROSTER` picks per player), every roster full. */
function completedDraft(now: number, scenarioId: PreviewScenarioId, viewer: string | null = DAWN, admin = false): BuiltState {
  return initialDraft({ now, played: ROSTER * PLAYERS.length, scenarioId, viewer, admin });
}

// ── redraft ────────────────────────────────────────────────────────────────

/**
 * Dawn's drops, capped at the pack's redraft limit: A = Charizard (2 real KOs transfer), B = Arcanine (0),
 * C = Pawmot (1). Her last drop is the slot she fills in round 1 of the redraft.
 */
const DAWN_DROPS = (
  [
    { label: 'A', lineId: 'charmander--charizard', kills: 2 },
    { label: 'B', lineId: 'growlithe--arcanine', kills: 0 },
    { label: 'C', lineId: 'pawmi--pawmot', kills: 1 },
  ] as const
).slice(0, Math.max(1, REDRAFT_MAX));
/** The label of the slot Dawn fills in round 1 of the redraft. */
const DAWN_FIRST_FILL = DAWN_DROPS[DAWN_DROPS.length - 1].label;

/** Redraft seat order: worst first-half standing first (Dawn is 4th of 6). */
const STANDING: Record<string, number> = {
  [pid(1)]: 1,
  [pid(2)]: 2,
  [pid(8)]: 3,
  [DAWN]: 4,
  [pid(4)]: 5,
  [pid(6)]: 6,
};

function othersDrops(initial: DraftSnapshotDTO): { player_id: string; line_id: LineId; transferred_real_kills: number }[] {
  const out: { player_id: string; line_id: LineId; transferred_real_kills: number }[] = [];
  PLAYERS.forEach((p, i) => {
    if (p.id === DAWN) return;
    const own = initial.picks.filter((x) => x.player_id === p.id && !REDRAFT_LOCKED.has(x.line_id));
    const n = Math.min((i % 3) + 1, Math.max(1, REDRAFT_MAX));
    own.slice(-n).forEach((x, k) => out.push({ player_id: p.id, line_id: x.line_id, transferred_real_kills: (k + i) % 3 }));
  });
  return out;
}

type RedraftStage = 'submission' | 'locked' | 'reveal' | 'picking';

/** The redraft slot ids of one player's drops (Dawn's are the viewer slots A/B/C). */
function redraftSlotId(playerId: string, label: string): string {
  return playerId === DAWN ? `preview-redraft-slot-${label}` : `preview-redraft-slot-${playerId.slice(-2)}-${label}`;
}

const SLOT_LABELS = ['A', 'B', 'C', 'D', 'E'];

/**
 * A redraft pool at `stage`. `admin` makes Dawn a pool admin: the snapshot then
 * carries every published slot (`redraft.admin_slots`), as BE #23 sends it.
 */
function redraftState(
  now: number,
  stage: RedraftStage,
  scenarioId: PreviewScenarioId,
  admin = false,
): BuiltState & { submission: RedraftSubmissionDTO; adminSubmissions: AdminSubmissionDTO[] } {
  const initial = completedDraft(now - 21 * 86_400_000, scenarioId).dto;
  const dawnDrops = stage === 'submission' ? [DAWN_DROPS[0]] : [...DAWN_DROPS];
  const drops = [
    ...dawnDrops.map((d) => ({ player_id: DAWN, line_id: d.lineId as LineId, transferred_real_kills: d.kills })),
    ...othersDrops(initial),
  ];
  const published = stage === 'reveal' || stage === 'picking';
  const deadline = stage === 'submission' ? now + 2 * 86_400_000 + 5 * 3_600_000 : now - 26 * 3_600_000;

  const order = [...PLAYERS].sort((a, b) => STANDING[b.id] - STANDING[a.id]);
  const dropCount = new Map<string, number>();
  for (const d of drops) dropCount.set(d.player_id, (dropCount.get(d.player_id) ?? 0) + 1);
  const refund = new Map<string, number>();
  for (const d of drops) refund.set(d.player_id, (refund.get(d.player_id) ?? 0) + line(d.line_id).price);
  const leftover = (id: string): number => initial.participants.find((p) => p.player_id === id)?.budget_remaining ?? 0;

  // Redraft slots: round r goes in redraft order to everyone with a drop left.
  const maxDrops = Math.max(...dropCount.values());
  const schedule: ScheduledSlot[] = [];
  for (let r = 1; r <= maxDrops; r += 1) {
    for (const p of order) if ((dropCount.get(p.id) ?? 0) >= r) schedule.push({ pickNumber: schedule.length + 1, round: r, playerId: p.id });
  }

  const dropped = new Set(drops.map((d) => d.line_id));
  const seasonTaken = Object.fromEntries(Object.entries(initial.taken).filter(([id]) => !dropped.has(id)));

  // Picking: Dawn already filled her last slot in round 1; the clock is on Dawn in round 2.
  const played = stage === 'picking' ? schedule.findIndex((s) => s.round === 2 && s.playerId === DAWN) : 0;
  const redraftPicks: DraftSnapshotPick[] = [];
  const taken: Record<LineId, string> = { ...seasonTaken };
  const spent = new Map<string, number>();
  const free = (): FakeLine[] =>
    LINES.filter((l) => taken[l.lineId] === undefined && !dropped.has(l.lineId)).sort((a, b) => a.price - b.price);
  let dawnFilledFirst: string | null = null;
  // Each player's drops in order are their slots A, B, C; Dawn fills her last slot first (round 1), the others fill in order.
  const slotsOf = new Map<string, { id: string; label: string; lineId: LineId; kills: number }[]>();
  for (const d of drops) {
    const own = slotsOf.get(d.player_id) ?? [];
    const label = d.player_id === DAWN ? (DAWN_DROPS.find((k) => k.lineId === d.line_id)?.label ?? 'A') : SLOT_LABELS[own.length];
    own.push({ id: redraftSlotId(d.player_id, label), label, lineId: d.line_id, kills: d.transferred_real_kills });
    slotsOf.set(d.player_id, own);
  }
  const filled = new Map<string, string>();
  for (const s of schedule.slice(0, Math.max(0, played))) {
    const budget = leftover(s.playerId) + (refund.get(s.playerId) ?? 0) - (spent.get(s.playerId) ?? 0);
    const affordable = free().filter((l) => l.price <= budget / 1.5);
    const pick = (s.playerId === DAWN ? affordable[0] : affordable[affordable.length - 1]) ?? free()[0];
    taken[pick.lineId] = s.playerId;
    spent.set(s.playerId, (spent.get(s.playerId) ?? 0) + pick.price);
    const pickId = `preview-redraft-pick-${s.pickNumber}`;
    if (s.playerId === DAWN) dawnFilledFirst = pickId;
    const slot = s.playerId === DAWN
      ? slotsOf.get(DAWN)?.find((x) => x.label === DAWN_FIRST_FILL)
      : slotsOf.get(s.playerId)?.find((x) => !filled.has(x.id));
    if (slot) filled.set(slot.id, pickId);
    redraftPicks.push({
      pick_id: pickId,
      slot_id: `preview-redraft-slot-${s.pickNumber}`,
      pick_number: s.pickNumber,
      round: s.round,
      player_id: s.playerId,
      line_id: pick.lineId,
      entry_id: pick.entryId,
      price: pick.price,
      made_at: iso(now - (played - s.pickNumber + 1) * 120_000),
      admin_override: false,
      redraft_slot_id: slot?.id ?? null,
    });
  }

  const redraftParticipants: DraftSnapshotParticipant[] = order.map((p, i) => {
    const slots = dropCount.get(p.id) ?? 0;
    const made = redraftPicks.filter((x) => x.player_id === p.id).length;
    const budget = leftover(p.id) + (refund.get(p.id) ?? 0);
    return {
      player_id: p.id,
      name: p.name,
      avatar_url: null,
      seat: i + 1,
      standing_rank: STANDING[p.id],
      slots_total: slots,
      picks_made: made,
      open_slots: Math.max(0, slots - made),
      budget_start: budget,
      budget_remaining: budget - (spent.get(p.id) ?? 0),
      penalty_stage: 0,
      timeout_count: 0,
      extensions: { plus120_used: false, plus60_used: false },
      done: slots > 0 && made >= slots,
    };
  });

  // As the backend does: the pool stays in `submissions` until the publish, which starts the picking at once
  // (`redraft__publish_locked`); `locked` is the derived phase after the deadline.
  const phase = published ? 'drafting' : 'submissions';
  const base: DraftSnapshotDTO = {
    ...initial,
    state_version: 400 + played,
    server_now: iso(now),
    pool: {
      ...initial.pool,
      id: `preview-pool-${scenarioId}`,
      kind: 'redraft',
      status: published ? 'in_progress' : 'pending',
      phase,
      started_at: published ? iso(now - (stage === 'picking' ? 40 : 5) * 60_000) : null,
      ended_at: null,
    },
    participants: redraftParticipants,
    active_slot: null,
    upcoming: [],
    picks: redraftPicks,
    taken: published ? taken : initial.taken,
    redraft: {
      phase: stage === 'submission' ? 'submissions' : stage === 'locked' ? 'locked' : 'drafting',
      deadline_at: iso(deadline),
      published_at: published ? iso(now - (stage === 'reveal' ? 5 : 45) * 60_000) : null,
      drops: published ? drops : null,
      viewer_slots: dawnDrops.map((d) => ({
        redraft_slot_id: `preview-redraft-slot-${d.label}`,
        label: d.label,
        dropped_line_id: d.lineId,
        transferred_real_kills: d.kills,
        filled_by_pick_id: d.label === DAWN_FIRST_FILL ? dawnFilledFirst : null,
      })),
      ...(admin && published
        ? {
            admin_slots: [...slotsOf.entries()].flatMap(([playerId, own]) =>
              own.map(
                (x): DraftAdminRedraftSlot => ({
                  redraft_slot_id: x.id,
                  player_id: playerId,
                  label: x.label,
                  dropped_line_id: x.lineId,
                  transferred_real_kills: x.kills,
                  filled_by_pick_id: filled.get(x.id) ?? null,
                }),
              ),
            ),
          }
        : {}),
    },
    recent_events: [],
    viewer: {
      ...initial.viewer,
      is_pool_admin: admin,
      restricted_line_ids: published ? dawnDrops.map((d) => d.lineId) : [],
    },
  };
  const queue = upcomingOf(schedule.slice(Math.max(0, played)), PICK_MS);
  const built = published
      ? advanceSlot(base, queue, now - 50_000)
      : { dto: { ...base, upcoming: queue.slice(0, UPCOMING_SHOWN) }, queue };

  const own = initial.picks.filter((p) => p.player_id === DAWN);
  const submission: RedraftSubmissionDTO = {
    line_ids: dawnDrops.map((d) => d.lineId),
    updated_at: iso(now - 3 * 3_600_000),
    locked: stage !== 'submission',
    deadline_at: iso(deadline),
    max: REDRAFT_MAX,
    own_lines: own.map((p, i) => ({
      line_id: p.line_id,
      real_kills: (i * 2) % 5,
      price: p.price,
      droppable: !REDRAFT_LOCKED.has(p.line_id),
    })),
    leftover_budget: leftover(DAWN),
  };
  // What an admin reads before the publish (BE #20): every player's secret drop set.
  const adminSubmissions: AdminSubmissionDTO[] = [...slotsOf.entries()].map(([playerId, own]) => ({
    player_id: playerId,
    player_name: PLAYERS.find((p) => p.id === playerId)?.name ?? playerId,
    line_ids: own.map((x) => x.lineId),
    updated_at: iso(now - 3 * 3_600_000),
  }));
  return { dto: { ...built.dto, server_now: iso(now) }, queue: built.queue, submission, adminSubmissions };
}

// ── tokens, admin, audit ───────────────────────────────────────────────────

function tokenOverview(now: number, window: 'before' | 'open' | 'closed', comeback: boolean, initial: DraftSnapshotDTO): TokenOverviewDTO {
  const own = initial.picks.filter((p) => p.player_id === DAWN);
  const { tokenRatio, tokenMax } = epbPack.defaults;
  // One token short of the cap once the window opened, so the open window can still sell one.
  const owned = window === 'before' ? 0 : Math.max(0, tokenMax - 1);
  const firstHasToken = owned > 0;
  // Comeback history: three shutouts at the first row of the pack's table (none when the table is empty).
  const row = epbPack.comeback.table[0];
  const history = comeback && row ? [2, 4, 5].map((matchday) => ({ matchday, score: `0:${row.minWinnerSurvivors}`, tokens: row.tokens })) : [];
  const earned = history.reduce((sum, h) => sum + h.tokens, 0);
  const spent = Math.min(1, earned);
  const participation = PREVIEW_PARTICIPATION_LINE;
  return {
    season_id: PREVIEW_SEASON_ID,
    player_id: DAWN,
    initial_draft_complete: initial.pool.status === 'complete',
    redraft_complete: comeback,
    draft_kill: {
      window,
      cutoff_at: window === 'closed' ? iso(now - 86_400_000) : iso(now + 4 * 86_400_000),
      cost: tokenRatio,
      max: tokenMax,
      owned,
      unspent_points: initial.participants.find((p) => p.player_id === DAWN)?.budget_remaining ?? 0,
      lines: own.map((p, i) => {
        const participates = p.line_id === participation;
        const hasToken = firstHasToken && i === 0;
        return {
          line_id: p.line_id,
          has_token: hasToken,
          progress: hasToken ? 1 : 0,
          next_threshold: nextThreshold(p.line_id),
          eligible: window === 'open' && !hasToken && !participates,
          reason: window !== 'open' ? 'TOKEN_WINDOW_CLOSED' : hasToken ? 'TOKEN_LINE_LIMIT' : participates ? 'TOKEN_WOULD_EVOLVE' : null,
        };
      }),
    },
    comeback: {
      earned,
      spent,
      unspent: earned - spent,
      history,
      spend_open: comeback,
      earn_window: comebackEarnWindow(),
    },
    cosmo: participation ? { line_id: participation, tokens: comeback ? 2 : 0, matchdays_brought: comeback ? [1, 3] : [] } : null,
    lines: own.map((p, i) => ({
      line_id: p.line_id,
      stage: i % 4 === 0 ? 2 : 1,
      self_earned_kills: (i * 2) % 5,
      transferred_evo_progress: 0,
      draft_token_progress: firstHasToken && i === 0 ? 1 : 0,
      comeback_token_progress: comeback && i === 1 ? 1 : 0,
      cosmo_token_progress: p.line_id === participation && comeback ? 2 : 0,
      total_progress: (i * 2) % 5 + (firstHasToken && i === 0 ? 1 : 0) + (comeback && i === 1 ? 1 : 0),
      next_threshold: nextThreshold(p.line_id),
      comeback_tokens_per_progress: comebackTokensPerProgress(p.line_id === participation),
    })),
  };
}

function auditLog(now: number, dto: DraftSnapshotDTO): AuditEntryDTO[] {
  const name = (id: string | null): string | null => (id === null ? null : dto.participants.find((p) => p.player_id === id)?.name ?? null);
  const admin = { player_id: DAWN, name: 'Dawn', role: 'admin' as const };
  const system = { player_id: null, name: 'System', role: 'system' as const };
  const lastPick = dto.picks[dto.picks.length - 1];
  return [
    { id: 'audit-6', occurred_at: iso(now - 60_000), actor: admin, action: 'resumed', player_name: null, line_id: null, slot_label: null, pick_number: null, before: null, after: null, note: null, is_public: true },
    { id: 'audit-5', occurred_at: iso(now - 4 * 60_000), actor: admin, action: 'paused', player_name: null, line_id: null, slot_label: null, pick_number: null, before: null, after: null, note: 'Discord-Ausfall', is_public: true },
    { id: 'audit-4', occurred_at: iso(now - 9 * 60_000), actor: admin, action: 'pick_admin_override', player_name: name(lastPick?.player_id ?? null), line_id: lastPick?.line_id ?? null, slot_label: null, pick_number: lastPick?.pick_number ?? null, before: null, after: { price: lastPick?.price ?? 0 }, note: 'Pick per Discord-DM bestätigt', is_public: true },
    { id: 'audit-3', occurred_at: iso(now - 15 * 60_000), actor: system, action: 'timeout', player_name: 'Misty', line_id: null, slot_label: null, pick_number: MAKEUP_PICK, before: null, after: null, note: null, is_public: true },
    { id: 'audit-2', occurred_at: iso(now - 16 * 60_000), actor: { player_id: MISTY, name: 'Misty', role: 'player' }, action: 'extension_used', player_name: 'Misty', line_id: null, slot_label: null, pick_number: MAKEUP_PICK, before: null, after: { seconds: 120 }, note: null, is_public: true },
    { id: 'audit-1', occurred_at: iso(now - 3 * 3_600_000), actor: admin, action: 'draft_started', player_name: null, line_id: null, slot_label: null, pick_number: null, before: null, after: null, note: null, is_public: true },
  ];
}

// ── scenarios ──────────────────────────────────────────────────────────────

/** UI state the preview sets up front (the pinned line, filters, the confirm dialog). */
export interface PreviewPreset {
  pinnedLineId?: LineId;
  filters?: FinderFilters;
  filterPanelOpen?: boolean;
  /** Open the confirm dialog for the pinned line. */
  dialog?: boolean;
  /** Pool admins: open the room's admin sheet on this tab. */
  adminTab?: RoomAdminTab;
}

/** Which real screen the scenario mounts (the draft room's pick screen unless noted). */
export type PreviewScreen = 'pick' | 'redraft' | 'tokens' | 'admin' | 'audit' | 'tokenAdmin';

/** One pool of the admin scenarios: its tab summary and its own in-memory backend. */
export interface PreviewAdminPool {
  summary: AdminPoolSummary;
  init: Omit<FakeSourceInit, 'index'>;
}

/** The season the admin panel and the audit viewer show. */
export interface PreviewAdminSeason {
  /** Every pool of the season, initial first; the scenario's own pool is one of them. */
  pools: PreviewAdminPool[];
  /** `toPublicPlayerRef` shape: id + name only. */
  participants: { id: string; name: string }[];
  comebackSpendOpen: boolean;
  hasRedraft: boolean;
  /** Admin data of the control page: pool id -> `publish_refused_at` (`admin-publish-refused`). */
  publishRefusedAt?: Record<string, string>;
}

export interface PreviewScenario {
  id: PreviewScenarioId;
  poolId: string;
  /** JSON only: crosses to the client (the page adds the search index). */
  init: Omit<FakeSourceInit, 'index'>;
  viewer: { playerId: string | null; isSiteAdmin: boolean };
  preset: PreviewPreset | null;
  screen: PreviewScreen;
  /** `admin` / `audit` screens only. */
  admin: PreviewAdminSeason | null;
}

/** "Now" for a scenario build (kept out of the page component: the clock is fixture input). */
export function previewNow(): number {
  return Date.now();
}

/** Slots played when Dawn's second-to-last pick is on the clock (the top prices are budget-infeasible). */
const DAWN_TURN = snake(PLAYERS, ROSTER).findIndex((s) => s.playerId === DAWN && s.round === ROSTER - 1);
/** Misty's last pick of round 3: her snake turn (picks MAKEUP_PICK and MAKEUP_PICK + 1) follows. */
const MAKEUP_PICK = 3 * PLAYERS.length;
/** Slots played in `live-waiting`: someone two seats before Dawn is on the clock. */
const WAITING_PLAYED = DAWN_TURN - 2;
/** Lines taken in `many-drafted`. */
export const MANY_DRAFTED = ROSTER * PLAYERS.length - PLAYERS.length + 2;

function scenarioOf(
  id: PreviewScenarioId,
  built: BuiltState,
  extra: Partial<Pick<PreviewScenario, 'preset' | 'screen' | 'admin'>> & {
    favorites?: LineId[];
    authFails?: boolean;
    isSiteAdmin?: boolean;
    submission?: RedraftSubmissionDTO;
    tokens?: TokenOverviewDTO;
    adminSubmissions?: AdminSubmissionDTO[];
    /** The admin submissions read's `publish_refused_at` (a refused automatic publish). */
    adminPublishRefusedAt?: string;
    audit?: AuditEntryDTO[];
    /** The search index stays pending or fails (the pick screen's index states). */
    index?: FakeSourceInit['indexState'];
  } = {},
): PreviewScenario {
  const dto = withViewerVerdicts(built.dto, LINES);
  return {
    id,
    poolId: dto.pool.id,
    init: {
      snapshot: dto,
      lines: LINES,
      queue: built.queue,
      favorites: extra.favorites ?? [PREVIEW_PRESET_LINES.filters, PREVIEW_PRESET_LINES.confirm, PREVIEW_PRESET_LINES.reasons],
      authFails: extra.authFails,
      redraftSubmission: extra.submission ?? null,
      tokens: extra.tokens ?? null,
      ...(extra.adminSubmissions ? { adminSubmissions: extra.adminSubmissions } : {}),
      ...(extra.adminPublishRefusedAt ? { adminPublishRefusedAt: extra.adminPublishRefusedAt } : {}),
      ...(extra.audit ? { audit: extra.audit } : {}),
      ...(extra.index ? { indexState: extra.index } : {}),
    },
    viewer: { playerId: dto.viewer.player_id, isSiteAdmin: extra.isSiteAdmin ?? false },
    preset: extra.preset ?? null,
    screen: extra.screen ?? 'pick',
    admin: extra.admin ?? null,
  };
}

function summaryOf(dto: DraftSnapshotDTO): AdminPoolSummary {
  return { id: dto.pool.id, engine: 'queue', kind: dto.pool.kind, phase: dto.pool.phase, mode: dto.pool.mode, status: dto.pool.status };
}

function withPoolId(built: BuiltState, id: string): BuiltState {
  return { ...built, dto: { ...built.dto, pool: { ...built.dto.pool, id } } };
}

const ADMIN_PARTICIPANTS = PLAYERS.map((p) => ({ id: p.id, name: p.name }));

function filtersOf(patch: Partial<FinderFilters>): FinderFilters {
  return { ...EMPTY_FILTERS, ...patch };
}

/**
 * The active pack's first utility category with a move member that counts for the category (`inParentMatch`):
 * `live-filters-more` picks it, so the scenario works with whichever pack the build uses.
 */
function previewUtilityPick(): { key: string; member: string } | null {
  for (const category of epbPack.utility.categories) {
    const member = category.members.find((m) => m.kind === 'move' && m.inParentMatch);
    if (member) return { key: category.key, member: member.id };
  }
  return null;
}

export function buildPreviewScenario(id: PreviewScenarioId, now: number): PreviewScenario {
  switch (id) {
    case 'live-my-turn':
      return scenarioOf(id, initialDraft({ now, played: DAWN_TURN, scenarioId: id }));
    case 'live-waiting':
      return scenarioOf(id, initialDraft({ now, played: WAITING_PLAYED, scenarioId: id }));
    case 'live-up-next':
      return scenarioOf(id, initialDraft({ now, played: DAWN_TURN - 1, scenarioId: id, elapsedMs: 200_000 }));
    case 'live-paused': {
      const built = initialDraft({ now, played: DAWN_TURN, scenarioId: id });
      const slot = built.dto.active_slot;
      return scenarioOf(id, {
        queue: built.queue,
        dto: {
          ...built.dto,
          pool: { ...built.dto.pool, paused: true, paused_at: iso(now - 4 * 60_000), pause_reason: 'admin' },
          active_slot: slot ? { ...slot, deadline_at: null, remaining_ms_at_pause: 154_000 } : null,
        },
      });
    }
    case 'live-makeup': {
      // Misty timed out on her last pick of round 3 (first of her two snake-turn picks): only that slot moves
      // behind Dawn as a 2:30 make-up; her second normal pick stays (SPEC:592-606).
      const built = initialDraft({ now, played: MAKEUP_PICK, scenarioId: id, elapsedMs: 40_000 });
      const [dawn, ...after] = built.queue;
      const makeup: DraftUpcomingSlot = { slot_id: `preview-slot-${MAKEUP_PICK}-makeup`, player_id: MISTY, pick_number: MAKEUP_PICK, round: 3, kind: 'makeup', duration_ms: MAKEUP_MS };
      const queue = [dawn, makeup, ...after];
      const picks = built.dto.picks.filter((p) => p.pick_number !== MAKEUP_PICK);
      const missing = built.dto.picks.find((p) => p.pick_number === MAKEUP_PICK);
      const taken = { ...built.dto.taken };
      if (missing) delete taken[missing.line_id];
      const timeout: DraftRecentEvent = { at: iso(now - 45_000), action: 'timeout', actor_role: 'system', player_id: MISTY, line_id: null, slot_id: `preview-slot-${MAKEUP_PICK}` };
      return scenarioOf(id, {
        queue,
        dto: {
          ...built.dto,
          picks,
          taken,
          upcoming: queue.slice(0, UPCOMING_SHOWN),
          participants: built.dto.participants.map((p) =>
            p.player_id === MISTY
              ? { ...p, picks_made: p.picks_made - 1, open_slots: p.open_slots + 1, budget_remaining: p.budget_remaining + (missing?.price ?? 0), timeout_count: 1 }
              : p,
          ),
          recent_events: [timeout, ...built.dto.recent_events].slice(0, 12),
        },
      });
    }
    case 'live-ext-used': {
      const built = initialDraft({ now, played: DAWN_TURN, scenarioId: id, elapsedMs: 330_000 });
      const slot = built.dto.active_slot;
      return scenarioOf(id, {
        queue: built.queue,
        dto: {
          ...built.dto,
          active_slot: slot && slot.deadline_at ? { ...slot, extensions_applied_ms: 120_000, deadline_at: iso(Date.parse(slot.deadline_at) + 120_000) } : slot,
          participants: built.dto.participants.map((p) => (p.player_id === DAWN ? { ...p, extensions: { plus120_used: true, plus60_used: false } } : p)),
        },
      });
    }
    case 'live-reasons':
      return scenarioOf(id, initialDraft({ now, played: DAWN_TURN, scenarioId: id }), { preset: { pinnedLineId: PREVIEW_PRESET_LINES.reasons } });
    case 'live-filters':
      // The filter sheet open over the stage pane: the groups with active filters (Pokémon, Moves and
      // abilities, Defensive matchups) open with their counts and resets, Base stats and Utility collapsed,
      // the footer's live "Show N lines"; closing it shows the chip row and "Filters (3)".
      return scenarioOf(id, initialDraft({ now, played: DAWN_TURN, scenarioId: id }), {
        preset: {
          filterPanelOpen: true,
          pinnedLineId: PREVIEW_PRESET_LINES.filters,
          filters: filtersOf({ types: { ids: ['Water'], match: 'any' }, moves: { ids: ['knockoff'], match: 'any' }, defense: [{ relation: 'resists', type: 'Fire' }] }),
        },
      });
    case 'live-confirm':
      return scenarioOf(id, initialDraft({ now, played: DAWN_TURN, scenarioId: id }), { preset: { pinnedLineId: PREVIEW_PRESET_LINES.confirm, dialog: true } });
    case 'live-wall':
      // The wall layout: branched and unbranched cards side by side (uniform card grid), drafted / mine /
      // available states, a long branch label, a scrolling grid under the pinned price tabs with
      // matching/total counts.
      return scenarioOf(id, initialDraft({ now, played: DAWN_TURN, scenarioId: id }), {
        preset: { pinnedLineId: PREVIEW_WALL_PIN, filters: filtersOf({ maxPrice: PREVIEW_WALL_MAX_PRICE }) },
      });
    case 'live-filters-more': {
      // The sheet with the other two groups in use: Base stats (header summary "Spe ≥ 80 · BST ≥ 500") and a
      // Utility category with one picked member, its member list expanded.
      const utility = previewUtilityPick();
      return scenarioOf(id, initialDraft({ now, played: DAWN_TURN, scenarioId: id }), {
        preset: {
          filterPanelOpen: true,
          filters: filtersOf({
            stats: { spe: 80, bst: 500 },
            utility: utility ? [{ key: utility.key as FinderFilters['utility'][number]['key'], members: [utility.member] }] : [],
          }),
        },
      });
    }
    case 'live-index-loading':
      // The search index never arrives: the Filters button is disabled (motion-gated pulse) and the price tabs
      // show the catalog totals (no matching/total).
      return scenarioOf(id, initialDraft({ now, played: DAWN_TURN, scenarioId: id }), { index: 'pending' });
    case 'live-index-failed':
      // The search index failed to load: the room keeps the wall with catalog totals and says so.
      return scenarioOf(id, initialDraft({ now, played: DAWN_TURN, scenarioId: id }), { index: 'failed' });
    case 'slow-my-turn': {
      // 12 h slot, 7 h 42 m left.
      const durationMs = LADDER[0] * 1000;
      return scenarioOf(id, initialDraft({ now, played: DAWN_TURN, scenarioId: id, mode: 'slow', durationMs, elapsedMs: durationMs - (7 * 3_600_000 + 42 * 60_000) }));
    }
    case 'slow-penalty': {
      const penalty = { [DAWN]: 2, [MISTY]: 1, [SERENA]: 3 };
      const durationMs = LADDER[2] * 1000;
      return scenarioOf(id, initialDraft({ now, played: DAWN_TURN, scenarioId: id, mode: 'slow', penalty, durationMs, elapsedMs: durationMs - 72 * 60_000 }));
    }
    case 'redraft-submission':
    case 'redraft-locked':
    case 'redraft-reveal': {
      const r = redraftState(now, id === 'redraft-submission' ? 'submission' : id === 'redraft-locked' ? 'locked' : 'reveal', id);
      return scenarioOf(id, r, { submission: r.submission, screen: 'redraft' });
    }
    case 'redraft-picking': {
      const r = redraftState(now, 'picking', id);
      return scenarioOf(id, r, { submission: r.submission });
    }
    case 'complete':
      return scenarioOf(id, completedDraft(now, id));
    case 'spectator':
      return scenarioOf(id, initialDraft({ now, played: DAWN_TURN, scenarioId: id, viewer: SPECTATOR }), { favorites: [] });
    case 'signed-out':
      return scenarioOf(id, initialDraft({ now, played: DAWN_TURN, scenarioId: id, viewer: null }), { favorites: [] });
    case 'admin-panel': {
      // Dawn administers a season whose initial draft is done and whose Redraft is picking (published
      // drops, so the snapshot carries `admin_slots`); the panel opens on the running Redraft tab.
      const initial = withPoolId(completedDraft(now, id, DAWN, true), 'preview-pool-admin-panel-initial');
      const redraft = redraftState(now, 'picking', id, true);
      const redraftBuilt = withPoolId(redraft, 'preview-pool-admin-panel-redraft');
      const tokens = tokenOverview(now, 'closed', true, initial.dto);
      const initialScenario = scenarioOf(id, initial, { tokens });
      const scenario = scenarioOf(id, redraftBuilt, { tokens, isSiteAdmin: true, screen: 'admin', adminSubmissions: redraft.adminSubmissions });
      return {
        ...scenario,
        admin: {
          pools: [
            { summary: summaryOf(initialScenario.init.snapshot ?? initial.dto), init: initialScenario.init },
            { summary: summaryOf(redraftBuilt.dto), init: scenario.init },
          ],
          participants: ADMIN_PARTICIPANTS,
          comebackSpendOpen: false,
          hasRedraft: false,
        },
      };
    }
    case 'admin-publish-refused': {
      // The control page on a Redraft past its deadline whose automatic publish the tick refused: the Redraft
      // section shows "Automatic publish refused at <time>" (admin data: the server render's value first, then
      // the section's own submissions read, which the fake answers with the same instant).
      const initial = withPoolId(completedDraft(now, id, DAWN, true), 'preview-pool-admin-refused-initial');
      const redraft = redraftState(now, 'locked', id, true);
      const redraftBuilt = withPoolId(redraft, 'preview-pool-admin-refused-redraft');
      const refusedAt = iso(now - 25 * 60_000);
      const initialScenario = scenarioOf(id, initial);
      const scenario = scenarioOf(id, redraftBuilt, {
        isSiteAdmin: true,
        screen: 'admin',
        adminSubmissions: redraft.adminSubmissions,
        adminPublishRefusedAt: refusedAt,
      });
      return {
        ...scenario,
        admin: {
          pools: [
            { summary: summaryOf(initialScenario.init.snapshot ?? initial.dto), init: initialScenario.init },
            { summary: summaryOf(redraftBuilt.dto), init: scenario.init },
          ],
          participants: ADMIN_PARTICIPANTS,
          comebackSpendOpen: false,
          hasRedraft: false,
          publishRefusedAt: { [redraftBuilt.dto.pool.id]: refusedAt },
        },
      };
    }
    case 'admin-tokens': {
      // The token summary of the league admin page's Draft tab (the only place it lives): balances and the
      // Comeback switch, which goes through the fake's `setComebackOpen`, so it renders fetch-free.
      const initial = withPoolId(completedDraft(now, id, DAWN, true), 'preview-pool-admin-tokens-initial');
      const tokens = tokenOverview(now, 'closed', true, initial.dto);
      const scenario = scenarioOf(id, initial, { tokens, isSiteAdmin: true, screen: 'tokenAdmin' });
      return {
        ...scenario,
        admin: {
          pools: [{ summary: summaryOf(initial.dto), init: scenario.init }],
          participants: ADMIN_PARTICIPANTS,
          comebackSpendOpen: false,
          hasRedraft: false,
        },
      };
    }
    case 'admin-audit': {
      const built = initialDraft({ now, played: DAWN_TURN + 1, scenarioId: id, admin: true });
      const scenario = scenarioOf(id, built, { isSiteAdmin: true, screen: 'audit', audit: auditLog(now, built.dto) });
      return {
        ...scenario,
        admin: {
          pools: [{ summary: summaryOf(built.dto), init: scenario.init }],
          participants: ADMIN_PARTICIPANTS,
          comebackSpendOpen: false,
          hasRedraft: false,
        },
      };
    }
    case 'admin-room':
      // Dawn administers the league and watches someone else's pick: the clock row's Admin button and,
      // under the DRAFT button, the admin override switch. Players never see either.
      return scenarioOf(id, initialDraft({ now, played: WAITING_PLAYED, scenarioId: id, admin: true }), { isSiteAdmin: true });
    case 'admin-room-sheet': {
      // The admin sheet open on its Live tab over a paused draft: the room keeps the "Draft paused"
      // banner in its clock row, the sheet repeats it in its header; Picks allows void/correct (paused).
      const built = initialDraft({ now, played: WAITING_PLAYED, scenarioId: id, admin: true });
      const slot = built.dto.active_slot;
      return scenarioOf(
        id,
        {
          queue: built.queue,
          dto: {
            ...built.dto,
            pool: { ...built.dto.pool, paused: true, paused_at: iso(now - 2 * 60_000), pause_reason: 'admin' },
            active_slot: slot ? { ...slot, deadline_at: null, remaining_ms_at_pause: 95_000 } : null,
          },
        },
        { isSiteAdmin: true, preset: { adminTab: 'live' } },
      );
    }
    case 'admin-room-refused': {
      // The room of a Redraft past its deadline whose automatic publish the tick refused, with the admin sheet
      // open on its Redraft tab: the tab's submissions read (`publish_refused_at`) shows the amber
      // "Automatic publish refused at <time>" notice above the deadline and the submissions.
      const redraft = redraftState(now, 'locked', id, true);
      return scenarioOf(id, redraft, {
        isSiteAdmin: true,
        preset: { adminTab: 'redraft' },
        submission: redraft.submission,
        adminSubmissions: redraft.adminSubmissions,
        adminPublishRefusedAt: iso(now - 25 * 60_000),
      });
    }
    case 'tokens-before': {
      const built = initialDraft({ now, played: DAWN_TURN, scenarioId: id });
      return scenarioOf(id, built, { tokens: tokenOverview(now, 'before', false, built.dto), screen: 'tokens' });
    }
    case 'tokens-open': {
      const built = completedDraft(now, id);
      return scenarioOf(id, built, { tokens: tokenOverview(now, 'open', false, built.dto), screen: 'tokens' });
    }
    case 'tokens-comeback': {
      const built = completedDraft(now, id);
      return scenarioOf(id, built, { tokens: tokenOverview(now, 'closed', true, built.dto), screen: 'tokens' });
    }
    case 'many-drafted':
      return scenarioOf(id, initialDraft({ now, played: MANY_DRAFTED, scenarioId: id }));
  }
}
