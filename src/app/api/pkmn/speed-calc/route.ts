import { NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getBaseStats } from '@/lib/pkmn/dex';
import { calcSpeed } from '@/lib/pkmn/speed-calc';
import type { ApiResult } from '@/types/api';
import type { SpeedCalcRequest, SpeedCalcResponse, SpeedSolution } from '@/types/speed';

// Natures that boost speed
const SPEED_NATURES: { name: string; effect: 'positive' | 'neutral' | 'negative' }[] = [
  { name: 'Jolly', effect: 'positive' },
  { name: 'Timid', effect: 'positive' },
  { name: 'Hasty', effect: 'positive' },
  { name: 'Naive', effect: 'positive' },
  { name: 'Serious', effect: 'neutral' },
  { name: 'Adamant', effect: 'neutral' },
  { name: 'Modest', effect: 'neutral' },
  { name: 'Brave', effect: 'negative' },
  { name: 'Relaxed', effect: 'negative' },
  { name: 'Quiet', effect: 'negative' },
  { name: 'Sassy', effect: 'negative' },
];

export async function POST(req: Request) {
  try {
    const body: SpeedCalcRequest = await req.json();
    const info = getBaseStats(body.species);

    if (!info) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Unknown species: ${body.species}`, code: 'unknown_species', params: { pokemon: String(body.species) } },
        { status: 404 },
      );
    }

    const baseSpe = info.baseStats.spe;
    const level = body.level ?? 100;
    const maxEv = body.constraints?.max_ev ?? 252;
    const natureFilter = body.constraints?.nature ?? 'any';

    const solutions: SpeedSolution[] = [];

    // Try each applicable nature
    for (const nat of SPEED_NATURES) {
      if (natureFilter !== 'any' && nat.effect !== natureFilter) continue;

      // Binary search for minimum EVs needed
      let low = 0;
      let high = maxEv;
      let bestEv = -1;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const result = calcSpeed({
          baseSpe,
          level,
          ev: mid,
          iv: 31,
          nature: nat.effect,
          item: body.item,
          ability: body.ability,
        });

        if (result.final > body.target_speed) {
          bestEv = mid;
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }

      if (bestEv >= 0) {
        // Round up to nearest 4 (EVs are applied in groups of 4)
        const roundedEv = Math.ceil(bestEv / 4) * 4;
        const finalResult = calcSpeed({
          baseSpe, level, ev: roundedEv, iv: 31, nature: nat.effect,
          item: body.item, ability: body.ability,
        });

        solutions.push({
          nature: nat.name,
          ev: roundedEv,
          resulting_speed: finalResult.final,
          remaining_evs: 510 - roundedEv, // Approximate — doesn't know other EVs
          label: `${nat.name} ${roundedEv} Spe (speed: ${finalResult.final})`,
        });
      }
    }

    // Sort by EV investment (least EVs = best solution)
    solutions.sort((a, b) => a.ev - b.ev);

    // Deduplicate same EV + same speed
    const unique = solutions.filter((s, i, arr) =>
      i === 0 || s.ev !== arr[i - 1].ev || s.resulting_speed !== arr[i - 1].resulting_speed
    );

    const response: SpeedCalcResponse = {
      solutions: unique,
      impossible: unique.length === 0,
      note: unique.length === 0
        ? body.item?.toLowerCase() !== 'choice scarf'
          ? 'Not possible. Consider Choice Scarf or a speed-boosting ability.'
          : 'Not possible even with Choice Scarf at max investment.'
        : undefined,
    };

    return NextResponse.json<ApiResult<SpeedCalcResponse>>({
      success: true,
      data: response,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to calculate speed');
  }
}
