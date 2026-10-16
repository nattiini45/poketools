import { Children, isValidElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { buildFixtureCatalog } from '@/lib/draft-finder/__tests__/fixture-index';
import { snapshot } from '@/lib/draft-ui/__tests__/fixtures';
import type { DraftSnapshotDTO } from '@/lib/draft-ui/snapshot-types';
import Button from '@/components/ui/Button';
import type { ApiCall, PickRequest, PickResult } from '../data-source';
import ConfirmPickDialog, { type ConfirmPickDialogProps } from '../dialogs/ConfirmPickDialog';
import {
  buildPickRequest,
  closesDialog,
  INITIAL_PICK_FLOW,
  pickFlowReducer,
  runPickSubmission,
  type PickFlowState,
  type PickTarget,
} from '../hooks/pick-flow';

/**
 * Radix renders its dialog into a portal only after mount, so `renderToStaticMarkup` would show nothing.
 * The mock renders the content inline and captures the props of `Dialog.Content`, including the
 * `onOpenAutoFocus` handler of the shared `ArmedConfirmDialog`.
 */
const captured = vi.hoisted(() => ({ content: null as null | Record<string, unknown> }));

vi.mock('@radix-ui/react-dialog', () => ({
  Root: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <>{children}</> : null),
  Portal: ({ children }: { children: ReactNode }) => <>{children}</>,
  Overlay: () => null,
  Content: (props: Record<string, unknown> & { children?: ReactNode }) => {
    captured.content = props;
    return <div role="dialog">{props.children}</div>;
  },
  Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Description: ({ children }: { children: ReactNode }) => <>{children}</>,
  Close: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}));

const catalog = buildFixtureCatalog();
const entry = catalog.lines.find((l) => l.lineId === 'oshawott--samurott');
if (!entry) throw new Error('fixture line missing');

function dialog(overrides: Partial<ConfirmPickDialogProps> = {}) {
  return (
    <ConfirmPickDialog
      open
      onCancel={() => {}}
      entry={entry as NonNullable<typeof entry>}
      price={20}
      remainingAfter={130}
      redraftSlots={null}
      adminOverride={null}
      submitting={false}
      error={null}
      onConfirm={() => {}}
      {...overrides}
    />
  );
}

/** Walks a React element tree (unrendered JSX) for the first element matching `pred`. */
function findElement(node: ReactNode, pred: (el: { type: unknown; props: Record<string, unknown> }) => boolean) {
  let found: { type: unknown; props: Record<string, unknown> } | null = null;
  const walk = (n: ReactNode) => {
    if (found) return;
    Children.forEach(n, (child) => {
      if (found || !isValidElement(child)) return;
      const el = child as unknown as { type: unknown; props: Record<string, unknown> };
      if (pred(el)) {
        found = el;
        return;
      }
      walk(el.props.children as ReactNode);
    });
  };
  walk(node);
  return found as { type: unknown; props: Record<string, unknown> } | null;
}

describe('ConfirmPickDialog', () => {
  it('focuses Cancel on open, never Confirm (SPEC:497)', () => {
    const onCancel = vi.fn();
    captured.content = null;
    renderWithI18n(dialog({ onCancel }));
    const content = captured.content as Record<string, unknown> | null;
    expect(content).not.toBeNull();
    const cancel = findElement(content?.children as ReactNode, (el) => el.type === Button && el.props.onClick === onCancel);
    expect(cancel).not.toBeNull();
    const focus = vi.fn();
    (cancel?.props.ref as { current: unknown }).current = { focus };
    const preventDefault = vi.fn();
    (content?.onOpenAutoFocus as (e: { preventDefault(): void }) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('opens disarmed: the confirm button is grey until CONFIRM_ARM_MS elapses', () => {
    const html = renderWithI18n(dialog());
    expect(html).toContain('Draft the Oshawott → Samurott line?');
    expect(html).toMatch(/disabled=""[^>]*data-armed="false"[^>]*>Draft Oshawott for 20 P</);
    expect(html).toContain('Remaining after pick: 130 P');
    expect(html).toContain('A confirmed pick is final.');
  });

  it('renders German with official Pokémon names', () => {
    const html = renderWithI18n(dialog(), { locale: 'de' });
    expect(html).toContain('Restbudget nach dem Pick: 130 P');
    expect(html).toContain('Ottaro für 20 P draften');
    expect(html).toContain('Abbrechen');
  });

  it('requires a reason for an admin pick and a slot choice with several open redraft slots', () => {
    const slots = [
      { redraftSlotId: 'rs-a', label: 'A', droppedLineId: 'gastly--gengar', transferredRealKills: 3, filledByPickId: null, open: true },
      { redraftSlotId: 'rs-b', label: 'B', droppedLineId: 'mona--x', transferredRealKills: 1, filledByPickId: null, open: true },
    ];
    const html = renderWithI18n(
      dialog({ adminOverride: { targetName: 'Dawn' }, redraftSlots: slots, entryOf: (id) => catalog.lines.find((l) => l.lineId === id) }),
    );
    expect(html).toContain('Draft the Oshawott → Samurott line for Dawn?');
    expect(html).toContain('Reason (required)');
    expect(html).toContain('Slot A – replaces Gastly → Gengar · 3 real KOs transfer');
    expect(html).toContain('Slot B – replaces');
    expect(html).not.toMatch(/type="radio"[^>]*checked=""/);
  });

  it('preselects the only open redraft slot', () => {
    const slots = [
      { redraftSlotId: 'rs-a', label: 'A', droppedLineId: 'gastly--gengar', transferredRealKills: 1, filledByPickId: null, open: true },
    ];
    const html = renderWithI18n(dialog({ redraftSlots: slots }));
    expect(html).toMatch(/<input type="radio"[^>]*checked=""[^>]*value="rs-a"/);
    expect(html).toContain('1 real KO transfers');
  });

  it('turns the confirm button into Retry after a network error and shows the error inline', () => {
    const html = renderWithI18n(dialog({ error: { code: 'network_error' }, retryable: true }));
    expect(html).toContain('>Retry<');
    expect(html).toContain('role="alert"');
  });
});

describe('pick flow: client_request_id (§5.6)', () => {
  const target: PickTarget = { slotId: 'slot-3', lineId: 'oshawott--samurott', onBehalfOf: null };
  const open = (s: PickFlowState, id: string) => pickFlowReducer(s, { type: 'open', target, requestId: id });

  it('mints the id on open and reuses it for every retry of the same dialog', () => {
    let s = open(INITIAL_PICK_FLOW, 'req-A');
    expect(s).toMatchObject({ open: true, openCount: 1, requestId: 'req-A' });
    s = pickFlowReducer(s, { type: 'submit' });
    s = pickFlowReducer(s, { type: 'failed', error: { code: 'network_error' }, close: false });
    expect(s).toMatchObject({ open: true, submitting: false, retryable: true, requestId: 'req-A' });
    s = pickFlowReducer(s, { type: 'submit' });
    expect(buildPickRequest(target, s.requestId as string, { redraftSlotId: null, overrideReason: null }).client_request_id).toBe('req-A');
    s = pickFlowReducer(s, { type: 'failed', error: { code: 'BUDGET_INFEASIBLE' }, close: false });
    expect(s).toMatchObject({ open: true, retryable: false, requestId: 'req-A', error: { code: 'BUDGET_INFEASIBLE' } });
  });

  it('mints a new id for every new open', () => {
    let s = open(INITIAL_PICK_FLOW, 'req-A');
    s = pickFlowReducer(s, { type: 'cancel' });
    expect(s.open).toBe(false);
    s = open(s, 'req-B');
    expect(s).toMatchObject({ open: true, openCount: 2, requestId: 'req-B', error: null });
  });

  it('cannot be cancelled while the request is in flight', () => {
    let s = pickFlowReducer(open(INITIAL_PICK_FLOW, 'req-A'), { type: 'submit' });
    s = pickFlowReducer(s, { type: 'cancel' });
    expect(s).toMatchObject({ open: true, submitting: true });
  });

  it('builds the admin body with on_behalf_of and the trimmed reason', () => {
    const body = buildPickRequest(
      { ...target, onBehalfOf: { playerId: 'p-dawn', name: 'Dawn' } },
      'req-C',
      { redraftSlotId: 'rs-a', overrideReason: '  Dawn lost connection  ' },
    );
    expect(body).toEqual({
      slot_id: 'slot-3',
      line_id: 'oshawott--samurott',
      client_request_id: 'req-C',
      redraft_slot_id: 'rs-a',
      on_behalf_of: 'p-dawn',
      override_reason: 'Dawn lost connection',
    });
  });
});

describe('pick submission order (§5.6)', () => {
  const body: PickRequest = { slot_id: 'slot-3', line_id: 'oshawott--samurott', client_request_id: 'req-A' };

  function deps(result: ApiCall<PickResult>) {
    const order: string[] = [];
    const applied: DraftSnapshotDTO[] = [];
    return {
      order,
      applied,
      deps: {
        postPick: vi.fn(async () => {
          order.push('post');
          return result;
        }),
        applySnapshot: (dto: DraftSnapshotDTO) => {
          order.push('apply');
          applied.push(dto);
        },
        refresh: async () => {
          order.push('refresh');
        },
        onSettled: () => {
          order.push('settled');
        },
      },
    };
  }

  it('applies the response snapshot before closing and before refresh()', async () => {
    const fresh = snapshot({ state_version: 43 });
    const d = deps({ ok: true, data: { state_version: 43, replay: false, snapshot: fresh } });
    const outcome = await runPickSubmission(d.deps, body);
    expect(outcome).toEqual({ kind: 'success', replay: false });
    expect(d.order).toEqual(['post', 'apply', 'settled', 'refresh']);
    expect(d.applied[0].state_version).toBe(43);
  });

  it('treats a committed pick without a snapshot as a success and refreshes', async () => {
    const d = deps({ ok: true, data: { state_version: 43, replay: false } });
    const outcome = await runPickSubmission(d.deps, body);
    expect(outcome).toEqual({ kind: 'success', replay: false });
    expect(d.order).toEqual(['post', 'settled', 'refresh']);
    expect(d.applied).toHaveLength(0);
  });

  it('applies the snapshot of a rule error first, then closes and refreshes for LINE_TAKEN', async () => {
    const fresh = snapshot({ state_version: 44 });
    const d = deps({ ok: false, error: { code: 'LINE_TAKEN', error: 'Line already taken' }, snapshot: fresh });
    const outcome = await runPickSubmission(d.deps, body);
    expect(outcome.kind).toBe('closed');
    expect(d.order).toEqual(['post', 'apply', 'settled', 'refresh']);
  });

  it('keeps the dialog open for validation errors and for network errors, without a refresh', async () => {
    const validation = deps({ ok: false, error: { code: 'BUDGET_INFEASIBLE' } });
    expect((await runPickSubmission(validation.deps, body)).kind).toBe('inline');
    expect(validation.order).toEqual(['post', 'settled']);
    const network = deps({ ok: false, error: { code: 'network_error' } });
    expect((await runPickSubmission(network.deps, body)).kind).toBe('inline');
  });

  it('classifies the moot-dialog codes', () => {
    for (const code of ['LINE_TAKEN', 'STALE_SLOT', 'NOT_YOUR_TURN', 'DRAFT_PAUSED', 'SLOT_BLOCKED', 'DRAFT_NOT_ACTIVE']) {
      expect(closesDialog({ code })).toBe(true);
    }
    for (const code of ['BUDGET_INFEASIBLE', 'NOT_ENOUGH_LINES', 'INSUFFICIENT_BUDGET', 'REDRAFT_SLOT_REQUIRED', 'OVERRIDE_REASON_REQUIRED', 'network_error']) {
      expect(closesDialog({ code })).toBe(false);
    }
  });
});
