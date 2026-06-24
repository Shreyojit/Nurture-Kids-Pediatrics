import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // react-draggable (used by react-rnd) references process.env.NODE_ENV at runtime;
    // Vite doesn't polyfill process, so we inject it explicitly.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
