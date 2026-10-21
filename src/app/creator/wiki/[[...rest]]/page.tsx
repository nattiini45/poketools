import { permanentRedirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ rest?: string[] }>;
}

export default async function CreatorWikiRedirectPage({ params }: PageProps) {
  const { rest } = await params;
  const suffix = rest?.length ? rest.join('/') : '';
  permanentRedirect(suffix ? `/wiki/${suffix}` : '/wiki');
}
