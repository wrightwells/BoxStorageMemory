import { GoogleAuthProbe, DriveProbe } from "./google-drive.mjs";
import { claimNumber } from "./concurrency.mjs";

const element = id => document.getElementById(id);
const status = message => { element("status").textContent = message; };
let auth, drive, baseline;

function connect() {
  auth?.clear();
  const oauth = globalThis.google?.accounts?.oauth2;
  if (!oauth) throw new Error("GOOGLE_LIBRARY_NOT_READY");
  if (!element("client").value.endsWith(".apps.googleusercontent.com")) throw new Error("PUBLIC_CLIENT_ID_REQUIRED");
  auth = new GoogleAuthProbe(oauth, element("client").value.trim(), element("scope").value);
  drive = new DriveProbe(auth);
  const clearDrive = auth.onClear;
  auth.onClear = () => { clearDrive(); baseline = null; element("root").value = ""; element("file").value = ""; status("Authorization context cleared."); };
}

function candidate(document, marker) {
  const now = new Date().toISOString();
  if (Array.isArray(document.boxes)) {
    const boxId = crypto.randomUUID();
    const claim = claimNumber({ document }, boxId);
    Object.assign(claim.document.boxes.at(-1), { name: `Probe writer ${marker}`, driveFolderId: `probe_${boxId}`, nfcIds: [] });
    claim.document.updated = now;
    return claim.document;
  }
  document.items[0].notes = `Probe writer ${marker}`;
  document.box.modified = now;
  return document;
}

function action(id, callback) {
  element(id).onclick = async () => {
    try { await callback(); } catch (error) {
      // Only our fixed codes; never Google response bodies, credentials or inventory.
      const code = /^[A-Z_0-9]+$/.test(error.message) ? error.message : "PROBE_FAILED";
      status(code);
    }
  };
}

action("authorize", async () => { connect(); await auth.authorize(); status("Authorized. Token is in memory only."); });
action("renew", async () => { if (!auth) connect(); await auth.authorize(""); status("Renewed. Select the root again; previous runtime data has been cleared."); });
action("signout", async () => { auth?.clear(); status("Signed out locally. Google account cookies and grants are unchanged."); });
action("revoke", async () => { await auth?.revoke(); status("Local context cleared; Google grant revocation requested."); });
action("create", async () => { element("root").value = await drive.createRoot(); status("Disposable probe root created; ID is shown above."); });
action("select", async () => { baseline = null; await drive.selectRoot(element("root").value.trim()); status("Folder is accessible. Existing root inspection is read-only."); });
action("list", async () => {
  const files = await drive.listChildren(element("root").value.trim());
  status(`${files.length} accessible immediate children. Compare this count with Drive; drive.file may omit existing children. Nested discovery must be checked separately.`);
});
action("scratch", async () => {
  const sample = await fetch("../../fixtures/contracts/valid-inventory.json", { cache: "no-store" }).then(r => r.json());
  const root = element("root").value.trim();
  const inventoryId = await drive.createScratch(root, "probe-inventory.json", sample);
  const indexId = await drive.createScratch(root, "probe-index.json", { schemaVersion: 1, updated: new Date().toISOString(), boxes: [] });
  element("file").value = inventoryId;
  status(`Probe files created. Inventory ID: ${inventoryId}\nIndex ID: ${indexId}\nThese are test files, not a managed library.`);
});
action("register", async () => {
  if (!element("confirm").checked) throw new Error("DISPOSABLE_FILE_CONFIRMATION_REQUIRED");
  const id = element("file").value.trim();
  const { data } = await drive.metadata(id);
  if (!["probe-inventory.json", "probe-index.json"].includes(data.name) || data.mimeType !== "application/json" || data.parents?.length !== 1) throw new Error("SCRATCH_FILE_REQUIRED");
  const { data: parent } = await drive.metadata(data.parents[0]);
  if (!parent.name.startsWith("Box Storage Stage 1 Probe ") || parent.mimeType !== "application/vnd.google-apps.folder") throw new Error("SCRATCH_ROOT_REQUIRED");
  drive.scratchFiles.add(id); baseline = null;
  status("Confirmed disposable file registered for experimental writes in this session.");
});
action("baseline", async () => {
  baseline = await drive.snapshot(element("file").value.trim());
  status(`Baseline loaded. Version: ${baseline.version}\nStrong ETag exposed to browser: ${Boolean(baseline.etag && !baseline.etag.startsWith("W/"))}\nNo ETag means writes remain blocked.`);
});
action("write", async () => {
  if (!baseline) throw new Error("BASELINE_REQUIRED");
  await drive.conditionalProbeWrite(baseline, candidate(structuredClone(baseline.document), element("writer").value));
  status("Experimental write accepted. A competing stale write must return DRIVE_HTTP_412. Acceptance alone does not prove safety.");
});
action("race", async () => {
  const result = await drive.race(element("file").value.trim(), candidate);
  status(`Write outcomes: ${result.statuses.join(", ")}\nExactly one accepted and one precondition failure: ${result.conditionalWriteObserved}\nRepeat from independent sessions and inspect the final Drive file before closing the gate.`);
});
