import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import DiscordWebhookManager from '../DiscordWebhookManager';
import SocialIntegrationManager from '@/components/social/SocialIntegrationManager';
import { integrationsMessages } from '@/i18n/messages/integrations';

/**
 * Server render only (no DOM in this repo's test setup): the first paint is
 * the action bar and the loading line, which is enough to prove the managers
 * read the viewer's language.
 */
describe('integration managers — language', () => {
  it('renders the Discord manager in English by default', () => {
    const html = renderWithI18n(<DiscordWebhookManager />);
    expect(html).toContain('Add Webhook');
    expect(html).toContain('Loading webhooks...');
  });

  it('renders the Discord manager in German', () => {
    const html = renderWithI18n(<DiscordWebhookManager />, { locale: 'de' });
    expect(html).toContain('Webhook hinzufügen');
    expect(html).toContain('Webhooks werden geladen …');
    expect(html).not.toContain('Add Webhook');
  });

  it('renders the social manager in German', () => {
    const html = renderWithI18n(<SocialIntegrationManager />, { locale: 'de' });
    expect(html).toContain('Integration hinzufügen');
    expect(html).toContain('Social-Integrationen werden geladen …');
  });

  it('labels the four draft-tool events in both languages', () => {
    const draftEvents = ['draft_turn_started', 'draft_turn_reminder', 'draft_slot_blocked', 'draft_redraft_published'] as const;
    for (const evt of draftEvents) {
      expect(integrationsMessages.en.events[evt]).toBeTruthy();
      expect(integrationsMessages.de.events[evt]).toBeTruthy();
      expect(integrationsMessages.de.events[evt]).not.toBe(integrationsMessages.en.events[evt]);
    }
  });
});
