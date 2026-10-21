import Badge from '@/components/ui/Badge';

/**
 * Marks a test league (`seasons.is_test_season`) in a league list: the public
 * list, the home teaser and the dashboard's My Leagues. The caller passes the
 * translated label (`leagues` namespace, `list.testBadge`), so the badge works
 * in server and client components alike.
 */
export default function TestLeagueBadge({ label }: { label: string }) {
  return (
    <Badge variant="yellow" size="sm">
      {label}
    </Badge>
  );
}
