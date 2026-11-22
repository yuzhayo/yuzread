import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./screen', import.meta.url)),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@ui': fileURLToPath(new URL('./screen/shared/components', import.meta.url)),
      '@logic': fileURLToPath(new URL('./screen/shared/logic', import.meta.url)),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: fileURLToPath(new URL('./screen-built', import.meta.url)),
    emptyOutDir: true,
  },
});
