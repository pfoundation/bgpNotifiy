/** Simple TTL cache for storing IXP Manager data in memory */
export class TtlCache<T> {
  private data: T | null = null;
  private expiresAt: number = 0;
  private ttlMs: number;

  constructor(ttlMinutes: number) {
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  get(): T | null {
    if (this.data === null || Date.now() > this.expiresAt) {
      return null;
    }
    return this.data;
  }

  set(data: T): void {
    this.data = data;
    this.expiresAt = Date.now() + this.ttlMs;
  }

  invalidate(): void {
    this.data = null;
    this.expiresAt = 0;
  }
}
