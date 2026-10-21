import { describe, expect, it } from 'vitest';
import { epbPack } from '@/lib/format-pack';
import { formatRulesSchema } from '../schemas';

describe('formatRulesSchema tera_rules (format pack)', () => {
  it("accepts exactly the active pack's Tera rules", () => {
    expect(formatRulesSchema.safeParse({ tera_rules: { ...epbPack.teraByStage } }).success).toBe(true);
  });

  it('rejects a stage that differs from the pack', () => {
    for (const stage of ['stage1', 'stage2', 'stage3'] as const) {
      const other = (['any', 'stab_only', 'none'] as const).find((v) => v !== epbPack.teraByStage[stage]);
      const tera = { ...epbPack.teraByStage, [stage]: other };
      expect(formatRulesSchema.safeParse({ tera_rules: tera }).success, stage).toBe(false);
    }
  });

  it('keeps tera_rules optional', () => {
    expect(formatRulesSchema.safeParse({ draft_budget: 50 }).success).toBe(true);
  });
});
