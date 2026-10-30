/**
 * The spend cap of a run (`--max-cost-usd`). Before a call starts it reserves the most that call
 * can cost (the whole prompt plus a full `max_tokens` of output). A reservation that would take
 * spent + reserved past the cap waits for the calls in flight to settle (their real cost is
 * usually far below their worst case) and is refused only when nothing is in flight any more:
 * then the call could really pass the cap. Once one is refused the guard stays stopped, so a
 * later, smaller call cannot sneak in behind a bigger one that was refused. The cap is a hard
 * stop, not a suggestion.
 */

export interface Reservation {
  readonly id: number;
  readonly amountUsd: number;
}

export class CostGuard {
  private spent: number;
  private reserved = 0;
  private nextId = 1;
  private readonly open = new Map<number, number>();
  private waiters: (() => void)[] = [];
  private stoppedAtUsd: number | null = null;

  constructor(
    readonly capUsd: number,
    alreadySpentUsd = 0,
  ) {
    if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error('the cost cap must be a positive number');
    this.spent = alreadySpentUsd;
  }

  get spentUsd(): number {
    return this.spent;
  }

  /** Spent plus everything still reserved by calls in flight. */
  get committedUsd(): number {
    return this.spent + this.reserved;
  }

  get stopped(): boolean {
    return this.stoppedAtUsd !== null;
  }

  /** What had been spent when the guard stopped the run; null while it is running. */
  get stoppedAt(): number | null {
    return this.stoppedAtUsd;
  }

  /** Reserve `worstCaseUsd` for one call, or null when the call could pass the cap (which stops the guard). */
  async reserve(worstCaseUsd: number): Promise<Reservation | null> {
    for (;;) {
      if (this.stoppedAtUsd !== null) return null;
      if (this.committedUsd + worstCaseUsd <= this.capUsd) {
        const id = this.nextId++;
        this.open.set(id, worstCaseUsd);
        this.reserved += worstCaseUsd;
        return { id, amountUsd: worstCaseUsd };
      }
      if (this.open.size === 0) {
        this.stoppedAtUsd = this.spent;
        this.wake();
        return null;
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  /** Replace a reservation with the call's real (or estimated) cost. */
  settle(reservation: Reservation, actualUsd: number): void {
    const held = this.open.get(reservation.id);
    if (held === undefined) return;
    this.open.delete(reservation.id);
    this.reserved -= held;
    this.spent += actualUsd;
    this.wake();
  }

  private wake(): void {
    const waiting = this.waiters;
    this.waiters = [];
    for (const resolve of waiting) resolve();
  }
}
