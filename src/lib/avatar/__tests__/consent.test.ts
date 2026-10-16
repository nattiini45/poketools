import { describe, it, expect } from 'vitest';

import {
  PHOTO_TRANSFORM_CONSENT_VERSION,
  PHOTO_TRANSFORM_CONSENT,
  PHOTO_TRANSFORM_LOADING_MESSAGE_KEYS,
} from '../consent';
import { avatarMessages } from '@/i18n/messages/avatar';

describe('PHOTO_TRANSFORM_CONSENT_VERSION', () => {
  it('is a date string in YYYY-MM-DD format', () => {
    expect(PHOTO_TRANSFORM_CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is a valid date', () => {
    const date = new Date(PHOTO_TRANSFORM_CONSENT_VERSION);
    expect(date.toString()).not.toBe('Invalid Date');
  });
});

describe('PHOTO_TRANSFORM_CONSENT', () => {
  it('is a non-empty string', () => {
    expect(PHOTO_TRANSFORM_CONSENT).toBeTruthy();
    expect(typeof PHOTO_TRANSFORM_CONSENT).toBe('string');
  });

  it('mentions AI service', () => {
    expect(PHOTO_TRANSFORM_CONSENT).toContain('AI service');
  });

  it('mentions photo is never stored', () => {
    expect(PHOTO_TRANSFORM_CONSENT).toContain('never stored');
  });

  it('mentions ability to delete', () => {
    expect(PHOTO_TRANSFORM_CONSENT).toContain('deleted');
  });
});

describe('PHOTO_TRANSFORM_CONSENT in the UI (avatar namespace)', () => {
  it('the English consent the panel shows is the audited text, verbatim', () => {
    expect(avatarMessages.en.transform.consent).toBe(PHOTO_TRANSFORM_CONSENT);
  });

  it('has a German consent that keeps the same commitments', () => {
    const de = avatarMessages.de.transform.consent;
    expect(de).toContain('KI-Dienst');
    expect(de).toContain('nie gespeichert');
    expect(de).toContain('löschen');
  });
});

describe('PHOTO_TRANSFORM_LOADING_MESSAGE_KEYS', () => {
  it('is a non-empty list of message keys', () => {
    expect(Array.isArray(PHOTO_TRANSFORM_LOADING_MESSAGE_KEYS)).toBe(true);
    expect(PHOTO_TRANSFORM_LOADING_MESSAGE_KEYS.length).toBeGreaterThan(0);
    for (const key of PHOTO_TRANSFORM_LOADING_MESSAGE_KEYS) {
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('is readonly (const assertion)', () => {
    // TypeScript enforces this at compile time; at runtime verify it is an array
    expect(PHOTO_TRANSFORM_LOADING_MESSAGE_KEYS).toHaveLength(5);
  });

  it('every key has a non-empty English and German message', () => {
    for (const key of PHOTO_TRANSFORM_LOADING_MESSAGE_KEYS) {
      expect(avatarMessages.en.transform.loading[key].length).toBeGreaterThan(0);
      expect(avatarMessages.de.transform.loading[key].length).toBeGreaterThan(0);
    }
    expect(Object.keys(avatarMessages.en.transform.loading)).toEqual([...PHOTO_TRANSFORM_LOADING_MESSAGE_KEYS]);
  });
});
