import TypeSprite from './TypeSprite';

interface GymTypedNameProps {
  name: string;
  gymType: string | null;
  className?: string;
}

/**
 * Renders a player name with an optional gym leader type sprite behind (after) the name.
 * When gymType is null, renders just the name — no extra markup.
 */
export default function GymTypedName({ name, gymType, className = '' }: GymTypedNameProps) {
  if (!gymType) {
    return <span className={className}>{name}</span>;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span>{name}</span>
      <TypeSprite type={gymType} size={16} />
    </span>
  );
}
