import type { ClientPacket, ServerMessage, Update } from './messages';
import type { GameState, Player } from '../game/engine';

export type TableEvents = {
  onWaiting: () => void;
  onMatched: (you: Player, state: GameState) => void;
  onUpdate: (update: Update) => void;
  onLeft: () => void;
  onClose: () => void;
};

export function connectTable(events: TableEvents) {
  let current: WebSocket | null = null;
  const queued: string[] = [];

  function url() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/ws`;
  }

  function open() {
    if (current && current.readyState <= WebSocket.OPEN) return;
    const socket = new WebSocket(url());
    current = socket;
    socket.onopen = () => {
      if (socket !== current) return;
      for (const packet of queued) socket.send(packet);
      queued.length = 0;
    };
    socket.onmessage = (event) => {
      if (socket !== current) return;
      const message = parse(event.data);
      if (!message) return;
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
      if (socket !== current) return;
      current = null;
      queued.length = 0;
      events.onClose();
    };
  }

  function send(message: ClientPacket) {
    const packet = JSON.stringify(message);
    if (current?.readyState === WebSocket.OPEN) current.send(packet);
    else {
      queued.push(packet);
      open();
    }
  }

  return {
    find: () => send({ type: 'find' }),
    cancel: () => send({ type: 'cancel' }),
    send,
  };
}

function parse(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null;
  try {
    const message = JSON.parse(data) as ServerMessage;
    if (
      message &&
      (message.type === 'waiting' ||
        message.type === 'matched' ||
        message.type === 'update' ||
        message.type === 'left')
    )
      return message;
  } catch {
    return null;
  }
  return null;
}
