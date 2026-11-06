import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'web'),
  publicDir: resolve(__dirname, 'web/public'),
  build: {
    outDir: resolve(__dirname, 'dist/public'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    fs: { allow: [resolve(__dirname)] },
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  test: undefined,
} as any);
