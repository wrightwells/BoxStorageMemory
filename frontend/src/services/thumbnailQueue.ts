/** Limits thumbnail reads. Abort removes queued jobs; owners release late results. */
export class ThumbnailQueue {
  private active = 0;
  private pending: Array<() => void> = [];
  constructor(private readonly limit = 3) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new RangeError("Invalid thumbnail concurrency");
  }
  run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = this.pending.indexOf(start);
        if (index >= 0) this.pending.splice(index, 1);
        reject(new DOMException("Cancelled", "AbortError"));
      };
      const start = () => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) {
          reject(new DOMException("Cancelled", "AbortError"));
          return;
        }
        this.active++;
        void task()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.drain();
          });
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      this.pending.push(start);
      this.drain();
    });
  }
  private drain() {
    while (this.active < this.limit && this.pending.length)
      this.pending.shift()!();
  }
}
