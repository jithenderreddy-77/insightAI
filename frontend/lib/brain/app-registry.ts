// frontend/lib/brain/app-registry.ts
// Application & Web Session Registry — Manages native apps vs browser tab reuse.

import { isTabOpen, registerOpenTab } from './device-context';

export interface AppProfile {
  name: string;
  aliases: string[];
  nativeScheme?: string;
  webUrl: string;
  category: 'social' | 'media' | 'productivity' | 'utility';
}

export const APP_REGISTRY: Record<string, AppProfile> = {
  whatsapp: {
    name: 'WhatsApp',
    aliases: ['whatsapp', 'wa', 'whatsup', 'whats app'],
    nativeScheme: 'whatsapp://',
    webUrl: 'https://web.whatsapp.com',
    category: 'social',
  },
  spotify: {
    name: 'Spotify',
    aliases: ['spotify', 'music player'],
    nativeScheme: 'spotify://',
    webUrl: 'https://open.spotify.com',
    category: 'media',
  },
  vscode: {
    name: 'VS Code',
    aliases: ['vscode', 'vs code', 'visual studio code', 'code editor'],
    nativeScheme: 'vscode://',
    webUrl: 'https://vscode.dev',
    category: 'productivity',
  },
  zoom: {
    name: 'Zoom',
    aliases: ['zoom', 'zoom meeting'],
    nativeScheme: 'zoommtg://',
    webUrl: 'https://zoom.us',
    category: 'productivity',
  },
  slack: {
    name: 'Slack',
    aliases: ['slack'],
    nativeScheme: 'slack://',
    webUrl: 'https://app.slack.com',
    category: 'social',
  },
  discord: {
    name: 'Discord',
    aliases: ['discord'],
    nativeScheme: 'discord://',
    webUrl: 'https://discord.com/app',
    category: 'social',
  },
  telegram: {
    name: 'Telegram',
    aliases: ['telegram', 'tg'],
    nativeScheme: 'tg://',
    webUrl: 'https://web.telegram.org',
    category: 'social',
  },
  teams: {
    name: 'Microsoft Teams',
    aliases: ['teams', 'microsoft teams', 'msteams'],
    nativeScheme: 'msteams://',
    webUrl: 'https://teams.microsoft.com',
    category: 'productivity',
  },
  gmail: {
    name: 'Gmail',
    aliases: ['gmail', 'google mail', 'email', 'mail'],
    webUrl: 'https://mail.google.com',
    category: 'productivity',
  },
  youtube: {
    name: 'YouTube',
    aliases: ['youtube', 'yt'],
    nativeScheme: 'vnd.youtube://',
    webUrl: 'https://www.youtube.com',
    category: 'media',
  },
  github: {
    name: 'GitHub',
    aliases: ['github', 'git'],
    webUrl: 'https://github.com',
    category: 'productivity',
  },
};

export interface NavigationTarget {
  url: string;
  nativeScheme?: string;
  reusedExistingTab: boolean;
  appName: string;
}

/**
 * Determine the best execution path (native app vs existing browser tab vs new tab).
 */
export function resolveAppTarget(targetQuery: string): NavigationTarget {
  const q = targetQuery.toLowerCase().trim();

  for (const [key, app] of Object.entries(APP_REGISTRY)) {
    if (app.aliases.some((alias) => q.includes(alias))) {
      const alreadyOpen = isTabOpen(app.webUrl);

      // Register that this tab is now open
      registerOpenTab(app.webUrl);

      return {
        url: app.webUrl,
        nativeScheme: app.nativeScheme,
        reusedExistingTab: alreadyOpen,
        appName: app.name,
      };
    }
  }

  // Generic website fallback
  const isUrl = q.includes('.') && !q.includes(' ');
  const targetUrl = isUrl ? (q.startsWith('http') ? q : `https://${q}`) : `https://www.google.com/search?q=${encodeURIComponent(q)}`;

  const alreadyOpen = isTabOpen(targetUrl);
  registerOpenTab(targetUrl);

  return {
    url: targetUrl,
    reusedExistingTab: alreadyOpen,
    appName: isUrl ? q : 'Web Search',
  };
}
