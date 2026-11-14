export function sameOrigin() {
  return location.protocol === 'http:' || location.protocol === 'https:';
}

export function socketUrl() {
  if (!sameOrigin()) return null;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

export async function whoami() {
  if (!sameOrigin()) return null;
  try {
    const response = await fetch('/auth/me');
    if (!response.ok) return null;
    const body = (await response.json()) as { username?: string };
    if (!body.username) return null;
    return { username: body.username };
  } catch {
    return null;
  }
}

export function register(email: string, username: string, password: string) {
  return submit('/auth/register', { email, username, password });
}

export function login(identifier: string, password: string) {
  return submit('/auth/login', { identifier, password });
}

export async function logout() {
  if (!sameOrigin()) return;
  await fetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
}

async function submit(path: string, body: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false as const, error: 'Can’t reach the game server.' };
  }
  const payload = (await response.json().catch(() => null)) as {
    username?: string;
    error?: string;
  } | null;
  if (!response.ok || !payload?.username)
    return { ok: false as const, error: payload?.error || 'The account could not be saved.' };
  return { ok: true as const, username: payload.username };
}
