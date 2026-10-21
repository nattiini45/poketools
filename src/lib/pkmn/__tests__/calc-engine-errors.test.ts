import { describe, expect, it } from 'vitest';
import { errorsStats } from '@/i18n/messages/errors/stats';
import { getGeneration } from '@/lib/pkmn/dex';
import { buildCalcPokemon, CALC_ERROR_CODES, runDamageCalc, type CalcError } from '../calc-engine';

/** Fill `{name}` placeholders the way the client-side translator does. */
function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    if (!(name in params)) throw new Error(`missing param ${name}`);
    return params[name];
  });
}

const en: Record<string, string> = errorsStats.en;
const de: Record<string, string> = errorsStats.de;

function expectCatalogued(error: CalcError): void {
  expect(en[error.code]).toBeTypeOf('string');
  expect(de[error.code]).toBeTypeOf('string');
  // The English message is the catalog text, and every placeholder has a param.
  expect(fill(en[error.code], error.params)).toBe(error.message);
  expect(() => fill(de[error.code], error.params)).not.toThrow();
}

describe('calc per-item error codes (errors/stats catalog)', () => {
  it('every CalcErrorCode is a key in both the en and de catalog', () => {
    for (const code of CALC_ERROR_CODES) {
      expect(en[code], code).toBeTypeOf('string');
      expect(de[code], code).toBeTypeOf('string');
    }
  });

  const gen = getGeneration(9);
  const base = { species: 'Garchomp' };

  it.each([
    ['unknown_species', { species: 'Fakemon' }],
    ['unknown_item', { ...base, item: 'Choice Bandd' }],
    ['unknown_ability', { ...base, ability: 'Nope' }],
    ['unknown_nature', { ...base, nature: 'Grumpy' }],
    ['unknown_tera_type', { ...base, teraType: 'Sound' }],
  ])('%s carries the catalog message and params', (code, spec) => {
    const outcome = buildCalcPokemon(gen, spec);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe(code);
    expectCatalogued(outcome.error);
  });

  it('unknown_move carries the catalog message and params', () => {
    const a = buildCalcPokemon(gen, base);
    const d = buildCalcPokemon(gen, { species: 'Tyranitar' });
    if (!a.ok || !d.ok) throw new Error('fixture mons must build');
    const outcome = runDamageCalc(gen, a.value, d.value, 'Fake Move');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toEqual({ code: 'unknown_move', message: 'Unknown move: Fake Move', params: { move: 'Fake Move' } });
    expectCatalogued(outcome.error);
  });
});
