import assert from "node:assert/strict";
import { test } from "node:test";
import { ConditionalStore, claimNumber } from "./concurrency.mjs";
import { GoogleAuthProbe, DriveProbe, DRIVE_SCOPE } from "./google-drive.mjs";

function setup(fetcher = async () => new Response('{"files": []}')) {
  const clients = [];
  const oauth = {
    initTokenClient(config) { clients.push(config); return { requestAccessToken() {} }; },
    hasGrantedAllScopes(response, scope) { return response.scope === scope; },
    revoke(_token, callback) { callback({ successful: true }); },
  };
  let now = 0;
  const auth = new GoogleAuthProbe(oauth, "public-client-id", DRIVE_SCOPE, fetcher, () => now);
  const grant = config => config.callback({ access_token: "test-token", expires_in: 3600, scope: DRIVE_SCOPE });
  return { auth, clients, grant, setNow: value => { now = value; } };
}

test("version checking without an atomic write loses an update", () => {
  const store = new ConditionalStore({ value: "initial" });
  const a = store.read(), b = store.read();
  assert.equal(a.version, b.version); // Both clients pass a read-before-write check.
  store.document = { value: "A" };
  store.document = { value: "B" };
  assert.equal(store.document.value, "B");
});

test("conditional writes reject stale inventory and index changes", () => {
  for (const document of [{ items: [] }, { boxes: [] }]) {
    const store = new ConditionalStore(document);
    const a = store.read(), b = store.read();
    store.write(a.version, { ...a.document, writer: "A" });
    assert.throws(() => store.write(b.version, { ...b.document, writer: "B" }), /CONFLICT/);
    assert.equal(store.read().document.writer, "A");
  }
});

test("simultaneous number claims require conflict and fresh allocation", () => {
  const store = new ConditionalStore({ boxes: [] });
  const a = store.read(), b = store.read();
  const first = claimNumber(a, "box-a"), second = claimNumber(b, "box-b");
  assert.equal(first.boxNumber, second.boxNumber);
  store.write(a.version, first.document);
  assert.throws(() => store.write(b.version, second.document), /CONFLICT/);
  const fresh = store.read(), retry = claimNumber(fresh, "box-b");
  store.write(fresh.version, retry.document);
  assert.deepEqual(store.document.boxes.map(b => b.boxNumber), ["BOX-0001", "BOX-0002"]);
});

test("bearer tokens are sent only to the direct Google Drive origin", async () => {
  const seen = [];
  const { auth, clients, grant } = setup(async (url, options) => {
    seen.push({ url, options }); return new Response('{"files": []}');
  });
  const pending = auth.authorize(); grant(clients[0]); await pending;
  await auth.request("https://www.googleapis.com/drive/v3/files");
  assert.equal(seen[0].options.headers.get("Authorization"), "Bearer test-token");
  assert.equal(seen[0].options.redirect, "error");
  for (const url of ["https://boxes.example.com/api/v1/config", "https://www.googleapis.com.evil.example/drive/v3/files", "https://www.googleapis.com/calendar/v3/events"]) {
    await assert.rejects(auth.request(url), /TOKEN_DESTINATION_REJECTED/);
  }
  assert.equal(seen.length, 1);
});

test("sign-out invalidates late authorization callbacks", async () => {
  const { auth, clients, grant } = setup();
  const pending = auth.authorize();
  const rejected = assert.rejects(pending, /AUTH_CONTEXT_CHANGED/);
  auth.clear(); grant(clients[0]); await rejected;
  await assert.rejects(auth.request("https://www.googleapis.com/drive/v3/files"), /AUTHORIZATION_REQUIRED/);
});

test("account switching rejects old requests even when their network response arrives", async () => {
  let deliver;
  const { auth, clients, grant } = setup(() => new Promise(resolve => { deliver = resolve; }));
  const pending = auth.authorize(); grant(clients[0]); await pending;
  const request = auth.request("https://www.googleapis.com/drive/v3/files");
  auth.clear(); deliver(new Response('{"files": []}'));
  await assert.rejects(request, /AUTH_CONTEXT_CHANGED/);
});

test("expiry and denied scopes prevent Drive access", async () => {
  const { auth, clients, grant, setNow } = setup();
  const first = auth.authorize(); grant(clients[0]); await first;
  setNow(3600000);
  await assert.rejects(auth.request("https://www.googleapis.com/drive/v3/files"), /AUTHORIZATION_REQUIRED/);
  const second = auth.authorize();
  clients[1].callback({ access_token: "test", expires_in: 3600, scope: "wrong" });
  await assert.rejects(second, /AUTHORIZATION_FAILED/);
});

test("Drive 401 clears authorization and scratch write permissions", async () => {
  const { auth, clients, grant } = setup(async () => new Response('{}', { status: 401 }));
  const drive = new DriveProbe(auth); const pending = auth.authorize(); grant(clients[0]); await pending;
  drive.scratchFiles.add("scratch");
  await assert.rejects(auth.request("https://www.googleapis.com/drive/v3/files"), /AUTHORIZATION_REQUIRED/);
  assert.equal(drive.scratchFiles.size, 0);
});

test("probe fails closed for ordinary files and missing/weak ETags", async () => {
  const { auth } = setup(); const drive = new DriveProbe(auth);
  await assert.rejects(drive.conditionalProbeWrite({ fileId: "ordinary", etag: '"1"' }, {}), /SCRATCH_FILE_REQUIRED/);
  drive.scratchFiles.add("scratch");
  for (const etag of [null, 'W/"1"']) {
    await assert.rejects(drive.conditionalProbeWrite({ fileId: "scratch", etag }, {}), /ATOMIC_WRITE_UNVERIFIED/);
  }
  await assert.rejects(drive.createScratch("ordinary-root", "inventory.json", {}), /SCRATCH_ROOT_REQUIRED/);
});

test("live-probe transport sends If-Match and reports a simulated stale writer", async () => {
  const store = new ConditionalStore({ items: [], writer: "initial" });
  const { auth, clients, grant } = setup(async (url, options) => {
    if (options.method === "PATCH") {
      assert.ok(options.headers.get("If-Match"));
      if (options.headers.get("If-Match") !== `"${store.version}"`) return new Response('{}', { status: 412 });
      store.write(store.version, JSON.parse(options.body));
      return new Response(JSON.stringify({ id: "scratch", version: String(store.version) }));
    }
    if (new URL(url).searchParams.get("alt") === "media") return new Response(JSON.stringify(store.document));
    return new Response(JSON.stringify({ id: "scratch", version: String(store.version) }), { headers: { ETag: `"${store.version}"` } });
  });
  const drive = new DriveProbe(auth);
  const pending = auth.authorize(); grant(clients[0]); await pending;
  drive.scratchFiles.add("scratch");
  const result = await drive.race("scratch", (document, writer) => ({ ...document, writer }));
  assert.deepEqual(result.statuses, ["accepted", "DRIVE_HTTP_412"]);
  assert.equal(result.conditionalWriteObserved, true);
  assert.equal(result.finalDocument.writer, "A");
});

test("sign-out aborts pending transport and popup failures end authorization", async () => {
  let signal;
  const { auth, clients, grant } = setup(async (_url, options) => {
    signal = options.signal;
    return new Response('{}');
  });
  const first = auth.authorize(); grant(clients[0]); await first;
  const request = auth.request("https://www.googleapis.com/drive/v3/files");
  auth.clear();
  assert.equal(signal.aborted, true);
  await assert.rejects(request, /AUTH_CONTEXT_CHANGED/);
  const popup = auth.authorize(); clients[1].error_callback({ type: "popup_closed" });
  await assert.rejects(popup, /AUTHORIZATION_POPUP_FAILED/);
});
