import { expect, it } from "vitest";
import { ThumbnailQueue } from "../src/services/thumbnailQueue";
it("bounds reads, cancels queued work, and drains after a read fails", async () => {
  const queue = new ThumbnailQueue(2);
  const releases: Array<() => void> = [];
  let active = 0,
    maximum = 0,
    calls = 0;
  const read = () =>
    new Promise<number>((resolve) => {
      calls++;
      active++;
      maximum = Math.max(maximum, active);
      releases.push(() => {
        active--;
        resolve(calls);
      });
    });
  const signal = new AbortController();
  const first = queue.run(read, signal.signal);
  const second = queue.run(read, signal.signal);
  const cancelled = new AbortController();
  const third = queue.run(read, cancelled.signal);
  const rejection = expect(third).rejects.toHaveProperty("name", "AbortError");
  cancelled.abort();
  await rejection;
  const fourth = queue.run(read, signal.signal);
  expect(calls).toBe(2);
  releases.shift()!();
  await first;
  await Promise.resolve();
  expect(calls).toBe(3);
  releases.shift()!();
  releases.shift()!();
  await Promise.all([second, fourth]);
  expect(maximum).toBe(2);
  await expect(
    queue.run(() => Promise.reject(new Error("failed")), signal.signal),
  ).rejects.toThrow("failed");
  await expect(
    queue.run(() => Promise.resolve("recovered"), signal.signal),
  ).resolves.toBe("recovered");
});
