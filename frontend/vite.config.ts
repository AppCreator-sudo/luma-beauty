import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/v2/',
  build: { outDir: '../public/v2', emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0 },
  server: { proxy: { '/api': 'http://localhost:3100', '/uploads': 'http://localhost:3100', '/auth': 'http://localhost:3100' } },
});
