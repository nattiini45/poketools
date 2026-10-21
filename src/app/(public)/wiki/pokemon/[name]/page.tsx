import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ name: string }>;
}

export default async function RedirectWikiPokemonPage({ params }: PageProps) {
  const { name } = await params;
  redirect(`/pokemon/${encodeURIComponent(name)}`);
}

export const permanent = true;
