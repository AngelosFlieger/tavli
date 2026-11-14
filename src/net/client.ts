import { socketUrl } from './account';
import type { ClientPacket, ServerMessage, Update } from './messages';
import type { GameState, Player } from '../game/engine';

export type TableEvents = {
  onReady: (name: string) => void;
  onResume: (you: Player, state: GameState, canUndo: boolean) => void;
  onRejected: () => void;
  onReconnect: () => void;
  onWaiting: () => void;
  onMatched: (you: Player, state: GameState) => void;
  onUpdate: (update: Update) => void;
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
      flush();
    };
    socket.onmessage = (event) => {
      if (socket !== currentSocket) return;
      const message = parse(event.data);
      if (!message) return;
      if (message.type === 'rejected') {
        intentional = true;
        events.onRejected();
        socket.close();
        return;
      }
      if (message.type === 'ready') {
        authed = true;
        retry = 0;
        flush();
        events.onReady(message.name);
        return;
      }
      if (message.type === 'resume' && (message.you === 0 || message.you === 1) && message.state) {
        authed = true;
        retry = 0;
        queued.length = 0;
        events.onResume(message.you, message.state, message.canUndo === true);
        return;
      }
      if (message.type === 'waiting') events.onWaiting();
      else if (
        message.type === 'matched' &&
        (message.you === 0 || message.you === 1) &&
        message.state
      )
        events.onMatched(message.you, message.state);
      else if (message.type === 'update' && message.state) events.onUpdate(message);
      else if (message.type === 'left') events.onLeft();
    };
    socket.onclose = () => {
      if (socket !== currentSocket) return;
      currentSocket = null;
      authed = false;
      queued.length = 0;
      if (intentional) return;
      const delay = retryDelays[retry++];
      if (delay === undefined) {
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
    find: () => send({ type: 'find' }),
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

function parse(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null;
  try {
    const message = JSON.parse(data) as ServerMessage;
    if (
      message &&
      (message.type === 'ready' ||
        message.type === 'rejected' ||
        message.type === 'waiting' ||
        message.type === 'matched' ||
        message.type === 'resume' ||
        message.type === 'update' ||
        message.type === 'left')
    )
      return message;
  } catch {
    return null;
  }
  return null;
}
