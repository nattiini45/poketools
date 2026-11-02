import Link from 'next/link';
import { MAIN_CONTENT_ID } from '@/lib/ui/main-content';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id={MAIN_CONTENT_ID} tabIndex={-1} className="min-h-screen flex flex-col items-center justify-center px-4 py-12 focus:outline-none">
      <Link
        href="/"
        className="mb-6 text-2xl font-heading font-extrabold uppercase tracking-[0.04em] text-poke-text-primary"
      >
        {/* i18n-ignore: brand wordmark (PokéTools), the same in every language */}
        Poké<span className="text-poke-accent">Tools</span>
      </Link>
      <div className="w-full max-w-md space-y-4">{children}</div>
    </main>
  );
}
