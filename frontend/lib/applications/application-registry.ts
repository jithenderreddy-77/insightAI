// frontend/lib/applications/application-registry.ts
// Application Adapter Registry

import { ApplicationAdapter } from './application-adapter';
import { genericWebAdapter } from './generic-web-adapter';
import { whatsappAdapter } from './whatsapp-adapter';
import { youtubeAdapter } from './youtube-adapter';
import { instagramAdapter } from './instagram-adapter';

export class ApplicationAdapterRegistry {
  private adapters: ApplicationAdapter[] = [];

  constructor() {
    this.register(whatsappAdapter);
    this.register(youtubeAdapter);
    this.register(instagramAdapter);
  }

  public register(adapter: ApplicationAdapter) {
    this.adapters.push(adapter);
  }

  public resolveAdapter(appNameOrUrl: string): ApplicationAdapter {
    const q = appNameOrUrl.toLowerCase().trim();

    for (const adapter of this.adapters) {
      if (adapter.aliases.some((alias) => q.includes(alias)) || adapter.canHandle(q)) {
        return adapter;
      }
    }

    return genericWebAdapter; // Universal Computer Interaction Layer Fallback
  }
}

export const applicationAdapterRegistry = new ApplicationAdapterRegistry();
