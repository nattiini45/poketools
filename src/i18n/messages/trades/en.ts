/**
 * EPB trade consent (owner T03): the player prompt on the league page
 * (`TradeConsentPrompt`) and the admin status list (`AdminPendingTrades`).
 * English copied verbatim; the proposal sentence is one rich message.
 */
export default {
  prompt: {
    header: 'Pending trade proposals awaiting your consent',
    proposal: 'Trade proposal: you give <b>{yourLine}</b>, you receive <b>{receivedLine}</b> from <b>{partnerName}</b>.',
    bothConsented: 'Both sides consented.',
    waitingOther: 'Your consent recorded — waiting for {otherName}.',
    waitingBoth: "Waiting for your consent and {otherName}'s.",
    consentButton: 'Consent to Trade',
    declineButton: 'Decline',
    errorConsent: 'Failed to record consent',
    errorDecline: 'Failed to decline trade',
    successDeclined: 'Trade declined and cancelled.',
    successExecuted: 'Trade completed — the swap has been executed.',
    successPending: 'Consent recorded — waiting for the other player.',
    errorNetwork: 'Network error — please try again.',
  },
  admin: {
    intro: 'Pending trades awaiting player consent. Either side or an admin may cancel.',
    empty: 'No pending trades.',
    cancel: 'Cancel',
    errorCancel: 'Failed to cancel trade',
    errorNetwork: 'Network error — please try again.',
  },
} as const;
