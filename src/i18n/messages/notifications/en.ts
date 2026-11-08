export default {
  bell: {
    label: 'Notifications',
    labelUnread: 'Notifications, {count} unread',
    announceUnread: '{count} unread notifications',
    overflow: '99+',
  },
  panel: {
    title: 'Notifications',
    markAllRead: 'Mark all as read',
    empty: 'Nothing new. Challenges and notices from your leagues show up here.',
    loading: 'Loading…',
    loadFailed: 'Your notifications could not be loaded.',
    markFailed: 'Your notifications could not be marked as read.',
    retry: 'Try again',
    loadMore: 'Show older',
    unread: 'Unread',
    formerPlayer: 'Former player',
  },
  challenge: {
    created: '{player} challenged you.',
    accepted: '{player} accepted your challenge.',
    declined: '{player} declined your challenge.',
    expired_defender: 'The challenge from {player} expired before you answered.',
    expired_challenger: '{player} did not answer your challenge in time.',
    cancelled_defender: 'The challenge from {player} was cancelled.',
    cancelled_challenger: 'Your challenge to {player} was cancelled.',
  },
} as const;
