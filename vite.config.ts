import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  server: { port: 5180 },
  build: { outDir: 'dist', chunkSizeWarningLimit: 4000 },
});
