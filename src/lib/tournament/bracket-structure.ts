import type { BracketType } from '@/types/tournament';
import type { BracketSide } from '@/types/match';
import { bracketOrder } from './single-elim';

/** How a bracket slot receives a participant. */
export type FeederKind = 'seed' | 'bye' | 'winner' | 'loser';

export interface FeederDef {
  kind: FeederKind;
  /** 1-indexed seed for round-1 entrants */
  seed?: number;
  /** Source slot key for winner/loser feeders */
  slotKey?: string;
}

export interface BracketSlotDef {
  slotKey: string;
  bracket_side: BracketSide;
  side_round_index: number;
  bracket_pos: number;
  global_round_number: number;
  round_name: string;
  feeder1: FeederDef;
  feeder2: FeederDef;
  /** True for the double-elim bracket reset ("if necessary" grand final). */
  isBracketReset?: boolean;
}

export interface BracketRoundDef {
  name: string;
  bracket_side: BracketSide;
  round_number: number;
}

export interface BracketStructure {
  rounds: BracketRoundDef[];
  slots: BracketSlotDef[];
}

/** Optional knobs for structure building. */
export interface BracketStructureOptions {
  /**
   * Double elimination only: include the conditional "if necessary" Grand
   * Finals reset slot in the graph. Defaults to true; a tournament can toggle
   * this at any time (`tournaments.bracket_reset_enabled`) — propagation and
   * repair re-derive the graph from the current setting.
   */
  bracketResetEnabled?: boolean;
}

function defaultBracketResetEnabled(options?: BracketStructureOptions): boolean {
  return options?.bracketResetEnabled ?? true;
}

function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function makeSlot(
  bracket_side: BracketSide,
  side_round_index: number,
  bracket_pos: number,
  global_round_number: number,
  round_name: string,
  feeder1: FeederDef,
  feeder2: FeederDef
): BracketSlotDef {
  const prefix = bracket_side === 'grand_finals' ? 'gf' : bracket_side === 'losers' ? 'l' : 'w';
  return {
    slotKey: `${prefix}-${side_round_index}-${bracket_pos}`,
    bracket_side,
    side_round_index,
    bracket_pos,
    global_round_number,
    round_name,
    feeder1,
    feeder2,
  };
}

function winnersRoundName(
  sideRoundIndex: number,
  totalWbRounds: number,
  isDoubleElim = false
): string {
  const remaining = totalWbRounds - sideRoundIndex;
  if (remaining === 1) return isDoubleElim ? 'Winners Finals' : 'Finals';
  if (remaining === 2) return 'Semifinals';
  if (remaining === 3) return 'Quarterfinals';
  return `Winners Round ${sideRoundIndex + 1}`;
}

function losersRoundName(sideRoundIndex: number, isFinal: boolean): string {
  if (isFinal) return 'Losers Finals';
  return `Losers Round ${sideRoundIndex + 1}`;
}

export interface BracketStructureParticipant {
  seed: number | null;
  starting_bracket?: 'winners' | 'losers';
  name?: string;
}

export interface BracketStructureInputs {
  participantCount: number;
  /** 1-indexed positions in seed order that start in the losers bracket. */
  lbStarterSeeds: ReadonlySet<number>;
}

/** Same seed order as `getParticipants()`: seeded ascending, unseeded last, then name. */
export function sortParticipantsBySeed<T extends { seed: number | null; name?: string }>(
  participants: readonly T[]
): T[] {
  return [...participants].sort((a, b) => {
    if (a.seed !== null && b.seed !== null) return a.seed - b.seed;
    if (a.seed !== null) return -1;
    if (b.seed !== null) return 1;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });
}

export function bracketStructureInputsFromParticipants(
  participants: readonly BracketStructureParticipant[]
): BracketStructureInputs {
  const ordered = sortParticipantsBySeed(participants);
  const lbStarterSeeds = new Set<number>();
  ordered.forEach((participant, index) => {
    if (participant.starting_bracket === 'losers') {
      lbStarterSeeds.add(index + 1);
    }
  });
  return { participantCount: ordered.length, lbStarterSeeds };
}

function normalizeLbStarterSeeds(
  participantCount: number,
  lbStarterSeeds?: ReadonlySet<number>
): number[] {
  if (!lbStarterSeeds || lbStarterSeeds.size === 0) return [];
  return [...lbStarterSeeds]
    .filter((seed) => Number.isInteger(seed) && seed >= 1 && seed <= participantCount)
    .sort((a, b) => a - b);
}

function wbSeedsFromPartition(participantCount: number, lbSeeds: ReadonlySet<number>): number[] {
  const wbSeeds: number[] = [];
  for (let seed = 1; seed <= participantCount; seed++) {
    if (!lbSeeds.has(seed)) wbSeeds.push(seed);
  }
  return wbSeeds;
}

function actualSeedFeeder(wbSeeds: number[], localSeed: number): FeederDef {
  if (localSeed < 1 || localSeed > wbSeeds.length) return { kind: 'bye' };
  return { kind: 'seed', seed: wbSeeds[localSeed - 1] };
}

/** True when a slot has a bye on either side (a bye slot produces no loser). */
function isByeSlot(slot: BracketSlotDef): boolean {
  return slot.feeder1.kind === 'bye' || slot.feeder2.kind === 'bye';
}

/** Loser feeders only for real (non-bye) slots — bye slots produce no loser. */
function realLoserFeeders(slots: BracketSlotDef[]): FeederDef[] {
  return slots
    .filter((s) => !isByeSlot(s))
    .map((s) => ({ kind: 'loser', slotKey: s.slotKey }));
}

/**
 * Pair LB winners against WB losers for a drop-in round. Winners are paired
 * against the reversed loser list to avoid instant rematches; leftover winners
 * or losers pair among themselves and the odd one receives a bye.
 */
function pairDropIn(
  lbWinners: FeederDef[],
  wbLosers: FeederDef[]
): Array<[FeederDef, FeederDef]> {
  const pairs: Array<[FeederDef, FeederDef]> = [];
  const n = Math.min(lbWinners.length, wbLosers.length);
  for (let i = 0; i < n; i++) {
    pairs.push([lbWinners[i], wbLosers[wbLosers.length - 1 - i]]);
  }
  const lbLeft = lbWinners.slice(n);
  for (let i = 0; i + 1 < lbLeft.length; i += 2) {
    pairs.push([lbLeft[i], lbLeft[i + 1]]);
  }
  if (lbLeft.length % 2 === 1) {
    pairs.push([lbLeft[lbLeft.length - 1], { kind: 'bye' }]);
  }
  const wbLeft = wbLosers.slice(0, wbLosers.length - n);
  for (let i = 0; i + 1 < wbLeft.length; i += 2) {
    pairs.push([wbLeft[i], wbLeft[i + 1]]);
  }
  if (wbLeft.length % 2 === 1) {
    pairs.push([wbLeft[wbLeft.length - 1], { kind: 'bye' }]);
  }
  return pairs;
}

/** Seeded Losers Round 1 for LB starters, paired among themselves. */
function buildSeededLosersRound1(
  lbSeeds: number[],
  globalRound: number
): { round: BracketRoundDef; slots: BracketSlotDef[] } {
  const lbCount = lbSeeds.length;
  const lbBracketSize = nextPowerOf2(Math.max(lbCount, 2));
  const lbOrder = bracketOrder(lbBracketSize);
  const name = losersRoundName(0, false);
  const round: BracketRoundDef = { name, bracket_side: 'losers', round_number: globalRound };
  const slots: BracketSlotDef[] = [];
  for (let i = 0; i < lbBracketSize / 2; i++) {
    const p1 = lbOrder[i * 2];
    const p2 = lbOrder[i * 2 + 1];
    slots.push(
      makeSlot(
        'losers',
        0,
        i,
        globalRound,
        name,
        p1 <= lbCount ? { kind: 'seed', seed: lbSeeds[p1 - 1] } : { kind: 'bye' },
        p2 <= lbCount ? { kind: 'seed', seed: lbSeeds[p2 - 1] } : { kind: 'bye' }
      )
    );
  }
  return { round, slots };
}

/**
 * Create + append the "if necessary" bracket reset slot after a grand final.
 * Shares the Grand Finals round (renders in the same column) and materializes
 * conditionally — see `materializeReadySlots`.
 */
function appendBracketReset(slots: BracketSlotDef[], gf: BracketSlotDef): void {
  const reset = makeSlot(
    'grand_finals',
    0,
    1,
    gf.global_round_number,
    'Grand Finals Reset',
    { kind: 'winner', slotKey: gf.slotKey },
    { kind: 'loser', slotKey: gf.slotKey }
  );
  reset.isBracketReset = true;
  slots.push(reset);
}

function appendGrandFinal(
  rounds: BracketRoundDef[],
  slots: BracketSlotDef[],
  globalRound: number,
  wbFinalKey: string,
  lbFinalKey: string,
  bracketResetEnabled: boolean
): void {
  const gfName = 'Grand Finals';
  rounds.push({ name: gfName, bracket_side: 'grand_finals', round_number: globalRound });
  const gf = makeSlot(
    'grand_finals',
    0,
    0,
    globalRound,
    gfName,
    { kind: 'winner', slotKey: wbFinalKey },
    { kind: 'winner', slotKey: lbFinalKey }
  );
  slots.push(gf);

  if (bracketResetEnabled) {
    appendBracketReset(slots, gf);
  }
}

/**
 * Double-elim graph when some participants start in the losers bracket.
 *
 * Partition: one seed-ordered list (positions 1..N). WB is sized by WB
 * starters and uses traditional seeding on that cohort. LB starters enter
 * Losers Round 1 paired among themselves; WB R1 losers then drop into
 * Losers Round 2, and each subsequent WB round's losers drop in every other
 * LB round (standard staggered drop-ins). All-LB rosters fall back to the
 * standard all-WB graph.
 */
function buildDoubleElimWithLbStarts(
  wbSeeds: number[],
  lbSeeds: number[],
  bracketResetEnabled: boolean
): BracketStructure {
  const rounds: BracketRoundDef[] = [];
  const slots: BracketSlotDef[] = [];
  const wbByRound: BracketSlotDef[][] = [];
  const lbByRound: BracketSlotDef[][] = [];
  let globalRound = 1;

  const wbCount = wbSeeds.length;
  const bracketSize = nextPowerOf2(Math.max(wbCount, 1));
  const wbRoundCount = Math.log2(bracketSize);

  // Single WB starter: it auto-advances and the LB starters consolidate alone.
  if (wbRoundCount === 0) {
    const wbName = 'Winners Finals';
    rounds.push({ name: wbName, bracket_side: 'winners', round_number: globalRound });
    const wbFinal = makeSlot(
      'winners',
      0,
      0,
      globalRound,
      wbName,
      { kind: 'seed', seed: wbSeeds[0] },
      { kind: 'bye' }
    );
    wbByRound.push([wbFinal]);
    slots.push(wbFinal);
    globalRound++;

    const { round: lbR1Round, slots: lbR1Slots } = buildSeededLosersRound1(lbSeeds, globalRound);
    rounds.push(lbR1Round);
    lbByRound.push(lbR1Slots);
    slots.push(...lbR1Slots);
    globalRound++;

    while (lbByRound[lbByRound.length - 1].length > 1) {
      const prev = lbByRound[lbByRound.length - 1];
      const name = losersRoundName(lbByRound.length, false);
      rounds.push({ name, bracket_side: 'losers', round_number: globalRound });
      const next: BracketSlotDef[] = [];
      for (let i = 0; i < Math.floor(prev.length / 2); i++) {
        next.push(
          makeSlot(
            'losers',
            lbByRound.length,
            i,
            globalRound,
            name,
            { kind: 'winner', slotKey: prev[i * 2].slotKey },
            { kind: 'winner', slotKey: prev[i * 2 + 1].slotKey }
          )
        );
      }
      if (prev.length % 2 === 1) {
        next.push(
          makeSlot(
            'losers',
            lbByRound.length,
            next.length,
            globalRound,
            name,
            { kind: 'winner', slotKey: prev[prev.length - 1].slotKey },
            { kind: 'bye' }
          )
        );
      }
      lbByRound.push(next);
      slots.push(...next);
      globalRound++;
    }

    const lastLb = lbByRound[lbByRound.length - 1];
    lastLb[0].round_name = 'Losers Finals';
    const lastRound = rounds.find((r) => r.round_number === lastLb[0].global_round_number);
    if (lastRound) lastRound.name = 'Losers Finals';

    appendGrandFinal(rounds, slots, globalRound, wbFinal.slotKey, lastLb[0].slotKey, bracketResetEnabled);
    return { rounds, slots };
  }

  const order = bracketOrder(bracketSize);
  const r1Name = winnersRoundName(0, wbRoundCount, true);
  rounds.push({ name: r1Name, bracket_side: 'winners', round_number: globalRound });
  const wbR1: BracketSlotDef[] = [];
  for (let i = 0; i < bracketSize / 2; i++) {
    wbR1.push(
      makeSlot(
        'winners',
        0,
        i,
        globalRound,
        r1Name,
        actualSeedFeeder(wbSeeds, order[i * 2]),
        actualSeedFeeder(wbSeeds, order[i * 2 + 1])
      )
    );
  }
  wbByRound.push(wbR1);
  slots.push(...wbR1);
  globalRound++;

  const { round: lbR1Round, slots: lbR1Slots } = buildSeededLosersRound1(lbSeeds, globalRound);
  rounds.push(lbR1Round);
  lbByRound.push(lbR1Slots);
  slots.push(...lbR1Slots);
  globalRound++;

  // Staggered drop-ins: WB losers enter every other LB round, starting at LB R2.
  let wbLosers = realLoserFeeders(wbR1);
  for (let wr = 0; wr < wbRoundCount; wr++) {
    const prevLb = lbByRound[lbByRound.length - 1];
    const lbWinners: FeederDef[] = prevLb.map((s) => ({ kind: 'winner', slotKey: s.slotKey }));

    const dropPairs = pairDropIn(lbWinners, wbLosers);
    const isLastDropIn = wr === wbRoundCount - 1;
    const dropName = losersRoundName(lbByRound.length, isLastDropIn);
    rounds.push({ name: dropName, bracket_side: 'losers', round_number: globalRound });
    const lbDrop = dropPairs.map((pair, i) =>
      makeSlot('losers', lbByRound.length, i, globalRound, dropName, pair[0], pair[1])
    );
    lbByRound.push(lbDrop);
    slots.push(...lbDrop);
    globalRound++;

    if (wr < wbRoundCount - 1) {
      const lbConsolName = losersRoundName(lbByRound.length, false);
      rounds.push({ name: lbConsolName, bracket_side: 'losers', round_number: globalRound });
      const lbConsol: BracketSlotDef[] = [];
      const pairCount = Math.floor(lbDrop.length / 2);
      for (let i = 0; i < pairCount; i++) {
        lbConsol.push(
          makeSlot(
            'losers',
            lbByRound.length,
            i,
            globalRound,
            lbConsolName,
            { kind: 'winner', slotKey: lbDrop[i * 2].slotKey },
            { kind: 'winner', slotKey: lbDrop[i * 2 + 1].slotKey }
          )
        );
      }
      if (lbDrop.length % 2 === 1) {
        lbConsol.push(
          makeSlot(
            'losers',
            lbByRound.length,
            lbConsol.length,
            globalRound,
            lbConsolName,
            { kind: 'winner', slotKey: lbDrop[lbDrop.length - 1].slotKey },
            { kind: 'bye' }
          )
        );
      }
      lbByRound.push(lbConsol);
      slots.push(...lbConsol);
      globalRound++;

      const prevWb = wbByRound[wr];
      const wbName = winnersRoundName(wr + 1, wbRoundCount, true);
      rounds.push({ name: wbName, bracket_side: 'winners', round_number: globalRound });
      const wbRound: BracketSlotDef[] = [];
      for (let i = 0; i < prevWb.length / 2; i++) {
        wbRound.push(
          makeSlot(
            'winners',
            wr + 1,
            i,
            globalRound,
            wbName,
            { kind: 'winner', slotKey: prevWb[i * 2].slotKey },
            { kind: 'winner', slotKey: prevWb[i * 2 + 1].slotKey }
          )
        );
      }
      wbByRound.push(wbRound);
      slots.push(...wbRound);
      globalRound++;
      wbLosers = realLoserFeeders(wbRound);
    }
  }

  const lastLb = lbByRound[lbByRound.length - 1];
  if (lastLb.length === 1) {
    lastLb[0].round_name = 'Losers Finals';
    const lastRound = rounds.find((r) => r.round_number === lastLb[0].global_round_number);
    if (lastRound) lastRound.name = 'Losers Finals';
  }

  const wbFinal = wbByRound[wbByRound.length - 1][0];
  const lbFinal = lbByRound[lbByRound.length - 1][0];
  appendGrandFinal(rounds, slots, globalRound, wbFinal.slotKey, lbFinal.slotKey, bracketResetEnabled);
  return { rounds, slots };
}

/**
 * Build the complete single-elimination slot graph with traditional seeding.
 * participantIds must be ordered by seed (index 0 = seed 1).
 */
export function buildSingleElimStructure(participantCount: number): BracketStructure {
  const bracketSize = nextPowerOf2(participantCount);
  const wbRoundCount = Math.log2(bracketSize);
  const order = bracketOrder(bracketSize);

  const rounds: BracketRoundDef[] = [];
  const slots: BracketSlotDef[] = [];
  const wbByRound: BracketSlotDef[][] = [];
  let globalRound = 1;

  const r1Slots: BracketSlotDef[] = [];
  const r1Name = winnersRoundName(0, wbRoundCount);
  rounds.push({ name: r1Name, bracket_side: 'winners', round_number: globalRound });

  for (let i = 0; i < bracketSize / 2; i++) {
    const seed1 = order[i * 2];
    const seed2 = order[i * 2 + 1];
    const feeder1: FeederDef =
      seed1 <= participantCount ? { kind: 'seed', seed: seed1 } : { kind: 'bye' };
    const feeder2: FeederDef =
      seed2 <= participantCount ? { kind: 'seed', seed: seed2 } : { kind: 'bye' };
    r1Slots.push(
      makeSlot('winners', 0, i, globalRound, r1Name, feeder1, feeder2)
    );
  }
  wbByRound.push(r1Slots);
  slots.push(...r1Slots);
  globalRound++;

  for (let wr = 1; wr < wbRoundCount; wr++) {
    const prev = wbByRound[wr - 1];
    const name = winnersRoundName(wr, wbRoundCount);
    rounds.push({ name, bracket_side: 'winners', round_number: globalRound });
    const wrSlots: BracketSlotDef[] = [];
    for (let i = 0; i < prev.length / 2; i++) {
      wrSlots.push(
        makeSlot(
          'winners',
          wr,
          i,
          globalRound,
          name,
          { kind: 'winner', slotKey: prev[i * 2].slotKey },
          { kind: 'winner', slotKey: prev[i * 2 + 1].slotKey }
        )
      );
    }
    wbByRound.push(wrSlots);
    slots.push(...wrSlots);
    globalRound++;
  }

  return { rounds, slots };
}

/**
 * Build the complete double-elimination slot graph. When `bracketResetEnabled`
 * (default true) every DE graph carries the conditional "if necessary" Grand
 * Finals reset slot; pass false to build a single-grand-final graph.
 * `lbStarterSeeds` are 1-indexed positions in the seed-ordered participant list.
 */
export function buildDoubleElimStructure(
  participantCount: number,
  lbStarterSeeds?: ReadonlySet<number>,
  bracketResetEnabled = true
): BracketStructure {
  const lbSeeds = normalizeLbStarterSeeds(participantCount, lbStarterSeeds);
  const lbSet = new Set(lbSeeds);
  const wbSeeds = wbSeedsFromPartition(participantCount, lbSet);
  // All-LB rosters have no WB champion — fall back to the standard all-WB graph.
  if (lbSeeds.length > 0 && wbSeeds.length >= 1) {
    return buildDoubleElimWithLbStarts(wbSeeds, lbSeeds, bracketResetEnabled);
  }
  const bracketSize = nextPowerOf2(participantCount);
  const wbRoundCount = Math.log2(bracketSize);

  const rounds: BracketRoundDef[] = [];
  const slots: BracketSlotDef[] = [];
  const wbByRound: BracketSlotDef[][] = [];
  const lbByRound: BracketSlotDef[][] = [];
  let globalRound = 1;

  // Winners bracket round 1
  const order = bracketOrder(bracketSize);
  const r1Name = winnersRoundName(0, wbRoundCount, true);
  rounds.push({ name: r1Name, bracket_side: 'winners', round_number: globalRound });
  const wbR1: BracketSlotDef[] = [];
  for (let i = 0; i < bracketSize / 2; i++) {
    const seed1 = order[i * 2];
    const seed2 = order[i * 2 + 1];
    wbR1.push(
      makeSlot(
        'winners',
        0,
        i,
        globalRound,
        r1Name,
        seed1 <= participantCount ? { kind: 'seed', seed: seed1 } : { kind: 'bye' },
        seed2 <= participantCount ? { kind: 'seed', seed: seed2 } : { kind: 'bye' }
      )
    );
  }
  wbByRound.push(wbR1);
  slots.push(...wbR1);
  globalRound++;

  // Two-player DE has a single WB finals slot; there is no losers bracket.
  // Grand Finals is winner(WB Finals) vs loser(WB Finals).
  if (wbRoundCount === 1) {
    const wbFinal = wbR1[0];
    const gfName = 'Grand Finals';
    rounds.push({ name: gfName, bracket_side: 'grand_finals', round_number: globalRound });
    const gf = makeSlot(
      'grand_finals',
      0,
      0,
      globalRound,
      gfName,
      { kind: 'winner', slotKey: wbFinal.slotKey },
      { kind: 'loser', slotKey: wbFinal.slotKey }
    );
    slots.push(gf);
    if (bracketResetEnabled) {
      appendBracketReset(slots, gf);
    }
    return { rounds, slots };
  }

  // Losers bracket round 1 — pair losers from WB R1
  const lbR1Name = losersRoundName(0, false);
  rounds.push({ name: lbR1Name, bracket_side: 'losers', round_number: globalRound });
  const lbR1: BracketSlotDef[] = [];
  for (let i = 0; i < wbR1.length / 2; i++) {
    lbR1.push(
      makeSlot(
        'losers',
        0,
        i,
        globalRound,
        lbR1Name,
        { kind: 'loser', slotKey: wbR1[i * 2].slotKey },
        { kind: 'loser', slotKey: wbR1[i * 2 + 1].slotKey }
      )
    );
  }
  lbByRound.push(lbR1);
  slots.push(...lbR1);
  globalRound++;

  // Remaining WB rounds + interleaved LB rounds
  for (let wr = 1; wr < wbRoundCount; wr++) {
    const prevWb = wbByRound[wr - 1];
    const wbName = winnersRoundName(wr, wbRoundCount, true);
    rounds.push({ name: wbName, bracket_side: 'winners', round_number: globalRound });
    const wbSlots: BracketSlotDef[] = [];
    for (let i = 0; i < prevWb.length / 2; i++) {
      wbSlots.push(
        makeSlot(
          'winners',
          wr,
          i,
          globalRound,
          wbName,
          { kind: 'winner', slotKey: prevWb[i * 2].slotKey },
          { kind: 'winner', slotKey: prevWb[i * 2 + 1].slotKey }
        )
      );
    }
    wbByRound.push(wbSlots);
    slots.push(...wbSlots);
    globalRound++;

    // LB drop-in: previous LB winners vs losers from this WB round (reversed
    // pairing avoids instant rematches of the same-index WB pairing).
    const prevLb = lbByRound[lbByRound.length - 1];
    const wbRound = wbByRound[wr];
    const isLastDropIn = wr === wbRoundCount - 1;
    const lbDropName = losersRoundName(lbByRound.length, isLastDropIn);
    rounds.push({ name: lbDropName, bracket_side: 'losers', round_number: globalRound });
    const lbDrop: BracketSlotDef[] = [];
    for (let i = 0; i < prevLb.length; i++) {
      lbDrop.push(
        makeSlot(
          'losers',
          lbByRound.length,
          i,
          globalRound,
          lbDropName,
          { kind: 'winner', slotKey: prevLb[i].slotKey },
          { kind: 'loser', slotKey: wbRound[wbRound.length - 1 - i].slotKey }
        )
      );
    }
    lbByRound.push(lbDrop);
    slots.push(...lbDrop);
    globalRound++;

    // LB consolidation when multiple LB matches remain (not after last WB round)
    if (wr < wbRoundCount - 1 && lbDrop.length > 1) {
      const lbConsolName = losersRoundName(lbByRound.length, false);
      rounds.push({ name: lbConsolName, bracket_side: 'losers', round_number: globalRound });
      const lbConsol: BracketSlotDef[] = [];
      for (let i = 0; i < lbDrop.length / 2; i++) {
        lbConsol.push(
          makeSlot(
            'losers',
            lbByRound.length,
            i,
            globalRound,
            lbConsolName,
            { kind: 'winner', slotKey: lbDrop[i * 2].slotKey },
            { kind: 'winner', slotKey: lbDrop[i * 2 + 1].slotKey }
          )
        );
      }
      lbByRound.push(lbConsol);
      slots.push(...lbConsol);
      globalRound++;
    }
  }

  const wbFinal = wbByRound[wbRoundCount - 1][0];
  const lastLb = lbByRound[lbByRound.length - 1][0];

  // Grand final — last LB drop-in is already Losers Finals (WB finals loser).
  const gfName = 'Grand Finals';
  rounds.push({ name: gfName, bracket_side: 'grand_finals', round_number: globalRound });
  const gf = makeSlot(
    'grand_finals',
    0,
    0,
    globalRound,
    gfName,
    { kind: 'winner', slotKey: wbFinal.slotKey },
    { kind: 'winner', slotKey: lastLb.slotKey }
  );
  slots.push(gf);

  if (bracketResetEnabled) {
    appendBracketReset(slots, gf);
  }

  return { rounds, slots };
}

export function buildBracketStructure(
  bracketType: BracketType,
  participantCount: number,
  lbStarterSeeds?: ReadonlySet<number>,
  options?: BracketStructureOptions
): BracketStructure | null {
  if (participantCount < 2) return null;
  switch (bracketType) {
    case 'single_elim':
      return buildSingleElimStructure(participantCount);
    case 'double_elim':
      return buildDoubleElimStructure(
        participantCount,
        lbStarterSeeds,
        defaultBracketResetEnabled(options)
      );
    default:
      return null;
  }
}

/** Single callsite helper — every structure build must go through this. */
export function buildBracketStructureForParticipants(
  bracketType: BracketType,
  participants: readonly BracketStructureParticipant[],
  options?: BracketStructureOptions
): BracketStructure | null {
  const { participantCount, lbStarterSeeds } =
    bracketStructureInputsFromParticipants(participants);
  return buildBracketStructure(bracketType, participantCount, lbStarterSeeds, options);
}

/** Map seed (1-indexed) to participant id using seed-ordered list. */
export function seedToParticipantId(
  seedOrderedParticipantIds: string[],
  seed: number
): string | null {
  const index = seed - 1;
  return index >= 0 && index < seedOrderedParticipantIds.length
    ? seedOrderedParticipantIds[index]
    : null;
}

/** Human label for an unresolved feeder slot (e.g. "Winner of M3"). */
export function feederLabel(
  feeder: FeederDef,
  slotIndexByKey: Map<string, number>,
  options?: { onLosersSide?: boolean }
): string {
  switch (feeder.kind) {
    case 'seed':
      return options?.onLosersSide
        ? `Seed ${feeder.seed} (LB)`
        : `Seed ${feeder.seed}`;
    case 'bye':
      return 'BYE';
    case 'winner':
      return `Winner of M${slotIndexByKey.get(feeder.slotKey ?? '') ?? '?'}`;
    case 'loser':
      return `Loser of M${slotIndexByKey.get(feeder.slotKey ?? '') ?? '?'}`;
    default: {
      const _exhaustive: never = feeder.kind;
      return _exhaustive;
    }
  }
}

/** Build 1-indexed match numbers for display labels. */
export function buildSlotIndexMap(slots: BracketSlotDef[]): Map<string, number> {
  const map = new Map<string, number>();
  slots.forEach((slot, index) => {
    map.set(slot.slotKey, index + 1);
  });
  return map;
}
