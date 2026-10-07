import { expect, it } from "vitest";
import {
  PerformanceDiagnostics,
  driveOperation,
} from "../src/services/performance";
it("keeps diagnostics opt-in, bounded, detached and scoped to the current session", () => {
  const perf = new PerformanceDiagnostics();
  perf.start("drive.metadata")(200);
  expect(perf.summary()).toEqual([]);
  perf.enabled = true;
  const old = perf.start("drive.metadata");
  perf.clear();
  old(200);
  expect(perf.summary()).toEqual([]);
  for (let i = 0; i < 1200; i++) perf.start("drive.list")(200, 1, 1024, 3);
  expect(perf.summary()).toHaveLength(1000);
  const copy = perf.summary();
  copy[0]!.status = 403;
  expect(perf.summary()[0]!.status).toBe(200);
  expect(JSON.stringify(perf.summary())).not.toContain("Bearer");
  expect(
    driveOperation(
      new URL("https://www.googleapis.com/drive/v3/files/private-id?alt=media"),
      "GET",
    ),
  ).toBe("drive.media");
});
