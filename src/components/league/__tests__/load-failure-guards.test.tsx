/**
 * A failed read must not leave a writable form over the stored data: the tier limits editor would
 * save the pack defaults over the stored limits, and the point-buy list manager would bind a list
 * picked from an empty select. Both views are rendered statically (vitest 'node' env) per state.
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { POWER_TIERS, type PowerTier } from '@/types/evolution';
import type { PointBuyListVersion } from '@/types/point-buy';
import { draftLegacyLeagueAdminPoolMessages as pool } from '@/i18n/messages/draft/legacy/league-admin/pool';
import { DraftTierLimitsEditorView } from '../DraftTierLimitsEditor';
import { PointBuyListManagerView } from '../PointBuyListManager';

const noop = () => {};
const LIMITS = Object.fromEntries(POWER_TIERS.map((tier, i) => [tier, i + 1])) as Record<PowerTier, number>;

const limitsView = (
  props: Partial<Parameters<typeof DraftTierLimitsEditorView>[0]>,
  locale: 'en' | 'de' = 'en',
) =>
  renderWithI18n(
    <DraftTierLimitsEditorView
      loadState="ready"
      limits={LIMITS}
      dirty={false}
      saving={false}
      saved={false}
      error={null}
      onChange={noop}
      onSave={noop}
      onRetry={noop}
      {...props}
    />,
    { locale },
  );

/** Has the `disabled` attribute (the `disabled:` utility classes do not count). */
const isDisabled = (tag: string | undefined) => /\sdisabled(=""|\s|>)/.test(tag ?? '');

/** The opening tag of the button with that label. */
const buttonLabelled = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0];

describe('DraftTierLimitsEditorView', () => {
  it('failed read: the error, a Retry and why saving is off, but no inputs and no Save', () => {
    const html = limitsView({ loadState: 'failed', error: { key: 'load' } });

    expect(html).toContain('role="alert"');
    expect(html).toContain(pool.en.tierLimits.errors.load);
    expect(buttonLabelled(html, pool.en.tierLimits.retry)).toBeDefined();
    expect(html).toContain(pool.en.tierLimits.blocked);
    expect(html).not.toContain('type="number"');
    expect(html).not.toContain(pool.en.tierLimits.save);
    expect(html).not.toContain('data-unsaved');
  });

  it('failed read with an API error shows that error', () => {
    const html = limitsView({
      loadState: 'failed',
      error: { api: { error: 'Season not found', code: 'season_not_found' } },
    });

    expect(html).toContain('Season not found');
    expect(html).not.toContain('type="number"');
  });

  it('failed read, German: Retry and the note come from the pool catalog', () => {
    const html = limitsView({ loadState: 'failed', error: { key: 'load' } }, 'de');

    expect(buttonLabelled(html, pool.de.tierLimits.retry)).toBeDefined();
    expect(html).toContain(pool.de.tierLimits.blocked);
    expect(html).toContain(pool.de.tierLimits.errors.load);
    expect(html).not.toContain(`>${pool.en.tierLimits.retry}<`);
  });

  it('ready: one input per tier and an enabled Save', () => {
    const html = limitsView({});

    expect(html.match(/type="number"/g)).toHaveLength(POWER_TIERS.length);
    const save = buttonLabelled(html, pool.en.tierLimits.save);
    expect(save).toBeDefined();
    expect(isDisabled(save)).toBe(false);
    expect(html).not.toContain(pool.en.tierLimits.blocked);
  });

  it('ready with edits: the unsaved marker is set', () => {
    expect(limitsView({ dirty: true })).toContain('data-unsaved="true"');
    expect(limitsView({ dirty: false })).not.toContain('data-unsaved');
  });

  it('loading: only the loading line', () => {
    const html = limitsView({ loadState: 'loading' });

    expect(html).toContain(pool.en.tierLimits.loading);
    expect(html).not.toContain('type="number"');
  });
});

const VERSIONS = [
  { id: 'v1', name: 'League list', version: 1, is_active: false },
  { id: 'v2', name: 'League list', version: 2, is_active: true },
] as PointBuyListVersion[];

const managerView = (
  props: Partial<Parameters<typeof PointBuyListManagerView>[0]>,
  locale: 'en' | 'de' = 'en',
) =>
  renderWithI18n(
    <PointBuyListManagerView
      loadState="ready"
      versions={VERSIONS}
      selectedId="v2"
      currentListId={null}
      saving={false}
      saved={false}
      error={null}
      onSelect={noop}
      onBind={noop}
      onRetry={noop}
      {...props}
    />,
    { locale },
  );

const selectTag = (html: string) => html.match(/<select[^>]*>/)?.[0];

describe('PointBuyListManagerView', () => {
  it('failed read: Retry is offered, the select and Bind are disabled, and the note says why', () => {
    const html = managerView({ loadState: 'failed', versions: [], selectedId: '', error: { key: 'load' } });

    expect(html).toContain('role="alert"');
    expect(html).toContain(pool.en.listManager.errors.load);
    expect(html).toContain(pool.en.listManager.blocked);
    expect(buttonLabelled(html, pool.en.listManager.retry)).toBeDefined();
    expect(isDisabled(buttonLabelled(html, pool.en.listManager.retry))).toBe(false);
    expect(isDisabled(selectTag(html))).toBe(true);
    expect(isDisabled(buttonLabelled(html, pool.en.listManager.bind))).toBe(true);
    // An unreachable list is not "no lists exist".
    expect(html).not.toContain(pool.en.listManager.empty);
  });

  it('failed read keeps showing the binding that is stored', () => {
    const html = managerView({ loadState: 'failed', versions: [], selectedId: 'v2', currentListId: 'v2' });

    expect(html).toContain('Currently bound: v2');
    expect(isDisabled(buttonLabelled(html, pool.en.listManager.bind))).toBe(true);
  });

  it('failed read, German', () => {
    const html = managerView({ loadState: 'failed', versions: [], selectedId: '', error: { key: 'load' } }, 'de');

    expect(html).toContain(pool.de.listManager.blocked);
    expect(buttonLabelled(html, pool.de.listManager.retry)).toBeDefined();
    expect(html).toContain(pool.de.listManager.errors.load);
  });

  it('ready with a selection: Bind is enabled, no Retry, no note', () => {
    const html = managerView({});

    expect(isDisabled(selectTag(html))).toBe(false);
    expect(isDisabled(buttonLabelled(html, pool.en.listManager.bind))).toBe(false);
    expect(html).not.toContain(`>${pool.en.listManager.retry}<`);
    expect(html).not.toContain(pool.en.listManager.blocked);
    expect(html).toContain('League list (v2) — active');
  });

  it('ready without a selection: Bind stays disabled', () => {
    expect(isDisabled(buttonLabelled(managerView({ selectedId: '' }), pool.en.listManager.bind))).toBe(true);
  });

  it('ready with no lists says so', () => {
    expect(managerView({ versions: [], selectedId: '' })).toContain(pool.en.listManager.empty);
  });

  it('loading: only the loading line', () => {
    const html = managerView({ loadState: 'loading', versions: [], selectedId: '' });

    expect(html).toContain(pool.en.listManager.loading);
    expect(html).not.toContain('<select');
  });
});
