import { permanentRedirect } from 'next/navigation';

export default function LeaderboardRedirectPage() {
  permanentRedirect('/insights?tab=ratings');
}
