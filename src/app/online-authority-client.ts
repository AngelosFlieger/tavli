import type { Player } from '../game/rules/position';
import type { Command, CommandRequest } from '../net/messages';

export interface OnlineAuthorityPort {
  readonly connected: boolean;
  readonly seat: Player | null;
  readonly pendingCommandId: string | null;
  join(you: Player, send: (request: CommandRequest) => void): void;
  leave(): void;
  send(command: Command): void;
  sendUntracked(command: Command): void;
  acknowledge(): void;
}

/** Owns the client-side identity and transport state for online command intentions. */
export class OnlineAuthorityClient implements OnlineAuthorityPort {
  private connection: { you: Player; send: (request: CommandRequest) => void } | null = null;
  private sequence = 0;
  private pending: string | null = null;

  get connected(): boolean {
    return this.connection !== null;
  }

  get seat(): Player | null {
    return this.connection?.you ?? null;
  }

  get pendingCommandId(): string | null {
    return this.pending;
  }

  join(you: Player, send: (request: CommandRequest) => void): void {
    this.connection = { you, send };
    this.pending = null;
  }

  leave(): void {
    this.connection = null;
    this.pending = null;
  }

  send(command: Command): void {
    const connection = this.requireConnection();
    const request = this.request(command);

    this.pending = request.commandId;
    connection.send(request);
  }

  sendUntracked(command: Command): void {
    const connection = this.requireConnection();

    connection.send(this.request(command));
  }

  acknowledge(): void {
    this.pending = null;
  }

  private request(command: Command): CommandRequest {
    return { commandId: `command-${++this.sequence}`, command };
  }

  private requireConnection() {
    if (!this.connection)
      throw new Error('online command requested without an authority connection');

    return this.connection;
  }
}
