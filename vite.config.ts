import { defineConfig } from 'vite';

const gameServerPort = Number(process.env.PLAKOTO_SERVER_PORT) || 3001;

export default defineConfig({
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    proxy: { '/ws': { target: `http://127.0.0.1:${gameServerPort}`, ws: true } },
  },
  preview: { host: 'localhost', port: 3000, strictPort: true },
});
