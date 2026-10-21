import Link from 'next/link';

interface PokemonLinkProps {
  name: string;
  children: React.ReactNode;
  className?: string;
}

export default function PokemonLink({ name, children, className }: PokemonLinkProps) {
  return (
    <Link
      href={`/pokemon/${encodeURIComponent(name)}`}
      className={`flex items-center gap-2 hover:text-poke-blue transition-colors ${className ?? ''}`}
    >
      {children}
    </Link>
  );
}
