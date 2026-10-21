import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  links: {
    tournaments: 'Turniere',
    leagues: 'Ligen',
    replays: 'Replays',
    insights: 'Insights',
    wiki: 'Wiki',
    players: 'Spieler',
    teams: 'Teams',
    creator: 'Creator-Hub',
    admin: 'Admin',
  },
  viewPublicProfile: 'Öffentliches Profil ansehen',
  toggleMenu: 'Menü umschalten',
  closeMenu: 'Menü schließen',
});
