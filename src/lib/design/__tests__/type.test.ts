import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils/cn';
import { TYPE_ROLES, typeClass } from '../type';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GLOBALS = readFileSync(join(__dirname, '../../../app/globals.css'), 'utf8');
const themeValue = (name: string) => GLOBALS.match(new RegExp(name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + ':\\s*([\\d.]+)rem;'))?.[1];

describe('type roles (redesign F3)', () => {
  it('maps every role to its size utility, in the display face for display and title only', () => {
    for (const role of TYPE_ROLES) expect(typeClass(role)).toContain(`text-${role}`);
    expect(typeClass('display')).toContain('font-heading');
    expect(typeClass('title')).toContain('font-heading');
    expect(typeClass('body')).toContain('font-body');
  });

  it('declares each role with its line height in the theme', () => {
    const sizes = { display: 28, title: 18, subtitle: 15, body: 14, caption: 12, micro: 11 };
    const leads = { display: 34, title: 24, subtitle: 22, body: 20, caption: 16, micro: 14 };
    for (const role of TYPE_ROLES) {
      expect(Number(themeValue(`--text-${role}`)) * 16, role).toBe(sizes[role]);
      expect(Number(themeValue(`--text-${role}--line-height`)) * 16, role).toBe(leads[role]);
    }
  });

  it('lets tailwind-merge treat a role as a font size, not a colour', () => {
    expect(cn('text-caption', 'text-fg-muted')).toBe('text-caption text-fg-muted');
    expect(cn('text-sm', 'text-caption')).toBe('text-caption');
    expect(cn(typeClass('body'), 'text-micro')).toBe('font-body text-micro');
  });
});
