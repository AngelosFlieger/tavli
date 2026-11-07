import { randomInt } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { WebSocket, WebSocketServer, type WebSocket as Socket } from 'ws';
import { createLobby, type PlayerId } from '../src/net/lobby';
import type { ServerMessage } from '../src/net/messages';

const production = process.argv.includes('--static');
const port = Number(process.env.PORT) || (production ? 3000 : 3001);
const root = join(process.cwd(), 'dist');
const lobby = createLobby(() => randomInt(1, 7));
const sockets = new Map<PlayerId, Socket>();
let nextId = 1;

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
};

const http = createServer((request, response) => {
  if (!production) {
    response.writeHead(404);
    response.end();
    return;
  }
  void serveStatic(request, response);
});

const wss = new WebSocketServer({ server: http, path: '/ws' });

wss.on('connection', (socket) => {
  const id = String(nextId++);
  sockets.set(id, socket);
  socket.on('message', (data) => {
    let message: unknown;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    if (message.type === 'find') {
      const joined = lobby.join(id);
      if (!joined) return;
      if (joined.type === 'waiting') {
        send(id, { type: 'waiting' });
        return;
      }
      joined.ids.forEach((playerId, index) =>
        send(playerId, { type: 'matched', you: index === 0 ? 0 : 1, state: joined.state }),
      );
      return;
    }
    if (message.type === 'cancel') {
      lobby.cancel(id);
      return;
    }
    const result = lobby.act(id, message);
    if (!result) return;
    for (const playerId of result.to) send(playerId, { type: 'update', ...result.update });
  });
  socket.on('close', () => {
    sockets.delete(id);
    const opponent = lobby.leave(id);
    if (opponent) send(opponent, { type: 'left' });
  });
});

http.listen(port, '0.0.0.0', () => {
  console.log(`Plakoto server on port ${port}${production ? ', serving dist/' : ''}`);
});

function send(id: PlayerId, message: ServerMessage) {
  const socket = sockets.get(id);
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function serveStatic(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  let pathname = '/';
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^[/\\]+/, '');
  const file = normalize(join(root, relative));
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404);
    response.end();
  }
}
