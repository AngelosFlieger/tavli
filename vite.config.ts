import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: 'localhost',
    port: 3000,
    strictPort: true,
    watch: { usePolling: true, interval: 250 },
  },
  preview: { host: 'localhost', port: 3000, strictPort: true },
});
