/** Opt-in, bounded session diagnostics. Never accepts URLs, IDs, content or credentials. */
export type PerfOperation =
  | "drive.metadata"
  | "drive.list"
  | "drive.media"
  | "drive.about"
  | "drive.write"
  | "drive.queue"
  | "api.request"
  | "library.cache"
  | "library.box"
  | "library.load"
  | "search.load"
  | "photo.prepare";
interface Sample {
  operation: PerfOperation;
  durationMs: number;
  status: number;
  retry: number;
  responseBytes: number | null;
  resultCount: number | null;
  cache: "hit" | "miss" | null;
}
export class PerformanceDiagnostics {
  enabled = false;
  private samples: Sample[] = [];
  private epoch = 0;
  clear() {
    this.samples = [];
    this.epoch++;
  }
  start(operation: PerfOperation) {
    const started = performance.now(),
      epoch = this.epoch;
    const enabled = this.enabled;
    return (
      status = 0,
      retry = 0,
      responseBytes: number | null = null,
      resultCount: number | null = null,
      cache: "hit" | "miss" | null = null,
    ) => {
      if (!enabled || !this.enabled || epoch !== this.epoch) return;
      this.samples.push({
        operation,
        durationMs: performance.now() - started,
        status,
        retry,
        responseBytes,
        resultCount,
        cache,
      });
      if (this.samples.length > 1000) this.samples.shift();
    };
  }
  async measure<T>(
    operation: PerfOperation,
    task: () => Promise<T>,
  ): Promise<T> {
    const finish = this.start(operation);
    try {
      const result = await task();
      finish(200);
      return result;
    } catch (error) {
      finish(0);
      throw error;
    }
  }
  summary() {
    return this.samples.map((sample) => ({ ...sample }));
  }
}
export const diagnostics = new PerformanceDiagnostics();
export function driveOperation(target: URL, method: string): PerfOperation {
  if (method !== "GET" && method !== "HEAD") return "drive.write";
  if (target.pathname.endsWith("/about")) return "drive.about";
  if (target.searchParams.get("alt") === "media") return "drive.media";
  return target.pathname.endsWith("/files") ? "drive.list" : "drive.metadata";
}
declare global {
  interface Window {
    boxStoragePerformance?: PerformanceDiagnostics;
  }
}
