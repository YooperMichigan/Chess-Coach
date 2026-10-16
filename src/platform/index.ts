// The active platform: the Mac/web server version or the standalone iPad version, chosen at
// build time with VITE_MODE (see vite.config.ts, which points this import at the right file).
// UI code imports from here and never needs to know which one it got.
import { createPlatform } from '@platform-impl';

export const platform = createPlatform();
export const { coach, store, apiKey } = platform;
