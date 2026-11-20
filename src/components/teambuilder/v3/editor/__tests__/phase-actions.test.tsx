/** @vitest-environment jsdom */
/**
 * Share and publish act on the legacy team store only: their routes, the shared-team page and the library listing all
 * read `teams`. A native phase team's id has no endpoint there, so the editor offers neither action rather than a
 * dialog that can only answer `team_not_found`.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import TeamsEditor from '../TeamsEditor';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const PHASE = '00000000-0000-4000-8000-0000000000f1';

// jsdom has neither the pointer media query the hover hook asks for nor the resize observer the panels use.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));

describe('TeamsEditor actions', () => {
  it('offers share and publish for a legacy team', () => {
    render(withI18n(<TeamsEditor />));
    expect(screen.getByRole('button', { name: 'Share team' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish to library' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export team' })).toBeTruthy();
  });

  it('offers neither for a native phase team, keeping import and export', () => {
    render(withI18n(<TeamsEditor phaseId={PHASE} />));
    expect(screen.queryByRole('button', { name: 'Share team' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish to library' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export team' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import team' })).toBeTruthy();
  });
});
