import { randomInt } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { WebSocket, WebSocketServer, type WebSocket as Socket } from 'ws';
import type { PlayerId } from '../src/net/lobby';
import {
  isHello,
  isMatchSelection,
  isProtocolCompatible,
  isRevisionedCommand,
  type ServerMessage,
} from '../src/net/messages';
import { createAccounts } from './accounts';
import { handleAuth, sessionToken } from './routes';
import { openStore } from './store';
import { createTables } from './tables';
import { createSeededDie, createSeededRandomInt, parseOptionalSeed } from '../src/game/random';
import { boundedBucket, type TokenBucket } from '../src/net/rate-limit';
import { loadServerConfig } from './config';

const config = loadServerConfig(process.env, process.argv);
const production = config.production;
const port = config.port;
const root = join(process.cwd(), 'dist');
const store = await openStore({ url: config.mongoUrl, name: config.databaseName }).catch(
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
const accounts = createAccounts(store);
const testSeed = parseOptionalSeed(process.env.PLAKOTO_TEST_RANDOM_SEED ?? '');
const authorityRandomInt =
  testSeed === undefined
    ? (maximum: number) => randomInt(maximum)
    : createSeededRandomInt(testSeed);
const rollDie = testSeed === undefined ? () => randomInt(1, 7) : createSeededDie(testSeed);
const tables = createTables(store, rollDie, () => Date.now(), authorityRandomInt, config.clock);
await tables.start();
const sockets = new Map<PlayerId, Socket>();
const owners = new Map<Socket, PlayerId>();
const replaced = new WeakSet<Socket>();
const socketBuckets = new Map<Socket, TokenBucket>();
const httpBuckets = new Map<string, TokenBucket>();
const maxSocketPayload = 64 * 1024;
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
    sendSocket(socket, { type: 'rejected', reason: 'AUTH' });
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
  let ready = false;
  const handshakeTimer = setTimeout(() => {
    if (!ready) socket.close();
  }, 10_000);
  handshakeTimer.unref();

  socket.on('message', (data) => {
    const payloadBytes = Array.isArray(data)
      ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
      : data.byteLength;
    if (payloadBytes > maxSocketPayload) {
      socket.close(1009, 'payload too large');
      return;
    }
    const bucket = boundedBucket(socketBuckets, socket, 20, 40, Date.now());
    if (!bucket.take(Date.now())) {
      socket.close(1008, 'rate limit');
      return;
    }
    void (async () => {
      if (ready) {
        await handleCommand(socket, data);
        return;
      }
      const message = parse(data);
      if (!isHello(message)) {
        sendSocket(socket, { type: 'rejected', reason: 'PROTOCOL' });
        socket.close();
        return;
      }
      if (!isProtocolCompatible(message.protocol)) {
        sendSocket(socket, { type: 'rejected', reason: 'PROTOCOL' });
        socket.close();
        return;
      }
      const negotiatedProtocol = message.protocol;
      ready = true;
      clearTimeout(handshakeTimer);
      const resumed = await tables.connect(user.id);
      if (resumed.length === 0)
        send(user.id, { type: 'ready', protocol: negotiatedProtocol, name: user.username });
      else deliver(resumed);
    })().catch((error: unknown) => {
      console.error(error);
      send(user.id, { type: 'error', code: 'INTERNAL' });
    });
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    clearTimeout(handshakeTimer);
    socketBuckets.delete(socket);
    if (replaced.has(socket)) return;
    const userId = owners.get(socket);
    owners.delete(socket);
    if (!userId || sockets.get(userId) !== socket) return;
    sockets.delete(userId);
    void tables.disconnect(userId).then(deliver).catch(console.error);
  });
}

async function handleCommand(socket: Socket, data: unknown) {
  const message = parse(data);
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  const userId = owners.get(socket);
  if (!userId) return;
  try {
    if (message.type === 'find') {
      if (!('selection' in message) || !isMatchSelection(message.selection)) {
        send(userId, { type: 'error', code: 'INVALID_COMMAND' });
        return;
      }
      deliver(await tables.find(userId, message.selection));
      return;
    }
    if (message.type === 'createRoom') {
      if (!('selection' in message) || !isMatchSelection(message.selection)) {
        send(userId, { type: 'error', code: 'INVALID_COMMAND' });
        return;
      }
      deliver(await tables.createRoom(userId, message.selection));
      return;
    }
    if (message.type === 'joinRoom') {
      if (typeof message.code !== 'string' || !/^[A-Z0-9]{4,8}$/i.test(message.code)) {
        send(userId, { type: 'error', code: 'INVALID_COMMAND' });
        return;
      }
      deliver(await tables.joinRoom(userId, message.code));
      return;
    }
    if (message.type === 'cancel') {
      deliver(await tables.cancel(userId));
      return;
    }
    if (!isRevisionedCommand(message)) {
      send(userId, { type: 'error', code: 'INVALID_COMMAND' });
      return;
    }
    deliver(
      await tables.act(userId, message.command, {
        commandId: message.commandId,
        matchId: message.matchId,
        expectedRevision: message.expectedRevision,
      }),
    );
  } catch (error) {
    console.error(error);
    send(userId, { type: 'error', code: 'INTERNAL' });
  }
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

async function shutdown() {
  clearInterval(syncTimer);
  wss.close();
  http.close();
  await store.close();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

async function route(request: IncomingMessage, response: ServerResponse) {
  applySecurityHeaders(request, response);
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    sendJson(response, 200, { ok: true, uptime: Math.round(process.uptime()) });
    return;
  }
  if (url.pathname === '/readyz') {
    const ready = await store.ping();
    sendJson(response, ready ? 200 : 503, { ok: ready });
    return;
  }
  const remote = request.socket.remoteAddress ?? 'unknown';
  if (!boundedBucket(httpBuckets, remote, 30, 60, Date.now()).take(Date.now())) {
    sendJson(response, 429, { error: 'Too many requests' });
    return;
  }
  if (await handleAuth(request, response, accounts)) return;
  if (!production) {
    response.writeHead(404);
    response.end();
    return;
  }
  await serveStatic(request, response);
}

function applySecurityHeaders(request: IncomingMessage, response: ServerResponse) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  const forwarded = request.headers['x-forwarded-proto'];
  if (forwarded === 'https' || (request.socket as { encrypted?: boolean }).encrypted)
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function deliver(events: { userId: string; message: ServerMessage }[]) {
  for (const event of events) send(event.userId, event.message);
}

function send(id: PlayerId, message: ServerMessage) {
  const socket = sockets.get(id);
  if (socket) sendSocket(socket, message);
}

function sendSocket(socket: Socket, message: ServerMessage) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function parse(data: unknown) {
  try {
    return JSON.parse(String(data)) as { type?: unknown; [key: string]: unknown };
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
  let pathname: string;
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
    const hashedAsset = file.includes(`${sep}assets${sep}`);
    response.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'cache-control': hashedAsset
        ? 'public, max-age=31536000, immutable'
        : file.endsWith('.html')
          ? 'no-store'
          : 'public, max-age=86400',
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404);
    response.end();
  }
}
