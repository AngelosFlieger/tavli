import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    proxy: { '/ws': { target: 'http://127.0.0.1:3001', ws: true } },
  },
  preview: { host: 'localhost', port: 3000, strictPort: true },
});
