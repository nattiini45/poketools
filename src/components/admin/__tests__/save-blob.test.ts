/**
 * saveBlob: the blob URL must outlive the click, because some browsers start reading it only after the click handler
 * returned. The suite runs without a DOM, so `document` and the URL helpers are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOB_URL_REVOKE_DELAY_MS, saveBlob } from '../save-blob';

const anchor = { href: '', download: '', style: {} as Record<string, string>, click: vi.fn(), remove: vi.fn() };
const appendChild = vi.fn();
let createObjectURL: ReturnType<typeof vi.spyOn>;
let revokeObjectURL: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  anchor.click.mockReset();
  anchor.remove.mockReset();
  appendChild.mockReset();
  vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild } });
  createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:file');
  revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('saveBlob', () => {
  it('clicks a hidden anchor that points at the blob URL', () => {
    const blob = new Blob(['a,b']);
    saveBlob(blob, 'matches.csv');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe('blob:file');
    expect(anchor.download).toBe('matches.csv');
    expect(anchor.style.display).toBe('none');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.remove).toHaveBeenCalledTimes(1);
  });

  it('keeps the blob URL after the click and revokes it once the delay has passed', () => {
    saveBlob(new Blob(['a,b']), 'matches.csv');

    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(BLOB_URL_REVOKE_DELAY_MS - 1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:file');
  });

  it('revokes at once, and rethrows, when the click fails', () => {
    anchor.click.mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => saveBlob(new Blob(['a,b']), 'matches.csv')).toThrow('blocked');

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:file');
    expect(anchor.remove).toHaveBeenCalledTimes(1);
    // No second, delayed revoke.
    vi.advanceTimersByTime(BLOB_URL_REVOKE_DELAY_MS);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
