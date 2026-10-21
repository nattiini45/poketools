/**
 * T01: the auth pages speak the viewer's language. Server pages read the
 * `plc_locale` cookie through getT; the `?error=` code maps
 * (`auth.errorPage.codes`, `auth.signIn.errors`) are keyed by the code
 * verbatim, and an unknown or odd code shows `Default`. English stays the
 * literal the pages always showed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';

const cookieJar = vi.hoisted(() => ({ locale: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'plc_locale' && cookieJar.locale !== undefined ? { name, value: cookieJar.locale } : undefined,
  }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next-auth/react', () => ({ signIn: vi.fn() }));

import AuthErrorPage from '../error/page';
import SignInPage from '../signin/page';
import SignInForm from '../signin/SignInForm';
import VerifyEmailPage from '../verify-email/page';
import SignUpForm from '../signup/SignUpForm';

async function renderPage(node: Promise<ReactNode>): Promise<string> {
  return renderToStaticMarkup(<>{await node}</>);
}

beforeEach(() => {
  cookieJar.locale = undefined;
});

describe('/auth/error', () => {
  it('keeps the English message for a known code', async () => {
    const html = await renderPage(AuthErrorPage({ searchParams: Promise.resolve({ error: 'LinkExpired' }) }));
    expect(html).toContain('Sign-in problem');
    expect(html).toContain('The Discord link request expired or was invalid.');
  });

  it('translates the code map for a German viewer', async () => {
    cookieJar.locale = 'de';
    const html = await renderPage(
      AuthErrorPage({ searchParams: Promise.resolve({ error: 'DiscordAlreadyLinked' }) }),
    );
    expect(html).toContain('Problem bei der Anmeldung');
    expect(html).toContain('Dieses Discord-Konto ist bereits mit einem anderen Spieler verknüpft.');
    expect(html).toContain('Zurück zur Anmeldung');
  });

  it.each(['Nope', '__proto__', 'codes.Default', '', undefined])('shows Default for %s', async (error) => {
    const html = await renderPage(AuthErrorPage({ searchParams: Promise.resolve({ error }) }));
    expect(html).toContain('Something went wrong during sign-in. Please try again.');
  });
});

describe('/auth/signin', () => {
  it('passes only a known code to the form, which translates it', async () => {
    cookieJar.locale = 'de';
    const tree = await SignInPage({ searchParams: Promise.resolve({ error: 'OAuthSignin' }) });
    const html = renderWithI18n(<>{tree}</>, { locale: 'de' });
    expect(html).toContain('<h1');
    expect(html).toContain('Anmelden');
    expect(html).toContain('Die Anmeldung mit Discord ist fehlgeschlagen.');
    expect(html).toContain('Mit Discord anmelden');
  });

  it('an unknown code falls back to Default', async () => {
    const tree = await SignInPage({ searchParams: Promise.resolve({ error: 'Weird' }) });
    expect(renderWithI18n(<>{tree}</>)).toContain('Sign-in failed. Please try again.');
  });

  it('the form keeps the English copy without a provider', () => {
    const html = renderToStaticMarkup(<SignInForm callbackUrl="/" initialErrorCode={null} />);
    expect(html).toContain('Sign in with Discord');
    expect(html).toContain('Forgot password?');
    expect(html).not.toContain('role="alert"');
  });
});

describe('/auth/verify-email', () => {
  it('names the address when one is given', async () => {
    cookieJar.locale = 'de';
    const html = await renderPage(VerifyEmailPage({ searchParams: Promise.resolve({ email: 'ash@example.com' }) }));
    expect(html).toContain('Schau in dein Postfach');
    expect(html).toContain('Wir haben einen Bestätigungslink an ash@example.com geschickt.');
  });

  it('keeps the English sentence without an address', async () => {
    const html = await renderPage(VerifyEmailPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('We sent a confirmation link. Click it to activate your account');
  });
});

describe('SignUpForm', () => {
  it('labels the fields in German', () => {
    const html = renderWithI18n(<SignUpForm />, { locale: 'de' });
    expect(html).toContain('Anzeigename');
    expect(html).toContain('Mindestens 8 Zeichen.');
    expect(html).toContain('Du hast schon ein Konto?');
  });
});
