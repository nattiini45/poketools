/**
 * A short device label from a User-Agent ("Chrome on Android"), derived on the server at subscribe time.
 * Only the label is stored; the raw User-Agent never is (docs/push.md, "Privacy"). Pure.
 *
 * Order matters: the Chromium-based browsers all say "Chrome/", Edge and Opera say it too, and every
 * iOS browser says "Safari" (Chrome on iOS adds `CriOS`, Firefox on iOS `FxiOS`).
 */

const MAX_LABEL_LENGTH = 80;

function browserOf(ua: string): string | null {
  if (/EdgA?\/|Edg\/|EdgiOS\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return null;
}

function systemOf(ua: string): string | null {
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone/.test(ua)) return 'iOS';
  if (/iPad/.test(ua)) return 'iPadOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Windows/.test(ua)) return 'Windows';
  // iPadOS 13+ Safari reports a Mac UA; a Mac with touch points is told apart client-side only, so it reads as macOS.
  if (/Macintosh|Mac OS X/.test(ua)) return 'macOS';
  if (/Linux|X11/.test(ua)) return 'Linux';
  return null;
}

export function deviceLabelFromUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  // Bound the work on a hostile header; labels only need the first few hundred characters.
  const ua = userAgent.slice(0, 512);
  const browser = browserOf(ua);
  const system = systemOf(ua);
  const label = browser && system ? `${browser} on ${system}` : (browser ?? system);
  return label ? label.slice(0, MAX_LABEL_LENGTH) : null;
}
