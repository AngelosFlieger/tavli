import { randomInt } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { WebSocket, WebSocketServer, type WebSocket as Socket } from 'ws';
import type { PlayerId } from '../src/net/lobby';
import { isCommand, type ServerMessage } from '../src/net/messages';
import { createAccounts } from './accounts';
import { handleAuth, sessionToken } from './routes';
import { openStore } from './store';
import { createTables } from './tables';

const production = process.argv.includes('--static');
const port = Number(process.env.PORT) || (production ? 3000 : 3001);
const root = join(process.cwd(), 'dist');
const store = await openStore().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
const accounts = createAccounts(store);
const tables = createTables(store, () => randomInt(1, 7));
const sockets = new Map<PlayerId, Socket>();
const owners = new Map<Socket, PlayerId>();
const replaced = new WeakSet<Socket>();
let syncing = false;

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
  void route(request, response);
});

const wss = new WebSocketServer({ server: http, path: '/ws' });

wss.on('connection', (socket, request) => {
  void attach(socket, request);
});

async function attach(socket: Socket, request: IncomingMessage) {
  const token = sessionToken(request.headers.cookie);
  const user = token ? await accounts.authenticate(token) : null;
  if (!user) {
    sendSocket(socket, { type: 'rejected' });
    socket.close();
    return;
  }
  const previous = sockets.get(user.id);
  if (previous && previous !== socket) {
    replaced.add(previous);
    previous.close();
  }
  sockets.set(user.id, socket);
  owners.set(socket, user.id);
  const resumed = await tables.connect(user.id);
  if (resumed.length === 0) send(user.id, { type: 'ready', name: user.username });
  else deliver(resumed);

  socket.on('message', (data) => {
    void handleCommand(socket, data);
  });
  socket.on('close', () => {
    if (replaced.has(socket)) return;
    const userId = owners.get(socket);
    owners.delete(socket);
    if (!userId || sockets.get(userId) !== socket) return;
    sockets.delete(userId);
    void tables.disconnect(userId);
  });
}

async function handleCommand(socket: Socket, data: unknown) {
  const message = parse(data);
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  const userId = owners.get(socket);
  if (!userId) return;
  if (message.type === 'find') {
    deliver(await tables.find(userId));
    return;
  }
  if (message.type === 'cancel') {
    deliver(await tables.cancel(userId));
    return;
  }
  const command = isCommand(message) ? message : null;
  if (!command) return;
  deliver(await tables.act(userId, command));
}

http.listen(port, '0.0.0.0', () => {
  const hosts = lanAddresses();
  console.log(`Plakoto server on port ${port}${production ? ', serving dist/' : ''}`);
  for (const host of hosts) console.log(`Phone and other devices: http://${host}:${port}`);
});

const syncTimer = setInterval(() => {
  if (syncing) return;
  syncing = true;
  void tables
    .sync()
    .then(deliver)
    .finally(() => {
      syncing = false;
    });
}, 250);
syncTimer.unref();

async function route(request: IncomingMessage, response: ServerResponse) {
  if (await handleAuth(request, response, accounts)) return;
  if (!production) {
    response.writeHead(404);
    response.end();
    return;
  }
  await serveStatic(request, response);
}

function deliver(events: { userId: string; message: ServerMessage }[]) {
  for (const event of events) send(event.userId, event.message);
}

function send(id: PlayerId, message: ServerMessage) {
  const socket = sockets.get(id);
  if (socket) sendSocket(socket, message);
}

function sendSocket(socket: Socket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function parse(data: unknown) {
  try {
    return JSON.parse(String(data)) as { type?: unknown };
  } catch {
    return null;
  }
}

function lanAddresses() {
  const found: string[] = [];
  let interfaces: ReturnType<typeof networkInterfaces>;
  try {
    interfaces = networkInterfaces();
  } catch {
    return found;
  }
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
    }
  }
  return found;
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
