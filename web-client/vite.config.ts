import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/v1': 'http://10.224.174.3:34199',
      '/models': 'http://10.224.174.3:34199',
      '/model': 'http://10.224.174.3:34199',
    },
  },
  experimental: {
    resolver: {
      node: true,
    },
  },
});
