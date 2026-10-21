import { describe, it, expect } from 'vitest';
import { assignSerpentine, groupLabel } from '@/lib/tournament/serpentine';

describe('assignSerpentine', () => {
  it('assigns two-group serpentine 1→A, 2→B, 3→B, 4→A', () => {
    const seeds = [
      { player_id: 'p1', seed: 1 },
      { player_id: 'p2', seed: 2 },
      { player_id: 'p3', seed: 3 },
      { player_id: 'p4', seed: 4 },
    ];
    const buckets = assignSerpentine(seeds, 2);
    expect(buckets.get(0)).toEqual(['p1', 'p4']);
    expect(buckets.get(1)).toEqual(['p2', 'p3']);
  });

  it('distributes across three groups in snake order', () => {
    const seeds = Array.from({ length: 6 }, (_, i) => ({
      player_id: `p${i + 1}`,
      seed: i + 1,
    }));
    const buckets = assignSerpentine(seeds, 3);
    expect(buckets.get(0)).toEqual(['p1', 'p6']);
    expect(buckets.get(1)).toEqual(['p2', 'p5']);
    expect(buckets.get(2)).toEqual(['p3', 'p4']);
  });
});

describe('groupLabel', () => {
  it('labels groups A, B, C', () => {
    expect(groupLabel(0)).toBe('A');
    expect(groupLabel(1)).toBe('B');
    expect(groupLabel(2)).toBe('C');
  });
});
