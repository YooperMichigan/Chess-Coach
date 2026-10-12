import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    // Coach calls go to the local Express server, which holds the API key.
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
