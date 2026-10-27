/**
 * "Delete draft" on the live controls: shown only for an Initial draft that has not started or was cancelled (and only when the
 * caller passes `onDelete`), in both languages; `draftDeletable` is the single rule behind it and the group cards.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { toDraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import { snapshot } from '@/lib/draft-ui/__tests__/fixtures';
import { DELETABLE_QUEUE_PHASES, isDeletableQueuePhase, type DraftPhase, type DraftSnapshotDTO } from '@/types/draft-queue';
import LiveControls from '../LiveControls';
import { draftDeletable } from '../admin-view';

const CATALOG = { listVersionId: 'list-1', bannedMoves: [], lines: [] };
const base = snapshot().pool;

function render(pool: Partial<DraftSnapshotDTO['pool']>, withDelete = true, locale: 'en' | 'de' = 'en'): string {
  const vm = toDraftViewModel(snapshot({ pool: { ...base, ...pool } }));
  return renderWithI18n(
    <LiveControls
      vm={vm}
      catalog={CATALOG}
      serverOffsetMs={0}
      makeupSeconds={null}
      pickFor={{ kind: 'link', href: '/room' }}
      deadline={{ kind: 'anchor', href: '#deadline' }}
      showClock={false}
      onPause={vi.fn(async () => null)}
      onStart={vi.fn(async () => null)}
      onEnd={vi.fn(async () => null)}
      onDelete={withDelete ? vi.fn(async () => null) : undefined}
    />,
    { locale },
  );
}

describe('LiveControls: Delete draft', () => {
  it('shows for an Initial draft in setup (en + de), next to Start', () => {
    const en = render({ kind: 'initial', phase: 'setup', status: 'pending', started_at: null });
    expect(en).toContain('Delete draft');
    expect(en).toContain('Start draft');
    expect(render({ kind: 'initial', phase: 'setup', status: 'pending', started_at: null }, true, 'de')).toContain('Draft löschen');
  });

  it.each(['submissions', 'drafting', 'complete'] as const)('is absent for an Initial draft in phase %s', (phase) => {
    expect(render({ kind: 'initial', phase })).not.toContain('Delete draft');
  });

  it('shows for a cancelled Initial draft (en + de): deleting it frees the group', () => {
    expect(render({ kind: 'initial', phase: 'cancelled', status: 'complete' })).toContain('Delete draft');
    expect(render({ kind: 'initial', phase: 'cancelled', status: 'complete' }, true, 'de')).toContain('Draft löschen');
  });

  it('is absent for a Redraft, whatever its phase', () => {
    expect(render({ kind: 'redraft', phase: 'setup' })).not.toContain('Delete draft');
    expect(render({ kind: 'redraft', phase: 'submissions' })).not.toContain('Delete draft');
  });

  it('is absent when the caller offers no delete', () => {
    expect(render({ kind: 'initial', phase: 'setup', status: 'pending', started_at: null }, false)).not.toContain('Delete draft');
  });
});

describe('draftDeletable', () => {
  it('is true only for an Initial draft in setup or cancelled', () => {
    expect(draftDeletable({ kind: 'initial', phase: 'setup' })).toBe(true);
    expect(draftDeletable({ kind: 'initial', phase: 'cancelled' })).toBe(true);
    for (const phase of ['submissions', 'drafting', 'complete'] as const) {
      expect(draftDeletable({ kind: 'initial', phase })).toBe(false);
    }
    expect(draftDeletable({ kind: 'redraft', phase: 'setup' })).toBe(false);
    expect(draftDeletable({ kind: 'redraft', phase: 'cancelled' })).toBe(false);
  });

  it('reads the one shared list of deletable queue phases (route, pre-check, DELETE filter and this gate)', () => {
    expect([...DELETABLE_QUEUE_PHASES]).toEqual(['setup', 'cancelled']);
    const all: DraftPhase[] = ['setup', 'submissions', 'drafting', 'complete', 'cancelled'];
    for (const phase of all) {
      const listed = (DELETABLE_QUEUE_PHASES as readonly DraftPhase[]).includes(phase);
      expect(isDeletableQueuePhase(phase)).toBe(listed);
      expect(draftDeletable({ kind: 'initial', phase })).toBe(listed);
    }
  });
});
