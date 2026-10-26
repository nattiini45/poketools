/**
 * The share dialog body (static markup): which visibility options a viewer sees and may choose, a gallery format
 * as read-only for its owner, and sharing that waits for a published version. The rules are `canSetVisibility`.
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import type { FormatVisibility } from '@/lib/format-studio/library-types';
import { ShareDialogBody } from '../../editor/dialogs/ShareDialog';
import { expectLabelledControls, expectNoLeftovers } from './test-helpers';

const OWNER = { playerId: 'p1', isAdmin: false };
const SITE_ADMIN = { playerId: 'p9', isAdmin: true };

interface Over {
  actor?: { playerId: string; isAdmin: boolean };
  visibility?: FormatVisibility;
  selected?: FormatVisibility;
  hasPublished?: boolean;
  kind?: 'custom' | 'preset';
  ownerId?: string | null;
  locale?: Locale;
}

function render(over: Over = {}) {
  const visibility = over.visibility ?? 'private';
  return renderWithI18n(
    <ShareDialogBody
      actor={over.actor ?? OWNER}
      definition={{ kind: over.kind ?? 'custom', owner_id: over.ownerId === undefined ? 'p1' : over.ownerId, visibility }}
      hasPublished={over.hasPublished ?? true}
      selected={over.selected ?? visibility}
      onSelect={() => undefined}
      busy={false}
      error={null}
      onApply={() => undefined}
      onClose={() => undefined}
    />,
    { locale: over.locale ?? 'en' },
  );
}

const radio = (html: string, value: string) => new RegExp(`<input[^>]*id="fe-share-${value}"[^>]*>`).exec(html)?.[0] ?? '';

describe('ShareDialogBody', () => {
  it('an owner who is not a site admin does not see the gallery option', () => {
    const html = render();
    expect(radio(html, 'private')).not.toBe('');
    expect(radio(html, 'league')).not.toBe('');
    expect(radio(html, 'gallery')).toBe('');
    expect(html).not.toContain('In the gallery');
    expectLabelledControls(html);
    expectNoLeftovers(html);
  });

  it('a site admin sees all three and may choose each of them', () => {
    const html = render({ actor: SITE_ADMIN, ownerId: 'p1' });
    for (const value of ['private', 'league', 'gallery']) {
      expect(radio(html, value), value).not.toBe('');
      expect(radio(html, value), value).not.toContain('disabled');
    }
  });

  it('a gallery format is read-only for its owner, with the reason', () => {
    const html = render({ visibility: 'gallery' });
    expect(html).toContain('A gallery format belongs to the site.');
    expect(radio(html, 'gallery')).toContain('checked');
    expect(radio(html, 'private')).toContain('disabled');
    expect(radio(html, 'league')).toContain('disabled');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Apply</);
  });

  it('a site admin can move a gallery format back', () => {
    const html = render({ actor: SITE_ADMIN, visibility: 'gallery', selected: 'private' });
    expect(radio(html, 'private')).not.toContain('disabled');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Apply</);
  });

  it('sharing needs a published version; private stays available', () => {
    const html = render({ hasPublished: false });
    expect(radio(html, 'league')).toContain('disabled');
    expect(html).toContain('Publish a version first.');
    expect(radio(html, 'private')).not.toContain('disabled');
    expect(render({ hasPublished: true })).not.toContain('Publish a version first.');
  });

  it('Apply is disabled until the choice differs from the current visibility', () => {
    expect(render({ visibility: 'private', selected: 'private' })).toMatch(/<button[^>]*disabled=""[^>]*>Apply</);
    expect(render({ visibility: 'private', selected: 'league' })).not.toMatch(/<button[^>]*disabled=""[^>]*>Apply</);
  });

  it('a viewer who is neither owner nor site admin gets a read-only dialog', () => {
    const html = render({ actor: { playerId: 'p2', isAdmin: false } });
    expect(html).toContain('Only site admins can move a format in or out of the gallery.');
    expect(radio(html, 'league')).toContain('disabled');
  });

  it('is in German for a German viewer', () => {
    const html = render({ locale: 'de' });
    expect(html).toContain('Privat');
    expect(html).toContain('Mit Liga-Admins geteilt');
    expect(html).toContain('>Übernehmen<');
    expect(html).not.toContain('Galerie');
    expect(render({ locale: 'de', actor: SITE_ADMIN })).toContain('In der Galerie');
  });
});
