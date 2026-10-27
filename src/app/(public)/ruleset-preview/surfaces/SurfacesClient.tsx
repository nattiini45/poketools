'use client';

import { useEffect, useState, type ReactNode } from 'react';
import PinConfirmDialog from '@/components/ruleset/PinConfirmDialog';
import type { PinImpactState } from '@/components/ruleset/use-pin-impact';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import { createFakeSurfacesApi } from './fake-api';
import { DIALOG_STATES, FAKE_IMPACT, type DialogStateId } from './fixtures';

/** While mounted, `fetch` answers the pin and recycle-bin routes from memory (`fake-api.ts`); nothing reaches a database. */
export function FakeApi({ children }: { children: ReactNode }) {
  useEffect(() => {
    const original = window.fetch;
    window.fetch = createFakeSurfacesApi(original.bind(window));
    return () => {
      window.fetch = original;
    };
  }, []);
  return <>{children}</>;
}

const STATES: Record<DialogStateId, PinImpactState> = {
  loading: { status: 'loading' },
  'ready-some': { status: 'ready', impact: FAKE_IMPACT(4) },
  'ready-all-valid': { status: 'ready', impact: { ...FAKE_IMPACT(4), would_break: 0, targets: [] } },
  'ready-none': { status: 'ready', impact: { version_no: 4, checked: 0, would_break: 0, truncated: false, targets: [] } },
  'ready-truncated': { status: 'ready', impact: { ...FAKE_IMPACT(4), checked: 2000, would_break: 41, truncated: true } },
  'ready-many': {
    status: 'ready',
    impact: {
      version_no: 4,
      checked: 70,
      would_break: 9,
      truncated: false,
      targets: Array.from({ length: 6 }, (_, index) => ({
        kind: index % 2 === 0 ? ('season' as const) : ('tournament' as const),
        id: `target-${index}`,
        name: `League or phase number ${index + 1} with a longer name`,
        checked: 12,
        would_break: index === 5 ? 0 : index + 1,
      })),
    },
  },
  failed: { status: 'failed', error: { code: 'forbidden' } },
};

/** The pin confirmation dialog, opened with each answer of the impact count, for a look at every state. */
export function DialogGallery() {
  const t = useT(rulesetMessages);
  const [open, setOpen] = useState<DialogStateId | null>(null);
  const close = () => setOpen(null);

  return (
    <div className="flex flex-wrap gap-2">
      {DIALOG_STATES.map((state) => (
        <Button key={state} type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-0" onClick={() => setOpen(state)}>
          {state}
        </Button>
      ))}
      <PinConfirmDialog
        open={open !== null}
        title={t('pin.confirm.title', { target: t('pin.confirm.season') })}
        version={4}
        impact={open === null ? { status: 'idle' } : STATES[open]}
        busy={false}
        confirmLabel={t('pin.confirm.confirm', { version: 4 })}
        cancelLabel={t('pin.confirm.cancel')}
        onConfirm={close}
        onCancel={close}
      >
        <p className="text-sm text-poke-text-secondary">{t('pin.confirm.body', { name: 'Spring League 2026' })}</p>
        <p className="text-sm text-poke-text-secondary">{t('pin.changeJoin', { changes: '3 more banned, 1 no longer banned, 1 clause added' })}</p>
      </PinConfirmDialog>
    </div>
  );
}
