import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 32111,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: process.env.OFFICE_API_TARGET || 'http://127.0.0.1:32110',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
  optimizeDeps: {
    include: ['pdfjs-dist/build/pdf.mjs'],
  },
});
