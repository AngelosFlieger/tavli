import { spawn } from 'node:child_process';

await import('./bundle-server.mjs');

const children = [
  spawn(process.execPath, ['dist-server/index.mjs'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];

function stop() {
  for (const child of children) child.kill('SIGTERM');
}

for (const child of children) {
  child.on('exit', (code) => {
    stop();
    process.exit(code ?? 0);
  });
}

process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});
