import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasUnsavedInput, shouldConfirmTabSwitch, unsavedMarker, UNSAVED_SELECTOR } from '../unsaved';
import en from '@/i18n/messages/league-admin/season-page/en';
import de from '@/i18n/messages/league-admin/season-page/de';

/** A region stand-in: `querySelector` answers for the marker selector only (the repo has no DOM test env). */
function region(marked: boolean): Pick<ParentNode, 'querySelector'> {
  return {
    querySelector: ((selector: string) => (marked && selector === UNSAVED_SELECTOR ? ({} as Element) : null)) as ParentNode['querySelector'],
  };
}

describe('league admin unsaved input', () => {
  it('a form marks unsaved input with data-unsaved="true" and drops the attribute when clean', () => {
    expect(unsavedMarker(true)).toEqual({ 'data-unsaved': 'true' });
    expect(unsavedMarker(false)).toEqual({});
    expect(UNSAVED_SELECTOR).toBe('[data-unsaved="true"]');
  });

  it('the panel holds unsaved input only while a marked element is inside it', () => {
    expect(hasUnsavedInput(region(true))).toBe(true);
    expect(hasUnsavedInput(region(false))).toBe(false);
    expect(hasUnsavedInput(null)).toBe(false);
  });

  it('asks only when a switch would really unmount unsaved input', () => {
    expect(shouldConfirmTabSwitch({ unsaved: true, activeTab: false, newContext: false })).toBe(true);
    expect(shouldConfirmTabSwitch({ unsaved: false, activeTab: false, newContext: false })).toBe(false);
    // The open tab again: nothing unmounts.
    expect(shouldConfirmTabSwitch({ unsaved: true, activeTab: true, newContext: false })).toBe(false);
    // Ctrl/Cmd/Shift click or middle click: a new tab or window, this page keeps its input.
    expect(shouldConfirmTabSwitch({ unsaved: true, activeTab: false, newContext: true })).toBe(false);
  });

  it('has the confirm copy in English and German', () => {
    expect(en.tabs.unsavedConfirm).toMatch(/unsaved/i);
    expect(de.tabs.unsavedConfirm).toMatch(/ungespeichert/i);
  });

  it('the guard stops a declined switch before Next handles the link (capture phase, both calls)', () => {
    const src = readFileSync(resolve(__dirname, '../../../app/admin/leagues/[id]/_components/UnsavedTabGuard.tsx'), 'utf8');
    expect(src).toMatch(/addEventListener\('click', onClick, true\)/);
    expect(src).toMatch(/event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
    expect(src).toMatch(/addEventListener\('beforeunload'/);
    expect(src).toContain("closest('a[data-admin-tab]')");
  });
});
