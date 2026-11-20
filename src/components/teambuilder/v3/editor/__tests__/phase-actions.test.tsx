/** @vitest-environment jsdom */
/**
 * Share and publish work for a native phase team as they do for a legacy one (their routes, the shared-team page and
 * the library listing resolve either store), so the editor offers them in both cases.
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

  it('offers them for a native phase team too', () => {
    render(withI18n(<TeamsEditor phaseId={PHASE} />));
    expect(screen.getByRole('button', { name: 'Share team' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish to library' })).toBeTruthy();
  });
});
