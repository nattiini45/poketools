/**
 * Request contract of the public `/api/calc/*` routes (code review H4).
 *
 * Strict zod schemas (unknown keys rejected, bounded strings and numbers),
 * per-request work caps, and the mapping from the HTTP shapes
 * (`src/types/calc.ts`, snake_case side conditions) to the calc engine
 * (`src/lib/pkmn/calc-engine.ts`, @smogon/calc field names).
 */
import { z } from 'zod';
import type { CalcResult, CalcPokemon, CalcField, SideConditions } from '@/types/calc';
import { toKoInfo } from '@/lib/pkmn/i18n/calc-text';
import {
  runDamageCalc,
  buildCalcPokemon,
  type CalcFieldSpec,
  type CalcFieldInstance,
  type CalcGeneration,
  type CalcMonSpec,
  type CalcPokemonInstance,
  type CalcSideSpec,
  type CalcError,
  type Outcome,
} from '@/lib/pkmn/calc-engine';

/** Defenders per `/batch` and attackers per `/batch-incoming` request. */
export const MAX_BATCH_MONS = 20;
/** Moves listed for one Pokémon (sets carry 4; the cap leaves room for projected usage moves). */
export const MAX_MOVES_PER_MON = 10;
/** Total move calcs one request may run (mons × moves). */
export const MAX_CALCS_PER_REQUEST = 80;

const NAME_MAX = 64;

const name = z.string().trim().min(1).max(NAME_MAX);
const optionalName = z.string().trim().max(NAME_MAX).optional();
const ev = z.number().int().min(0).max(252);
const iv = z.number().int().min(0).max(31);
const boost = z.number().int().min(-6).max(6);

const statSpread = <T extends z.ZodTypeAny>(stat: T) =>
  z.strictObject({
    hp: stat.optional(),
    atk: stat.optional(),
    def: stat.optional(),
    spa: stat.optional(),
    spd: stat.optional(),
    spe: stat.optional(),
  });

export const calcPokemonSchema = z.strictObject({
  species: name,
  item: optionalName,
  ability: optionalName,
  nature: optionalName,
  evs: statSpread(ev).optional(),
  ivs: statSpread(iv).optional(),
  level: z.number().int().min(1).max(100).optional(),
  moves: z.array(z.string().trim().max(NAME_MAX)).max(MAX_MOVES_PER_MON).optional(),
  boosts: z
    .strictObject({
      atk: boost.optional(),
      def: boost.optional(),
      spa: boost.optional(),
      spd: boost.optional(),
      spe: boost.optional(),
    })
    .optional(),
  status: z.enum(['brn', 'par', 'psn', 'tox', 'slp', 'frz']).optional(),
  tera_type: optionalName,
  is_tera: z.boolean().optional(),
});

const sideConditionsSchema = z.strictObject({
  spikes: z.number().int().min(0).max(3).optional(),
  stealth_rock: z.boolean().optional(),
  reflect: z.boolean().optional(),
  light_screen: z.boolean().optional(),
  aurora_veil: z.boolean().optional(),
  tailwind: z.boolean().optional(),
  is_helping_hand: z.boolean().optional(),
  is_friend_guard: z.boolean().optional(),
});

export const calcFieldSchema = z.strictObject({
  gameType: z.enum(['Singles', 'Doubles']).optional(),
  weather: z.enum(['', 'Sun', 'Rain', 'Sand', 'Snow', 'Harsh Sunshine', 'Heavy Rain']).optional(),
  terrain: z.enum(['', 'Electric', 'Grassy', 'Misty', 'Psychic']).optional(),
  isBeadsOfRuin: z.boolean().optional(),
  isSwordOfRuin: z.boolean().optional(),
  isTabletsOfRuin: z.boolean().optional(),
  isVesselOfRuin: z.boolean().optional(),
  attackerSide: sideConditionsSchema.optional(),
  defenderSide: sideConditionsSchema.optional(),
});

const generation = z.number().int().min(1).max(9).optional();

/** Moves a mon brings to a calc: its listed moves without blanks. */
export function listedMoves(mon: Pick<CalcPokemon, 'moves'>): string[] {
  return (mon.moves ?? []).filter((m) => m.length > 0);
}

export const calcRequestSchema = z.strictObject({
  generation,
  attacker: calcPokemonSchema,
  defender: calcPokemonSchema,
  move: z.string().trim().max(NAME_MAX).optional(),
  field: calcFieldSchema.optional(),
  allMoves: z.boolean().optional(),
}).superRefine((body, ctx) => {
  if (!body.allMoves && !body.move) {
    ctx.addIssue({ code: 'custom', path: ['move'], message: 'move is required unless allMoves is set' });
  }
});

export const batchCalcRequestSchema = z.strictObject({
  generation,
  attacker: calcPokemonSchema,
  defenders: z.array(calcPokemonSchema).max(MAX_BATCH_MONS, `Max ${MAX_BATCH_MONS} defenders per batch`),
  moves: z.array(z.string().trim().max(NAME_MAX)).max(MAX_MOVES_PER_MON).optional(),
  field: calcFieldSchema.optional(),
}).superRefine((body, ctx) => {
  const moves = (body.moves ?? listedMoves(body.attacker)).filter(Boolean).length;
  if (body.defenders.length * moves > MAX_CALCS_PER_REQUEST) {
    ctx.addIssue({
      code: 'custom',
      path: ['defenders'],
      message: `At most ${MAX_CALCS_PER_REQUEST} calculations (defenders × moves) per request`,
    });
  }
});

export const batchIncomingRequestSchema = z.strictObject({
  generation,
  attackers: z.array(calcPokemonSchema).max(MAX_BATCH_MONS, `Max ${MAX_BATCH_MONS} attackers per batch`),
  defender: calcPokemonSchema,
  field: calcFieldSchema.optional(),
}).superRefine((body, ctx) => {
  const total = body.attackers.reduce((sum, a) => sum + listedMoves(a).length, 0);
  if (total > MAX_CALCS_PER_REQUEST) {
    ctx.addIssue({
      code: 'custom',
      path: ['attackers'],
      message: `At most ${MAX_CALCS_PER_REQUEST} calculations (attacker moves) per request`,
    });
  }
});

/** `GET /api/calc/threats` query. */
export const threatsQuerySchema = z.strictObject({
  format: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i, 'format must be a format id (letters, digits, - or _)'),
  // A positive whole number; values above 20 are capped (as before), anything else is rejected.
  limit: z
    .string()
    .regex(/^\d{1,4}$/, 'limit must be a positive whole number')
    .transform(Number)
    .pipe(z.number().int().min(1, 'limit must be a positive whole number'))
    .transform((n) => Math.min(n, 20))
    .optional(),
  exclude: z
    .string()
    .max(2000)
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().max(NAME_MAX)).max(30, 'exclude lists at most 30 species'))
    .optional(),
});

// ── Mapping ─────────────────────────────────────────────────────────

export function toMonSpec(mon: CalcPokemon): CalcMonSpec {
  return {
    species: mon.species,
    item: mon.item,
    ability: mon.ability,
    nature: mon.nature,
    evs: mon.evs,
    ivs: mon.ivs,
    level: mon.level,
    boosts: mon.boosts,
    status: mon.status,
    teraType: mon.is_tera ? mon.tera_type : undefined,
  };
}

function toSideSpec(side: SideConditions | undefined): CalcSideSpec | undefined {
  if (!side) return undefined;
  return {
    spikes: side.spikes,
    isSR: side.stealth_rock,
    isReflect: side.reflect,
    isLightScreen: side.light_screen,
    isAuroraVeil: side.aurora_veil,
    isTailwind: side.tailwind,
    isHelpingHand: side.is_helping_hand,
    isFriendGuard: side.is_friend_guard,
  };
}

/**
 * HTTP field → engine field. `swapSides` is for incoming damage
 * (`/batch-incoming`): the request's attacker side is the user's side, which
 * DEFENDS in those calcs.
 */
export function toFieldSpec(field: CalcField | undefined, swapSides = false): CalcFieldSpec | undefined {
  if (!field) return undefined;
  const attackerSide = toSideSpec(swapSides ? field.defenderSide : field.attackerSide);
  const defenderSide = toSideSpec(swapSides ? field.attackerSide : field.defenderSide);
  return {
    gameType: field.gameType,
    weather: field.weather || undefined,
    terrain: field.terrain || undefined,
    isBeadsOfRuin: field.isBeadsOfRuin,
    isSwordOfRuin: field.isSwordOfRuin,
    isTabletsOfRuin: field.isTabletsOfRuin,
    isVesselOfRuin: field.isVesselOfRuin,
    attackerSide,
    defenderSide,
  };
}

/** The per-move HTTP result: real numbers, or an explicit `error` (never fabricated zeros). */
export function errorResult(move: string, error: CalcError): CalcResult {
  return { move, error };
}

/** Run one move for already-built mons and shape it as an HTTP {@link CalcResult}. */
export function calcMoveResult(
  gen: CalcGeneration,
  attacker: CalcPokemonInstance,
  defender: CalcPokemonInstance,
  moveName: string,
  field: CalcFieldInstance | undefined,
): CalcResult {
  const outcome = runDamageCalc(gen, attacker, defender, moveName, field);
  if (!outcome.ok) return errorResult(moveName, outcome.error);
  const r = outcome.value;
  return {
    move: r.move,
    damage: r.damage,
    // English text stays (the structured `ko` is the localizable form).
    ko_chance: r.koText,
    ko: toKoInfo(r.ko),
    description: r.description,
    rolls: r.rolls,
  };
}

/** Resolve and build one request mon (dex-checked names; see `buildCalcPokemon`). */
export function buildRequestMon(
  gen: CalcGeneration,
  mon: CalcPokemon,
): Outcome<CalcPokemonInstance> {
  return buildCalcPokemon(gen, toMonSpec(mon));
}
