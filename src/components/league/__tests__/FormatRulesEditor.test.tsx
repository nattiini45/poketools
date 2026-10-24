/**
 * The Format Rules editor on the Rules tab. Rendered with react-dom/server (vitest 'node' env, no
 * @testing-library): the presentational view takes every state as props, so each state is a render,
 * and the pure helpers (format-rules-form, format-rules-requests) carry the interaction rules.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { epbPack } from '@/lib/format-pack';
import type { FormatRules } from '@/types/format-rules';
import { FORMAT_RULES_LIMITS, formatRulesToForm } from '@/lib/league-admin/format-rules-form';
import FormatRulesEditor, { FormatRulesEditorView, type FormatRulesViewState } from '../FormatRulesEditor';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// The real dialog renders into a portal, which does not exist in a static render: show its copy inline when open.
vi.mock('@/components/ui/ConfirmDialog', () => ({
  default: ({
    open,
    title,
    message,
    confirmLabel,
  }: {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
  }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <h2>{title}</h2>
        <p>{message}</p>
        <button type="button">{confirmLabel}</button>
      </div>
    ) : null,
}));

const RULES: FormatRules = {
  id: 'fr-1',
  season_id: 's1',
  banned_moves: ['Baton Pass', 'Shed Tail'],
  banned_items: ['Soul Dew'],
  tera_rules: { ...epbPack.teraByStage },
  tiebreaker_order: ['match_points', 'evolution_points', 'kill_difference', 'head_to_head', 'decision_match'],
  draft_budget: 180,
  draft_picks: 9,
  draft_token_ratio: 3,
  draft_token_max: 2,
  draft_token_max_per_line: 1,
  redraft_phase_open: false,
  created_at: '2026-01-01T00:00:00Z',
};

function ready(
  overrides: Partial<ReturnType<typeof formatRulesToForm>> = {},
  redraftPhaseOpen = false,
): FormatRulesViewState {
  const baseline = formatRulesToForm(RULES);
  return {
    kind: 'ready',
    baseline,
    values: { ...baseline, ...overrides },
    teraRules: RULES.tera_rules,
    redraftPhaseOpen,
  };
}

type ViewProps = Parameters<typeof FormatRulesEditorView>[0];

function render(props: ViewProps, locale?: 'de') {
  return renderWithI18n(<FormatRulesEditorView {...props} />, { locale });
}

/** The opening tag of the element with `id`. */
function tagWithId(html: string, id: string): string {
  const match = html.match(new RegExp(`<(?:input|button|select)[^>]*id="${id}"[^>]*>`));
  expect(match, id).not.toBeNull();
  return match ? match[0] : '';
}

function submitButtons(html: string): string[] {
  return html.match(/<button[^>]*type="submit"[^>]*>/g) ?? [];
}

function buttonWithLabel(html: string, label: string): string {
  const match = html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*?${label}(?:(?!</button>).)*?</button>`, 's'));
  expect(match, label).not.toBeNull();
  return match ? match[0] : '';
}

describe('FormatRulesEditor states', () => {
  it('loading shows the loading text only', () => {
    const html = render({ state: { kind: 'loading' }, seasonStarted: false });
    expect(html).toContain('Loading format rules...');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<button');
  });

  it('the default export starts in the loading state', () => {
    const html = renderWithI18n(<FormatRulesEditor seasonId="s1" seasonStarted={false} />);
    expect(html).toContain('Loading format rules...');
  });

  it('failed: the error text, a Retry button, Initialize disabled, no form and no Save', () => {
    const html = render({
      state: { kind: 'failed', error: { error: 'Failed to fetch format rules', code: 'internal_error' } },
      seasonStarted: false,
    });

    expect(html).toContain('Failed to load format rules');
    expect(html).toContain('Failed to fetch format rules');
    expect(html).toContain('role="alert"');
    expect(buttonWithLabel(html, 'Retry')).not.toContain(' disabled=""');
    expect(buttonWithLabel(html, 'Initialize Default Rules')).toContain(' disabled=""');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
    expect(submitButtons(html)).toEqual([]);
    expect(html).not.toContain('Save format rules');
  });

  it('failed without an error body falls back to the load message', () => {
    const html = render({ state: { kind: 'failed', error: null }, seasonStarted: false });
    expect(html).toContain('Failed to load format rules');
    expect(buttonWithLabel(html, 'Retry')).toBeTruthy();
    expect(buttonWithLabel(html, 'Initialize Default Rules')).toContain(' disabled=""');
  });

  it('empty: the empty text and an enabled Initialize, no inputs', () => {
    const html = render({ state: { kind: 'empty' }, seasonStarted: false });
    expect(html).toContain('No format rules configured yet.');
    expect(buttonWithLabel(html, 'Initialize Default Rules')).not.toContain(' disabled=""');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('data-testid="confirm-dialog"');
  });

  it('empty: Initialize asks first and names what it writes', () => {
    const html = render({ state: { kind: 'empty' }, seasonStarted: false, confirm: 'initialize' });
    const defaults = epbPack.defaults;
    expect(html).toContain('data-testid="confirm-dialog"');
    expect(html).toContain('Initialize default rules?');
    expect(html).toContain(`a budget of ${defaults.draftBudget}, ${defaults.draftPicks} picks`);
    expect(html).toContain(`ratio of ${defaults.tokenRatio}:1`);
    expect(html).toContain(`(${defaults.tokenMaxPerLine} per line)`);
    expect(html).toMatch(/and \d+ default bans/);
  });

  it('empty: a failed initialize shows its error, and the fallback without text', () => {
    const withError = render({
      state: { kind: 'empty' },
      seasonStarted: false,
      error: { error: 'Forbidden', code: 'forbidden' },
    });
    expect(withError).toContain('role="alert"');
    const fallback = render({ state: { kind: 'empty' }, seasonStarted: false, error: {} });
    expect(fallback).toContain('Failed to initialize format rules');
  });

  it('empty while initializing: the button is disabled and says so', () => {
    const html = render({ state: { kind: 'empty' }, seasonStarted: false, busy: true });
    expect(buttonWithLabel(html, 'Initializing...')).toContain(' disabled=""');
  });
});

describe('FormatRulesEditor ready form', () => {
  const clean = () => render({ state: ready(), seasonStarted: false });

  it('renders the number inputs with the schema limits as attributes', () => {
    const html = clean();
    const limits: Record<string, string> = {
      draft_budget: 'min="1" max="999"',
      draft_picks: 'min="1" max="20"',
      draft_token_ratio: 'min="1" max="10"',
      draft_token_max: 'min="0" max="5"',
      draft_token_max_per_line: 'min="0" max="3"',
    };
    for (const [field, range] of Object.entries(limits)) {
      const tag = tagWithId(html, `format-rules-${field}`);
      expect(tag, field).toContain('type="number"');
      expect(tag, field).toContain(range);
      expect(tag, field).toContain('step="1"');
    }
    expect(tagWithId(html, 'format-rules-draft_budget')).toContain('value="180"');
    expect(tagWithId(html, 'format-rules-draft_token_max_per_line')).toContain('value="1"');
    expect(FORMAT_RULES_LIMITS.draft_budget.max).toBe(999);
  });

  it('labels each input with the glossary / catalog wording and a min–max hint', () => {
    const html = clean();
    expect(html).toMatch(/<label[^>]*for="format-rules-draft_budget"[^>]*>Budget<\/label>/);
    expect(html).toMatch(/for="format-rules-draft_picks"[^>]*>Picks</);
    expect(html).toMatch(/for="format-rules-draft_token_ratio"[^>]*>[^<]*ratio</);
    expect(html).toMatch(/for="format-rules-draft_token_max"[^>]*>[^<]* limit</);
    expect(html).toMatch(/for="format-rules-draft_token_max_per_line"[^>]*>[^<]* limit per line</);
    expect(html).toContain('>1–999<');
    expect(html).toContain('>0–3<');
    expect(tagWithId(html, 'format-rules-draft_budget')).toContain('aria-describedby="format-rules-draft_budget-hint"');
  });

  it('renders both ban lists with their entries', () => {
    const html = clean();
    expect(html).toContain('Banned Moves');
    expect(html).toContain('Banned Items');
    expect(html).toContain('Baton Pass');
    expect(html).toContain('Shed Tail');
    expect(html).toContain('Soul Dew');
    expect(html).toContain('Remove Baton Pass');
  });

  it('renders the tiebreaker list with move and remove buttons', () => {
    const html = clean();
    expect(html).toContain('Tiebreaker Order');
    expect(html).toContain('aria-label="Move Match points down"');
    expect(html).toContain('aria-label="Move KO difference up"');
    expect(html).toContain('aria-label="Remove Decision match"');
    expect(html).toContain('Evolution points');
    // The first step cannot move up, the last cannot move down.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Move Match points up"/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Move Decision match down"/);
    expect(html).not.toContain('format-rules-add-step');
    expect(html).toContain('Every tiebreaker step is already in the list.');
  });

  it('offers the unused tiebreaker steps in an Add step select', () => {
    const html = render({ state: ready({ tiebreaker_order: ['match_points'] }), seasonStarted: false });
    const select = html.match(/<select[^>]*id="format-rules-add-step"[^>]*>.*?<\/select>/s)?.[0] ?? '';
    expect(select).toContain('aria-label="Add step"');
    expect(select).toContain('<option value="evolution_points">Evolution points</option>');
    expect(select).toContain('<option value="decision_match">Decision match</option>');
    expect(select).not.toContain('value="match_points"');
  });

  it('says the standings use the format pack chain, and that the order is stored', () => {
    const html = clean();
    expect(html).toContain('The standings currently use the format pack’s tiebreaker chain');
    expect(html).toContain('stored and shown on the league’s rules page');
  });

  it('shows the Tera rules read-only with the pack note, and the redraft phase as a status line', () => {
    const html = clean();
    expect(html).toContain('Tera Rules');
    expect(html).toContain('Tera rules come from the format pack and cannot be edited here.');
    expect(html).not.toMatch(/<input[^>]*tera/i);
    expect(html).toContain('Redraft phase');
    expect(html).toContain('Closed');
    expect(html).toContain('opened and closed in the Redraft section of the Draft tab, not here');
    const open = render({ state: ready({}, true), seasonStarted: false });
    expect(open).toMatch(/Redraft phase<\/span>: Open/);
  });

  it('hints that budget and picks apply to pools created afterwards', () => {
    expect(clean()).toContain('Budget and picks apply to draft pools created after saving.');
  });

  it('clean: Save and Reset are disabled and the form carries no unsaved marker', () => {
    const html = clean();
    expect(submitButtons(html)).toHaveLength(1);
    expect(submitButtons(html)[0]).toContain(' disabled=""');
    expect(buttonWithLabel(html, 'Save format rules')).toContain('Save format rules');
    expect(buttonWithLabel(html, 'Reset')).toContain(' disabled=""');
    expect(html).not.toContain('data-unsaved');
    expect(html).not.toContain('You have unsaved changes.');
  });

  it('dirty: the form is marked unsaved and Save and Reset are enabled', () => {
    const html = render({ state: ready({ draft_budget: '200' }), seasonStarted: false });
    expect(html).toContain('data-unsaved="true"');
    expect(submitButtons(html)[0]).not.toContain(' disabled=""');
    expect(buttonWithLabel(html, 'Reset')).not.toContain(' disabled=""');
    expect(html).toContain('You have unsaved changes.');
    expect(tagWithId(html, 'format-rules-draft_budget')).toContain('value="200"');
  });

  it('typing an equal number is not a change', () => {
    const html = render({ state: ready({ draft_budget: '0180' }), seasonStarted: false });
    expect(html).not.toContain('data-unsaved');
  });

  it('an out-of-range value shows an inline error, aria-invalid, and keeps Save disabled', () => {
    const html = render({ state: ready({ draft_budget: '1000' }), seasonStarted: false });
    const input = tagWithId(html, 'format-rules-draft_budget');
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('aria-describedby="format-rules-draft_budget-hint format-rules-draft_budget-error"');
    expect(html).toMatch(/id="format-rules-draft_budget-error"[^>]*>Must be at most 999\.</);
    expect(submitButtons(html)[0]).toContain(' disabled=""');
    expect(html).toContain('data-unsaved="true"');
    expect(tagWithId(html, 'format-rules-draft_picks')).not.toContain('aria-invalid');
  });

  it('names the other input problems', () => {
    const empty = render({ state: ready({ draft_picks: '' }), seasonStarted: false });
    expect(empty).toContain('Enter a value.');
    const small = render({ state: ready({ draft_picks: '0' }), seasonStarted: false });
    expect(small).toContain('Must be at least 1.');
    const fraction = render({ state: ready({ draft_token_max: '1.5' }), seasonStarted: false });
    expect(fraction).toContain('Enter a whole number.');
    const order = render({
      state: ready({ tiebreaker_order: ['decision_match', 'match_points'] }),
      seasonStarted: false,
    });
    expect(order).toContain('A decision match can only be the last step.');
    const none = render({ state: ready({ tiebreaker_order: [] }), seasonStarted: false });
    expect(none).toContain('This cannot be empty.');
  });

  it('saving: Save is disabled and says so', () => {
    const html = render({ state: ready({ draft_budget: '200' }), seasonStarted: false, busy: true });
    expect(submitButtons(html)[0]).toContain(' disabled=""');
    expect(html).toContain('Saving...');
  });

  it('saved: the polite status line says so', () => {
    const html = render({ state: ready(), seasonStarted: false, saved: true });
    expect(html).toMatch(/<p[^>]*role="status"[^>]*aria-live="polite"[^>]*>Format rules saved\.<\/p>/);
  });

  it('a failed save shows the server error inside the form, and the fallback without text', () => {
    const withIssues = render({
      state: ready({ draft_budget: '200' }),
      seasonStarted: false,
      error: {
        error: 'Validation failed: Too big',
        code: 'validation_failed',
        params: { issues: 'Too big' },
      },
    });
    const form = withIssues.match(/<form[^>]*>.*<\/form>/s)?.[0] ?? '';
    expect(form).toContain('role="alert"');
    expect(form).toContain('Validation failed: Too big');

    const fallback = render({ state: ready(), seasonStarted: false, error: {} });
    expect(fallback).toContain('Failed to save format rules');
  });

  it('a started league confirms before saving and says what is not recomputed', () => {
    const html = render({
      state: ready({ draft_budget: '200' }),
      seasonStarted: true,
      confirm: 'save',
    });
    expect(html).toContain('data-testid="confirm-dialog"');
    expect(html).toContain('Change the rules of a started league?');
    expect(html).toContain('The new rules apply from now on');
    expect(html).toContain('past results, standings and existing draft pools are not recomputed');
    expect(html).toContain('>Save rules<');
  });

  it('a league that has not started never shows the confirmation', () => {
    const html = render({ state: ready({ draft_budget: '200' }), seasonStarted: false, confirm: 'save' });
    expect(html).not.toContain('data-testid="confirm-dialog"');
  });

  it('uses theme tokens: no fixed dark chips', () => {
    const html = clean();
    expect(html).not.toMatch(/bg-(?:red|green|yellow)-900/);
    expect(html).not.toMatch(/text-(?:red|green|yellow)-400/);
  });
});

describe('FormatRulesEditor German', () => {
  const FALLBACK_KEY = /formatRules\.|MISSING|\[missing/i;

  it('failed view: German text, no English leftovers', () => {
    const html = render({ state: { kind: 'failed', error: null }, seasonStarted: false }, 'de');
    expect(html).toContain('Die Formatregeln konnten nicht geladen werden');
    expect(html).toContain('Erneut versuchen');
    expect(html).toContain('Standardregeln einrichten');
    expect(html).not.toContain('Retry');
    expect(html).not.toContain('Failed to load');
    expect(html).not.toMatch(FALLBACK_KEY);
  });

  it('ready view: German labels, hints, tiebreaker buttons and umlauts', () => {
    const html = render({ state: ready({ draft_budget: '1000' }), seasonStarted: true, confirm: 'save' }, 'de');
    for (const text of [
      'Budget',
      'Gebannte Attacken',
      'Gebannte Items',
      'Tiebreaker-Reihenfolge',
      'Spielpunkte',
      'Evolutionspunkte',
      'KO-Differenz',
      'Direkter Vergleich',
      'Entscheidungsspiel',
      'Spielpunkte nach unten',
      'Tera-Regeln',
      'Die Tera-Regeln kommen aus dem Formatpaket',
      'Redraft-Phase',
      'Geschlossen',
      'Darf höchstens 999 sein.',
      'Formatregeln speichern',
      'Zurücksetzen',
      'Du hast ungespeicherte Änderungen.',
      'Regeln einer laufenden Liga ändern?',
      'werden nicht neu berechnet',
      'Die Tabelle nutzt derzeit die Tiebreaker-Kette des Formatpakets',
      'Budget und Picks gelten für Draft-Pools',
    ]) {
      expect(html, text).toContain(text);
    }
    expect(html).not.toMatch(FALLBACK_KEY);
    expect(html).not.toContain('Save format rules');
    expect(html).not.toContain('Match points');
    expect(html).not.toContain('Must be at most');
    expect(html).not.toContain('The new rules apply');
    // Real umlauts, no escaped or broken forms.
    expect(html).not.toMatch(/Ã|Â|\\u00|&uuml;|&auml;|&ouml;/);
    expect(html).toMatch(/[äöüÄÖÜß]/);
  });

  it('empty view: German confirmation names the defaults', () => {
    const html = render({ state: { kind: 'empty' }, seasonStarted: false, confirm: 'initialize' }, 'de');
    expect(html).toContain('Standardregeln einrichten?');
    expect(html).toContain('Standard-Bans');
    expect(html).toContain('pro Linie');
    expect(html).not.toContain('default bans');
  });
});
