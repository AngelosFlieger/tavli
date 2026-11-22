import { socketUrl } from './account';
import {
  CLASSIC_SELECTION,
  isAuthorityCursor,
  isNetworkGameState,
  isRevisionedUpdate,
  PROTOCOL_VERSION,
  type AuthorityCursor,
  type ClientErrorCode,
  type ClientPacket,
  type MatchSelection,
  type ServerMessage,
  type RevisionedUpdate,
} from './messages';
import type { GameState, Player } from '../game/engine';
import type { ResolvedVariantConfig } from '../game/variant/types';
import { resolveVariantConfig } from '../game/variant/config/schema';

export type TableEvents = {
  onReady: (name: string) => void;
  onResume: (
    you: Player,
    players: [string, string],
    state: GameState,
    canUndo: boolean,
    variantConfig: ResolvedVariantConfig | null,
    cursor: AuthorityCursor,
    presentations?: RevisionedUpdate['presentations'],
    events?: RevisionedUpdate['events'],
  ) => void;
  onRejected: () => void;
  onReconnect: () => void;
  onWaiting: () => void;
  onRoom: (code: string) => void;
  onMatched: (
    you: Player,
    players: [string, string],
    state: GameState,
    variantConfig: ResolvedVariantConfig | null,
    cursor: AuthorityCursor,
    presentations?: RevisionedUpdate['presentations'],
    events?: RevisionedUpdate['events'],
  ) => void;
  onUpdate: (update: RevisionedUpdate) => void;
  onError: (code: ClientErrorCode) => void;
  onRematch: (status: 'OFFERED' | 'DECLINED') => void;
  onLeft: () => void;
  onClose: () => void;
};

const retryDelays = [1000, 2000, 3000, 5000, 8000];

export function connectTable(events: TableEvents) {
  let currentSocket: WebSocket | null = null;
  let intentional = false;
  let authed = false;
  let retry = 0;
  let retryTimer = 0;
  const queued: string[] = [];

  function open() {
    if (currentSocket && currentSocket.readyState <= WebSocket.OPEN) return;

    const address = socketUrl();

    if (!address) {
      events.onRejected();

      return;
    }

    intentional = false;

    const socket = new WebSocket(address);

    currentSocket = socket;
    socket.onopen = () => {
      if (socket !== currentSocket) return;

      socket.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION }));
    };
    socket.onmessage = (event) => {
      if (socket !== currentSocket) return;

      const message = decodeServerMessage(event.data);

      if (!message) return;
      switch (message.type) {
        case 'rejected':
          intentional = true;
          queued.length = 0;
          events.onRejected();
          socket.close();

          return;
        case 'error':
          events.onError(message.code);

          return;
        case 'ready':
          if (message.protocol !== PROTOCOL_VERSION) {
            intentional = true;
            events.onError('PROTOCOL');
            socket.close();

            return;
          }

          authed = true;
          retry = 0;
          flush();
          events.onReady(message.name);

          return;
        case 'resume':
          authed = true;
          retry = 0;
          queued.length = 0;
          events.onResume(
            message.you,
            message.players,
            message.state,
            message.canUndo,
            message.variantConfig,
            { matchId: message.matchId, revision: message.revision },
            message.presentations,
            message.events,
          );

          return;
        case 'waiting':
          authed = true;
          retry = 0;
          flush();
          events.onWaiting();

          return;
        case 'room':
          events.onRoom(message.code);

          return;
        case 'matched':
          events.onMatched(
            message.you,
            message.players,
            message.state,
            message.variantConfig,
            { matchId: message.matchId, revision: message.revision },
            message.presentations,
            message.events,
          );

          return;
        case 'update':
          events.onUpdate(message);

          return;
        case 'rematch':
          events.onRematch(message.status);

          return;
        case 'left':
          events.onLeft();
      }
    };
    socket.onerror = () => {
      if (socket === currentSocket) events.onError('INTERNAL');
    };
    socket.onclose = () => {
      if (socket !== currentSocket) return;

      currentSocket = null;
      authed = false;

      if (intentional) return;

      const delay = retryDelays[retry++];

      if (delay === undefined) {
        queued.length = 0;
        events.onClose();

        return;
      }

      events.onReconnect();
      retryTimer = window.setTimeout(open, delay);
    };
  }

  function flush() {
    if (!authed || currentSocket?.readyState !== WebSocket.OPEN) return;
    for (const packet of queued) currentSocket.send(packet);

    queued.length = 0;
  }

  function send(message: ClientPacket) {
    const packet = JSON.stringify(message);

    if (authed && currentSocket?.readyState === WebSocket.OPEN) currentSocket.send(packet);
    else {
      queued.push(packet);
      open();
    }
  }

  return {
    connect: open,
    find: (selection: MatchSelection = CLASSIC_SELECTION) => send({ type: 'find', selection }),
    createRoom: (selection: MatchSelection = CLASSIC_SELECTION) =>
      send({ type: 'createRoom', selection }),
    joinRoom: (code: string) => send({ type: 'joinRoom', code }),
    cancel: () => send({ type: 'cancel' }),
    send,
    abandon() {
      intentional = true;
      window.clearTimeout(retryTimer);
      retry = 0;

      if (currentSocket?.readyState === WebSocket.OPEN)
        currentSocket.send(JSON.stringify({ type: 'cancel' }));

      currentSocket?.close();
      currentSocket = null;
      authed = false;
      queued.length = 0;
    },
  };
}

function isPlayerNames(value: unknown): value is [string, string] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((name) => typeof name === 'string' && name.length > 0 && name.length <= 20)
  );
}

function isInitialPresentationValid(
  message: Extract<ServerMessage, { type: 'matched' | 'resume' }>,
  canUndo: boolean,
) {
  return isRevisionedUpdate({
    matchId: message.matchId,
    revision: message.revision,
    state: message.state,
    canUndo,
    presentations: message.presentations ?? [],
    events: message.events,
  });
}

function isVariantConfigValid(
  state: GameState,
  value: unknown,
): value is ResolvedVariantConfig | null {
  if (state.ruleset === 'CLASSIC') return value === null;
  try {
    return resolveVariantConfig(value).hash === state.variantConfigHash;
  } catch {
    return false;
  }
}

const clientErrorCodes: readonly ClientErrorCode[] = [
  'PROTOCOL',
  'AUTH',
  'NOT_FOUND',
  'NOT_YOUR_TURN',
  'MATCH_ENDED',
  'MATCH_NOT_FINISHED',
  'WAITING_FOR_OPPONENT',
  'INVALID_COMMAND',
  'ROOM_NOT_FOUND',
  'ROOM_OWNED',
  'ROOM_CLOSED',
  'INTERNAL',
];

function isClientErrorCode(value: unknown): value is ClientErrorCode {
  return typeof value === 'string' && clientErrorCodes.includes(value as ClientErrorCode);
}

export function decodeServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(data);

    if (!parsed || typeof parsed !== 'object') return null;

    const message = parsed as Record<string, unknown>;

    switch (message.type) {
      case 'ready':
        return Number.isSafeInteger(message.protocol) &&
          typeof message.name === 'string' &&
          message.name.length > 0 &&
          message.name.length <= 20
          ? { type: 'ready', protocol: Number(message.protocol), name: message.name }
          : null;
      case 'rejected':
        return message.reason === undefined ||
          message.reason === 'AUTH' ||
          message.reason === 'PROTOCOL'
          ? { type: 'rejected', ...(message.reason ? { reason: message.reason } : {}) }
          : null;
      case 'error':
        return isClientErrorCode(message.code) ? { type: 'error', code: message.code } : null;
      case 'waiting':
        return { type: 'waiting' };
      case 'room':
        return typeof message.code === 'string' && /^[A-F0-9]{6}$/.test(message.code)
          ? { type: 'room', code: message.code }
          : null;
      case 'matched':
        return decodeInitialMessage(message, false);
      case 'resume':
        return typeof message.canUndo === 'boolean'
          ? decodeInitialMessage(message, message.canUndo)
          : null;
      case 'update':
        return isRevisionedUpdate(message)
          ? {
              type: 'update',
              matchId: message.matchId,
              revision: message.revision,
              state: message.state,
              canUndo: message.canUndo,
              presentations: message.presentations,
              ...(message.events ? { events: message.events } : {}),
              ...(message.commandResult ? { commandResult: message.commandResult } : {}),
            }
          : null;
      case 'rematch':
        return message.status === 'OFFERED' || message.status === 'DECLINED'
          ? { type: 'rematch', status: message.status }
          : null;
      case 'left':
        return { type: 'left' };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function decodeInitialMessage(
  message: Record<string, unknown>,
  canUndo: boolean,
): Extract<ServerMessage, { type: 'matched' | 'resume' }> | null {
  if (
    (message.you !== 0 && message.you !== 1) ||
    !isPlayerNames(message.players) ||
    !isNetworkGameState(message.state) ||
    !isVariantConfigValid(message.state, message.variantConfig) ||
    !isAuthorityCursor(message)
  )
    return null;

  const validated = message as Record<string, unknown> & AuthorityCursor;
  const candidate = {
    type: validated.type,
    you: validated.you,
    players: validated.players,
    state: validated.state,
    canUndo,
    variantConfig: validated.variantConfig,
    matchId: validated.matchId,
    revision: validated.revision,
    presentations: validated.presentations,
    events: validated.events,
  } as Extract<ServerMessage, { type: 'matched' | 'resume' }>;

  if (!isInitialPresentationValid(candidate, canUndo)) return null;

  const common = {
    you: candidate.you,
    players: candidate.players,
    state: candidate.state,
    variantConfig: candidate.variantConfig,
    matchId: candidate.matchId,
    revision: candidate.revision,
    ...(candidate.presentations ? { presentations: candidate.presentations } : {}),
    ...(candidate.events ? { events: candidate.events } : {}),
  };

  return validated.type === 'resume'
    ? { type: 'resume', ...common, canUndo }
    : { type: 'matched', ...common };
}
