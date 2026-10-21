/**
 * DL-UI-2 (draft-frontend §8.3/§8.5): the legacy league draft admin components speak the viewer's
 * language through `draft/legacy/league-admin/**`, show Pokémon names through the pkmn layer, use
 * the spec's token names, and render the point-buy reconciliation report (Prompt 0 §8).
 * Rendered through react-dom/server (vitest 'node' env): effects never run, so nothing fetches.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { ReconciliationReport } from '@/lib/draft/reconciliation-report';
import { epbPack, formatPack } from '@/lib/format-pack';
import EpbImportPanel, { ImportReportView } from '../EpbImportPanel';
import EvolutionPointRecalcButton from '../EvolutionPointRecalcButton';
import DraftPoolEditor from '../DraftPoolEditor';
import DraftTierLimitsEditor from '../DraftTierLimitsEditor';
import PointBuyListManager from '../PointBuyListManager';
import EvolutionTierEditor from '../EvolutionTierEditor';

/** The visible text: tags dropped, the entities React escapes here decoded, whitespace collapsed. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,])/g, '$1')
    .trim();

const REPORT: ReconciliationReport = {
  generated_at: '2026-10-01T12:00:00.000Z',
  list_source: 'league-list.xlsx',
  line_count: 3,
  // The active format pack's price tabs.
  price_tabs: epbPack.priceTabs.map((tab, i) => ({ key: tab.key, count: i === 2 ? 0 : 1 })),
  out_of_tab_prices: [],
  sheet_groups: { premium: 1, hoch: 1, mittel: 0, guenstig: 1, budget: 0 },
  branched_bases: [
    {
      base: 'Charmander',
      lines: [
        { line_id: 'charmander--charizard', final: 'Charizard', price: 24, k2: 3, k3: 4 },
        { line_id: 'charmander--charmeleon', final: 'Charmeleon', price: 24, k2: 3, k3: null },
      ],
      thresholds_differ: true,
      same_price: true,
    },
  ],
  unresolved_names: [{ line_id: 'foo--bar', stage: 2, name: 'Barmon', reason: 'not_in_dex' }],
  threshold_conflicts: [
    {
      line_id: 'dratini--dragonite',
      field: 'kills_to_stage2',
      sheet_value: 4,
      applied_value: 5,
      source: 'league override',
    },
  ],
  overrides_applied: [
    { line_id: 'dratini--dragonite', field: 'kills_to_stage2', from: 4, to: 5, reason_en: 'League ruling' },
  ],
  // The example pack has no rule-conflict texts, so the panel falls back to the English detail.
  rule_conflicts: [
    {
      code: 'REPO_ONLY_MECHANIC',
      detail: 'Evolution points: kept from the repo, not in the workbook',
      message_key: 'REPO_ONLY_MECHANIC_EVOLUTION_POINTS',
      params: {},
    },
  ],
  utility: null,
  warnings: ['1 line(s) priced outside every tab (listed under "All" only)'],
  errors: [],
};

// Walks the source tree: under a loaded full suite or a cold clone the walk can pass the
// 5 s default (engine-r3-contract.test.ts uses the same bound).
const FILE_WALK_TIMEOUT_MS = 30_000;

const SHEET = epbPack.workbook.pointBuy.sheet;
const OVERVIEW = epbPack.workbook.pointBuy.overviewSheet ?? '—';
const ROLE_SHEETS = epbPack.workbook.teamRoles.sheets;

describe('EpbImportPanel', () => {
  it('English: the import sections verbatim, sheet names as parser keys', () => {
    const html = text(renderWithI18n(<EpbImportPanel seasonId="s1" seasonName="Season 3" />));
    expect(html).toContain('Point-Buy List (xlsx)');
    // Sheet names are the active format pack's workbook layout.
    expect(html).toContain(`Imports sheet ${SHEET} and validates against ${OVERVIEW}.`);
    expect(html).toContain('and binds Season 3.');
    expect(html).toContain('Team Roles (xlsx)');
    expect(html).toContain(`Imports role tables from ${ROLE_SHEETS[0]} and ${ROLE_SHEETS[1]} sheets`);
    expect(html).toContain('Dry Run');
  });

  it('German: du-form copy, the German sheet names unchanged', () => {
    const html = text(renderWithI18n(<EpbImportPanel seasonId="s1" seasonName="Saison 3" />, { locale: 'de' }));
    expect(html).toContain('Point-Buy-Liste (xlsx)');
    expect(html).toContain(`Importiert das Blatt ${SHEET} und prüft es gegen ${OVERVIEW}.`);
    expect(html).toContain('und bindet Saison 3.');
    expect(html).toContain('Testlauf');
    expect(html).toContain('An diese Liga binden');
    expect(html).not.toContain('Dry Run');
  });
});

describe('ImportReportView with the reconciliation report', () => {
  const report = { total_lines: 3, valid: 3, imported: 0, warnings: [], errors: [], info: [], reconciliation: REPORT };

  it('English: every report section with its labels', () => {
    const html = text(renderWithI18n(<ImportReportView report={report} />));
    expect(html).toContain('Lines: 3/3 valid · imported 0');
    expect(html).toContain('Reconciliation report');
    expect(html).toContain('Source: league-list.xlsx');
    expect(html).toContain('Price tabs');
    expect(html).toContain('Sheet price groups (derived)');
    // Price-group labels come from the active format pack.
    expect(html).toContain(formatPack.messages.en.enums.priceGroup.hoch);
    expect(html).toContain('Branched bases (1 bases / 2 lines)');
    expect(html).toContain('Charmander');
    expect(html).toContain('Threshold conflicts and league overrides');
    expect(html).toContain('League ruling');
    expect(html).toContain('Unresolved stage names');
    expect(html).toContain('Not in the Pokédex');
    expect(html).toContain('Rule conflicts');
    expect(html).toContain('REPO_ONLY_MECHANIC');
    expect(html).toContain('Warnings');
  });

  it('German: labels translated, species through the pkmn layer, server text as sent', () => {
    const html = text(renderWithI18n(<ImportReportView report={report} />, { locale: 'de' }));
    expect(html).toContain('Linien: 3/3 gültig · 0 importiert');
    expect(html).toContain('Abgleichsbericht');
    expect(html).toContain('Preisgruppen laut Arbeitsmappe (abgeleitet)');
    expect(html).toContain(formatPack.messages.de.enums.priceGroup.hoch);
    expect(html).toContain('Verzweigte Basen (1 Basen / 2 Linien)');
    expect(html).toContain('Glumanda');
    expect(html).toContain('Glurak');
    expect(html).toContain('Nicht im Pokédex');
    expect(html).toContain('Regelkonflikte');
    // Server report text stays English data; line ids stay machine ids.
    expect(html).toContain('League ruling');
    // A rule conflict without a pack text for its key shows the server's English detail.
    expect(formatPack.messages.de.ruleConflicts.REPO_ONLY_MECHANIC_EVOLUTION_POINTS).toBeUndefined();
    expect(html).toContain('Evolution points: kept from the repo, not in the workbook');
    expect(html).toContain('charmander--charizard');
  });

  it('sheet price groups: one row per range label, groups that read the same summed', () => {
    const merged = { ...REPORT, sheet_groups: { premium: 1, hoch: 0, mittel: 2, guenstig: 3, budget: 4 } };
    const html = renderWithI18n(<ImportReportView report={{ ...report, reconciliation: merged }} />);
    const section = html.slice(html.indexOf('Sheet price groups (derived)'), html.indexOf('Branched bases'));
    const rows = [...section.matchAll(/<tr[^>]*><td[^>]*>([^<]*)<\/td><td[^>]*>([^<]*)<\/td><\/tr>/g)].map((m) => [m[1], m[2]]);
    const labels = formatPack.messages.en.enums.priceGroup;
    // The active pack files guenstig and budget under one label; the report shows it once.
    expect(labels.guenstig).toBe(labels.budget);
    expect(rows).toEqual([
      [labels.premium, '1'],
      [labels.hoch, '0'],
      [labels.mittel, '2'],
      [labels.guenstig, '7'],
    ]);
  });
});

describe('evolution admin components', () => {
  it('EvolutionPointRecalcButton in both languages', () => {
    expect(text(renderWithI18n(<EvolutionPointRecalcButton seasonId="s1" />))).toContain(
      'Recalculate evolution points',
    );
    expect(text(renderWithI18n(<EvolutionPointRecalcButton seasonId="s1" />, { locale: 'de' }))).toContain(
      'Evolutionspunkte neu berechnen',
    );
  });

  it('EvolutionTierEditor and the pool editors show their loading line in German', () => {
    expect(text(renderWithI18n(<EvolutionTierEditor seasonId="s1" participants={[]} />, { locale: 'de' }))).toBe(
      'Evolutions-Tiers werden geladen …',
    );
    expect(text(renderWithI18n(<DraftPoolEditor seasonId="s1" />, { locale: 'de' }))).toBe(
      'Draft-Pool wird geladen …',
    );
    expect(text(renderWithI18n(<DraftTierLimitsEditor seasonId="s1" />, { locale: 'de' }))).toBe(
      'Tier-Grenzen werden geladen …',
    );
    expect(text(renderWithI18n(<PointBuyListManager seasonId="s1" currentListId={null} />, { locale: 'de' }))).toBe(
      'Point-Buy-Listen werden geladen …',
    );
    expect(text(renderWithI18n(<DraftPoolEditor seasonId="s1" />))).toBe('Loading draft pool...');
  });
});

describe('retired token components stay deleted (B-TOK, draft-frontend §8.3)', { timeout: FILE_WALK_TIMEOUT_MS }, () => {
  const ROOT = path.resolve(__dirname, '../../../..');
  const RETIRED = ['DraftTokenAdminPanel', 'DraftTokenAllocator', 'KillTokenAllocator', 'KillTokenViewer', 'RedraftManager'];

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'api' ? [] : sourceFiles(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }

  it('the legacy token and redraft components and their namespace are gone', () => {
    for (const name of RETIRED) {
      expect(fs.existsSync(path.join(ROOT, 'src/components/league', `${name}.tsx`))).toBe(false);
    }
    expect(fs.existsSync(path.join(ROOT, 'src/i18n/messages/draft/legacy/league-admin/retired'))).toBe(false);
  });

  it('no page or component calls the retired endpoints (410) or the free_swap redraft action', () => {
    const files = [...sourceFiles(path.join(ROOT, 'src/components')), ...sourceFiles(path.join(ROOT, 'src/app'))];
    // The endpoint paths only: `@/components/draft-tokens/...` imports and `/draft-kill-tokens` are fine.
    const offenders = files.filter((file) => /\/(kill|draft)-tokens(?![\w/-])|free_swap/.test(fs.readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('token-naming guard for the DL-UI-2 files (draft-frontend §8.3)', { timeout: FILE_WALK_TIMEOUT_MS }, () => {
  const ROOT = path.resolve(__dirname, '../../../..');
  const FILES = [
    'DraftPoolEditor',
    'DraftTierLimitsEditor',
    'EpbImportPanel',
    'PointBuyListManager',
    'EvolutionTierEditor',
    'EvolutionPointRecalcButton',
  ].map((name) => path.join(ROOT, 'src/components/league', `${name}.tsx`));
  const MESSAGES = path.join(ROOT, 'src/i18n/messages/draft/legacy/league-admin');

  function messageFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return messageFiles(full);
      return /^(en|de)\.ts$/.test(entry.name) ? [full] : [];
    });
  }

  const BANNED = /\bKill ?Token\b(?<!Draft Kill Token)|Killtoken|Cosmo-Punkte|Cosmo Points|\bCP:/;

  it('no legacy token names in the components or their messages', () => {
    const offenders = [...FILES, ...messageFiles(MESSAGES)].filter((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        // Code identifiers (component names, imports, the legacy API path) are not user-facing text.
        .filter((line) => !/import |KillToken[A-Z]|kill-tokens|kill_tokens/.test(line))
        .some((line) => BANNED.test(line)),
    );
    expect(offenders).toEqual([]);
  });
});
