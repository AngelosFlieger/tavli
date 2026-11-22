export type PresentationKind = 'DICE' | 'REMOTE_MOVE';

export type PresentationTicket = {
  id: number;
  kind: PresentationKind;
};

/** Owns visual blocking and makes late presentation completion idempotent. */
export class PresentationCoordinator {
  private sequence = 0;
  private active: PresentationTicket | null = null;

  get blocking(): boolean {
    return this.active !== null;
  }

  get kind(): PresentationKind | null {
    return this.active?.kind ?? null;
  }

  begin(kind: PresentationKind): PresentationTicket {
    const ticket = { id: ++this.sequence, kind };

    this.active = ticket;

    return ticket;
  }

  complete(ticket: PresentationTicket): boolean {
    if (this.active?.id !== ticket.id) return false;

    this.active = null;

    return true;
  }

  cancel(): void {
    this.active = null;
  }
}
