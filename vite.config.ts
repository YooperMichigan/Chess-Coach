import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// VITE_MODE=ios builds the standalone iPad app (direct API calls, on-device storage).
// Anything else builds the Mac/web app that talks to the local Express server.
const ios = process.env.VITE_MODE === 'ios';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@platform-impl': fileURLToPath(new URL(ios ? './src/platform/device.ts' : './src/platform/server.ts', import.meta.url)),
    },
  },
  server: {
    // Coach calls go to the local Express server, which holds the API key.
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
