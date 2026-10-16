import type { CapacitorConfig } from '@capacitor/cli';

// The standalone iPad app. Build the web part with VITE_MODE=ios first (see README).
const config: CapacitorConfig = {
  appId: 'com.yoopermichigan.chesscoach',
  appName: 'Chess Coach',
  webDir: 'dist',
  ios: {
    contentInset: 'never', // the page handles safe areas itself (viewport-fit=cover)
  },
};

export default config;
