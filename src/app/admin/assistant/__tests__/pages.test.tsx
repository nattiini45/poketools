import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLiveAccess: vi.fn(),
  flag: { on: true },
}));

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess, getSession: vi.fn(), isSuperadmin: vi.fn(() => false) }));
vi.mock('@/lib/feature-flags', () => ({
  get ENABLE_ADMIN_ASSISTANT() {
    return mocks.flag.on;
  },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/assistant',
  useRouter: () => ({ push: vi.fn() }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/shared/AdminGuard', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/shared/NavBar', () => ({ default: () => null }));
vi.mock('@/components/shared/PageTransitionWrapper', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return { getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en') };
});

import AdminLayout from '@/app/admin/layout';
import AssistantDrawer from '@/components/admin/assistant/AssistantDrawer';
import AssistantHome from '@/components/admin/assistant/AssistantHome';
import AssistantWorkspace from '@/components/admin/assistant/AssistantWorkspace';
import PageTransitionWrapper from '@/components/shared/PageTransitionWrapper';
import ConversationPage from '../[id]/page';
import { assistantPageGate } from '../gate';
import AssistantPage from '../page';

const ME = '11111111-1111-4111-8111-111111111111';
const ID = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';

const access = (overrides: Record<string, unknown> = {}) => ({
  player: { playerId: ME, name: 'Admin' },
  isSiteAdmin: true,
  isAnyAdmin: true,
  isCreator: false,
  isSuperadmin: false,
  ...overrides,
});

/** Every element in a tree (functional components are not rendered), depth first. */
function elements(node: ReactNode, out: Array<{ type: unknown; props: Record<string, unknown> }> = []): typeof out {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out);
  } else if (isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    out.push({ type: node.type, props });
    elements(props.children as ReactNode, out);
    for (const key of ['action', 'title']) if (isValidElement(props[key])) elements(props[key] as ReactNode, out);
  }
  return out;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('ADMIN_AGENT_ENABLED', 'true');
  mocks.flag.on = true;
  mocks.getLiveAccess.mockResolvedValue(access());
});

describe('assistantPageGate', () => {
  it('admits an admin the assistant is on for', async () => {
    expect(await assistantPageGate()).toBe('ok');
  });

  it('hands a signed-out visitor and a non-admin to the admin guard', async () => {
    mocks.getLiveAccess.mockResolvedValue(null);
    expect(await assistantPageGate()).toBe('denied');
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: false, isSiteAdmin: false }));
    expect(await assistantPageGate()).toBe('denied');
    mocks.getLiveAccess.mockResolvedValue(access({ player: null }));
    expect(await assistantPageGate()).toBe('denied');
  });

  it.each([
    ['the UI flag is off', () => { mocks.flag.on = false; }],
    ['the server switch is off', () => vi.stubEnv('ADMIN_AGENT_ENABLED', 'false')],
    ['the audience is site admins and this is a resource admin', () => mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: false }))],
    ['the admin is not on the allow-list', () => vi.stubEnv('ADMIN_AGENT_ALLOWED_PLAYER_IDS', '22222222-2222-4222-8222-222222222222')],
    ['the configuration is invalid', () => vi.stubEnv('ADMIN_AGENT_MAX_TEXT_CHARS', '1')],
  ])('is unavailable when %s', async (_name, change) => {
    change();
    expect(await assistantPageGate()).toBe('unavailable');
  });

  it('reads the live access, never the session copy', async () => {
    await assistantPageGate();
    expect(mocks.getLiveAccess).toHaveBeenCalledOnce();
  });
});

describe('/admin/assistant', () => {
  it('renders the conversation list for an admin', async () => {
    const tree = await AssistantPage();
    expect(elements(tree).some((e) => e.type === AssistantHome)).toBe(true);
  });

  it('shows nothing of the assistant to a non-admin: the guard answers', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: false }));
    const tree = await AssistantPage();
    expect(elements(tree).some((e) => e.type === AssistantHome)).toBe(false);
  });

  it('answers 404 where the assistant is off', async () => {
    mocks.flag.on = false;
    await expect(AssistantPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('/admin/assistant/[id]', () => {
  const page = (id: string) => ConversationPage({ params: Promise.resolve({ id }) });

  it('renders the conversation beside the plan panel for a valid id, lower-cased', async () => {
    const workspace = elements(await page(ID)).find((e) => e.type === AssistantWorkspace);
    expect(workspace?.props).toMatchObject({ conversationId: ID.toLowerCase(), variant: 'page' });
  });

  it('answers 404 for an id that cannot name a conversation, before any request', async () => {
    for (const id of ['not-a-uuid', '../../etc', `${ID}x`]) await expect(page(id)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('answers 404 where the assistant is off, and lets the guard answer a non-admin', async () => {
    mocks.flag.on = false;
    await expect(page(ID)).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.flag.on = true;
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: false }));
    expect(elements(await page(ID)).some((e) => e.type === AssistantWorkspace)).toBe(false);
  });
});

describe('the admin layout', () => {
  const layout = async () => elements(await AdminLayout({ children: <p>content</p> }));

  it('mounts the drawer for an admin the assistant is on for, beside the page transition and not inside it', async () => {
    const tree = await layout();
    expect(tree.some((e) => e.type === AssistantDrawer)).toBe(true);
    const transition = tree.find((e) => e.type === PageTransitionWrapper);
    expect(transition).toBeDefined();
    expect(elements(transition!.props.children as ReactNode).some((e) => e.type === AssistantDrawer)).toBe(false);
  });

  it.each([
    ['the UI flag is off', () => { mocks.flag.on = false; }],
    ['the server switch is off', () => vi.stubEnv('ADMIN_AGENT_ENABLED', 'false')],
    ['the viewer is a resource admin and the audience is site admins', () => mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: false }))],
  ])('does not mount the drawer when %s', async (_name, change) => {
    change();
    expect((await layout()).some((e) => e.type === AssistantDrawer)).toBe(false);
  });

  it('mounts it for a resource admin once the audience is widened', async () => {
    vi.stubEnv('ADMIN_AGENT_ROLES', 'any');
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: false }));
    expect((await layout()).some((e) => e.type === AssistantDrawer)).toBe(true);
  });
});
