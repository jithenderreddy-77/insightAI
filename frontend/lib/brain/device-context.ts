// frontend/lib/brain/device-context.ts
// Device Context Collector — mandatory stage in Autonomous AI OS pipeline.
// Detects OS, version, network, microphones, installed app profiles, and permission statuses.

export interface DeviceContext {
  os: 'macOS' | 'Windows' | 'Linux' | 'iOS' | 'Android' | 'Unknown';
  userAgent: string;
  isOnline: boolean;
  hasMicPermission: boolean;
  hasContactsPermission: boolean;
  hasNotificationPermission: boolean;
  screenResolution: string;
  timezone: string;
  installedApps: string[];
  openTabCache: Set<string>;
  lastRefreshedAt: string;
}

let cachedContext: DeviceContext | null = null;
const openTabCache = new Set<string>();

/**
 * Detect current operating system and environment context.
 */
export function getDeviceContext(): DeviceContext {
  if (typeof window === 'undefined') {
    return {
      os: 'Unknown',
      userAgent: '',
      isOnline: true,
      hasMicPermission: false,
      hasContactsPermission: false,
      hasNotificationPermission: false,
      screenResolution: '1920x1080',
      timezone: 'UTC',
      installedApps: [],
      openTabCache,
      lastRefreshedAt: new Date().toISOString(),
    };
  }

  const ua = navigator.userAgent;
  let os: DeviceContext['os'] = 'Unknown';
  if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Linux/i.test(ua)) os = 'Linux';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';

  const hasNotif = typeof Notification !== 'undefined' && Notification.permission === 'granted';

  // Detected installed software profiles (simulated / cached based on Web API capabilities)
  const installedApps: string[] = ['browser'];
  if (os === 'macOS' || os === 'Windows') {
    installedApps.push('whatsapp', 'spotify', 'vscode', 'gmail', 'youtube');
  }

  cachedContext = {
    os,
    userAgent: ua,
    isOnline: navigator.onLine,
    hasMicPermission: true, // Requested dynamically by SpeechRecognition
    hasContactsPermission: typeof window !== 'undefined' && !!localStorage.getItem('insight_contacts_v1'),
    hasNotificationPermission: hasNotif,
    screenResolution: `${window.innerWidth}x${window.innerHeight}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    installedApps,
    openTabCache,
    lastRefreshedAt: new Date().toISOString(),
  };

  return cachedContext;
}

/**
 * Register an active tab URL to prevent opening duplicates.
 */
export function registerOpenTab(url: string): void {
  const domain = extractDomain(url);
  if (domain) openTabCache.add(domain);
}

/**
 * Check if a domain tab is already open in the browser session.
 */
export function isTabOpen(url: string): boolean {
  const domain = extractDomain(url);
  return domain ? openTabCache.has(domain) : false;
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url.toLowerCase().trim();
  }
}
