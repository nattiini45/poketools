import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  bell: {
    label: 'Benachrichtigungen',
    labelUnread: 'Benachrichtigungen, {count} ungelesen',
    announceUnread: { one: '{count} ungelesene Benachrichtigung', other: '{count} ungelesene Benachrichtigungen' },
    overflow: '99+',
  },
  panel: {
    title: 'Benachrichtigungen',
    markAllRead: 'Alle als gelesen markieren',
    empty: 'Nichts Neues. Herausforderungen und Hinweise aus deinen Ligen erscheinen hier.',
    loading: 'Wird geladen …',
    loadFailed: 'Deine Benachrichtigungen konnten nicht geladen werden.',
    markFailed: 'Deine Benachrichtigungen konnten nicht als gelesen markiert werden.',
    retry: 'Erneut versuchen',
    loadMore: 'Ältere anzeigen',
    unread: 'Ungelesen',
  },
  challenge: {
    created: '{player} hat dich herausgefordert.',
    accepted: '{player} hat deine Herausforderung angenommen.',
    declined: '{player} hat deine Herausforderung abgelehnt.',
    expired_defender: 'Die Herausforderung von {player} ist abgelaufen, bevor du geantwortet hast.',
    expired_challenger: '{player} hat nicht rechtzeitig auf deine Herausforderung geantwortet.',
    cancelled_defender: 'Die Herausforderung von {player} wurde abgebrochen.',
    cancelled_challenger: 'Deine Herausforderung an {player} wurde abgebrochen.',
  },
  challengeFormer: {
    created: 'Ein ehemaliger Spieler hat dich herausgefordert.',
    accepted: 'Ein ehemaliger Spieler hat deine Herausforderung angenommen.',
    declined: 'Ein ehemaliger Spieler hat deine Herausforderung abgelehnt.',
    expired_defender: 'Die Herausforderung eines ehemaligen Spielers ist abgelaufen, bevor du geantwortet hast.',
    expired_challenger: 'Ein ehemaliger Spieler hat nicht rechtzeitig auf deine Herausforderung geantwortet.',
    cancelled_defender: 'Die Herausforderung eines ehemaligen Spielers wurde abgebrochen.',
    cancelled_challenger: 'Deine Herausforderung an einen ehemaligen Spieler wurde abgebrochen.',
  },
});
