import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { fixtureLibrary, BOX, SECOND } from "./library-fixtures";
import { GoogleAuthService, type GoogleOAuth } from "../src/services/google";
import { DriveStorageService } from "../src/services/drive";
import { LibraryService } from "../src/services/library";
import { SearchService, matchSearch } from "../src/services/search";
import { diagnostics } from "../src/services/performance";

it.skipIf(!process.env.BSM_PERF_OUTPUT)(
  "measures real read services against a fixed 20ms Drive transport",
  async () => {
    const results: unknown[] = [];
    for (let sample = 0; sample < 5; sample++) {
      const fixture = fixtureLibrary();
      let requests = 0,
        bytes = 0;
      const fetcher: typeof fetch = async (input) => {
        requests++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        const url = new URL(String(input)),
          id = url.pathname.split("/").pop()!;
        let body: unknown;
        if (id === "files") {
          const parent = url.searchParams
            .get("q")!
            .match(/'([^']+)' in parents/)![1];
          body = {
            files: [...fixture.files.values()].filter((file) =>
              file.parents?.includes(parent!),
            ),
          };
        } else if (url.searchParams.get("alt") === "media")
          body = fixture.documents.get(id);
        else body = fixture.files.get(id);
        const encoded = JSON.stringify(body),
          length = new TextEncoder().encode(encoded).length;
        bytes += length;
        return new Response(encoded, {
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(length),
          },
        });
      };
      const auth = new GoogleAuthService(fetcher);
      const oauth: GoogleOAuth = {
        initTokenClient: (config) => ({
          requestAccessToken: () =>
            config.callback({ access_token: "synthetic", expires_in: 3600 }),
        }),
        hasGrantedAllScopes: () => true,
        revoke: (_token, done) => done({ successful: true }),
      };
      await auth.authorize(oauth, "synthetic-client");
      const drive = new DriveStorageService(auth);
      await drive.selectRoot("library");
      const library = new LibraryService(drive, () => auth.generation);
      const search = new SearchService(drive, library, () => auth.generation);
      diagnostics.enabled = true;
      const measure = async (
        operation: string,
        task: () => Promise<unknown>,
      ) => {
        diagnostics.clear();
        const start = performance.now(),
          count = requests,
          size = bytes;
        await task();
        results.push({
          sample,
          operation,
          elapsedMs: performance.now() - start,
          driveCalls: requests - count,
          responseBytes: bytes - size,
          transport: diagnostics.summary(),
        });
      };
      await measure("freshLibrary", () => library.load());
      await measure("freshNestedBox", () => library.box(BOX));
      await measure("cachedBox", () => library.box(BOX));
      await measure("searchAfterViewedBox", () => search.load());
      await measure("warmSearchQuery", async () => {
        expect(
          matchSearch(search.getSnapshot().records, "extension"),
        ).toHaveLength(1);
      });
      library.reset();
      await library.load();
      await measure("concurrentSameBox", () =>
        Promise.all([library.box(SECOND), library.box(SECOND)]),
      );
      await measure("refreshOneBox", () => library.box(BOX, true));
      search.dispose();
      library.reset();
      drive.clear();
      auth.clear();
    }
    diagnostics.enabled = false;
    writeFileSync(
      process.env.BSM_PERF_OUTPUT!,
      JSON.stringify(
        {
          model:
            "synthetic 20ms per HTTP request; nested 2-box fixture; actual application services",
          results,
        },
        null,
        2,
      ),
    );
  },
  30000,
);
