import type { DiscordEventPayload, DiscordEventType, WebhookScopeType } from './discord';

export type SocialProvider = 'x' | 'threads' | 'bluesky';
export type SocialScopeType = WebhookScopeType;
export type SocialEventType = DiscordEventType;
export interface SocialEventPayload extends DiscordEventPayload {
  imageUrl?: string;
}

export interface SocialPostOptions {
  include_replay_link: boolean;
  include_hashtags: boolean;
}

export const DEFAULT_SOCIAL_POST_OPTIONS: SocialPostOptions = {
  include_replay_link: true,
  include_hashtags: false,
};

export interface SocialIntegration {
  id: string;
  provider: SocialProvider;
  scope_type: SocialScopeType;
  scope_id: string | null;
  label: string;
  enabled: boolean;
  event_filter: SocialEventType[];
  post_options: SocialPostOptions;
  credential_hint: string | null;
  has_credentials: boolean;
  created_at: string;
  updated_at: string;
}

export interface SocialIntegrationWithSecrets extends SocialIntegration {
  credentials_encrypted: string | null;
}

export interface XCredentials {
  provider: 'x';
  access_token: string;
  refresh_token?: string;
  user_id?: string;
  account_label?: string;
}

export interface ThreadsCredentials {
  provider: 'threads';
  access_token: string;
  user_id: string;
  account_label?: string;
}

export interface BlueskyCredentials {
  provider: 'bluesky';
  handle: string;
  app_password: string;
  service_url?: string;
}

export type SocialCredentials = XCredentials | ThreadsCredentials | BlueskyCredentials;

export interface CreateSocialIntegrationInput {
  provider: SocialProvider;
  scope_type: SocialScopeType;
  scope_id: string | null;
  label: string;
  event_filter?: SocialEventType[];
  post_options?: Partial<SocialPostOptions>;
  credentials?: SocialCredentials;
}

export interface UpdateSocialIntegrationInput {
  label?: string;
  enabled?: boolean;
  event_filter?: SocialEventType[];
  post_options?: Partial<SocialPostOptions>;
  credentials?: SocialCredentials;
  clear_credentials?: boolean;
}

