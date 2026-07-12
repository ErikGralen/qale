// Stub config so the shadcn CLI's framework detection works alongside
// electron.vite.config.ts (PLAN §5, Phase 0.5). The real build is driven by
// electron-vite; this file is not used to run the app.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@renderer': resolve(__dirname, 'src/renderer/src') },
  },
});
