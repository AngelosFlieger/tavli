import type { IncomingMessage, ServerResponse } from 'node:http';
import { TLSSocket } from 'node:tls';
import type { createAccounts } from './accounts';

type Accounts = ReturnType<typeof createAccounts>;

const cookieName = 'plakoto_session';
const cookieMaxAge = 30 * 24 * 60 * 60;

export function sessionToken(cookieHeader: string | undefined) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== cookieName) continue;
    try {
      return decodeURIComponent(rest.join('=')) || null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function handleAuth(
  request: IncomingMessage,
  response: ServerResponse,
  accounts: Accounts,
) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/auth')) return false;
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'content-type, authorization');
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return true;
  }

  const token = sessionToken(request.headers.cookie);
  if (request.method === 'GET' && url.pathname === '/auth/me') {
    const user = token ? await accounts.authenticate(token) : null;
    send(
      response,
      user ? 200 : 401,
      user ? { username: user.username } : { error: 'Sign in again.' },
    );
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/auth/logout') {
    if (token) await accounts.logout(token);
    setSessionCookie(request, response, null);
    send(response, 204, null);
    return true;
  }
  if (request.method !== 'POST') {
    send(response, 404, { error: 'Not found.' });
    return true;
  }

  const body = await readJson(request);
  if (!body || typeof body !== 'object') {
    send(response, 400, { error: 'Enter your account details.' });
    return true;
  }
  const fields = body as {
    email?: unknown;
    username?: unknown;
    identifier?: unknown;
    password?: unknown;
  };
  const email = typeof fields.email === 'string' ? fields.email : '';
  const username = typeof fields.username === 'string' ? fields.username : '';
  const identifier = typeof fields.identifier === 'string' ? fields.identifier : '';
  const password = typeof fields.password === 'string' ? fields.password : '';
  const result =
    url.pathname === '/auth/register'
      ? await accounts.register(email, username, password)
      : url.pathname === '/auth/login'
        ? await accounts.login(identifier, password)
        : null;
  if (!result) {
    send(response, 404, { error: 'Not found.' });
    return true;
  }
  if (result.ok) setSessionCookie(request, response, result.token);
  send(
    response,
    result.ok ? 200 : result.status,
    result.ok ? { username: result.username } : { error: result.error },
  );
  return true;
}

function setSessionCookie(
  request: IncomingMessage,
  response: ServerResponse,
  token: string | null,
) {
  const secure =
    request.socket instanceof TLSSocket || request.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${cookieName}=${token ? encodeURIComponent(token) : ''}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${token ? cookieMaxAge : 0}`,
  ];
  if (secure) parts.push('Secure');
  response.setHeader('set-cookie', parts.join('; '));
}

function send(response: ServerResponse, status: number, body: unknown) {
  if (body === null) {
    response.writeHead(status);
    response.end();
    return;
  }
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 8_000) return null;
    chunks.push(buffer);
  }
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
  } catch {
    return null;
  }
}
