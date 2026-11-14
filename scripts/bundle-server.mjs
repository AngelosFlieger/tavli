import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('dist-server', { recursive: true });
await build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist-server/index.mjs',
  external: ['ws', 'mongodb'],
});
