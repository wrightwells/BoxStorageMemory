// Disposable integration probe, not the production Drive implementation.
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
export const FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export class GoogleAuthProbe {
  #token = null;
  #expires = 0;
  #generation = 0;
  #pending = null;
  #requests = new Set();

  constructor(oauth, clientId, scope = DRIVE_SCOPE, fetcher = globalThis.fetch, now = Date.now) {
    this.oauth = oauth;
    this.clientId = clientId;
    this.scope = scope;
    this.fetcher = fetcher;
    this.now = now;
  }

  clear() {
    this.#token = null;
    this.#expires = 0;
    this.#generation++;
    for (const controller of this.#requests) controller.abort();
    this.#requests.clear();
    this.#pending?.reject(new Error("AUTH_CONTEXT_CHANGED"));
    this.#pending = null;
    this.onClear?.();
  }

  authorize(prompt = "select_account") {
    this.clear();
    const generation = this.#generation;
    return new Promise((resolve, reject) => {
      this.#pending = { reject };
      const fail = code => {
        if (generation !== this.#generation) return;
        this.#pending = null;
        this.clear();
        reject(new Error(code));
      };
      const client = this.oauth.initTokenClient({
        client_id: this.clientId, scope: this.scope, include_granted_scopes: false,
        callback: response => {
          if (generation !== this.#generation) return;
          if (response.error || !response.access_token || !this.oauth.hasGrantedAllScopes(response, this.scope) || !Number.isFinite(Number(response.expires_in)) || Number(response.expires_in) <= 5) {
            fail("AUTHORIZATION_FAILED"); return;
          }
          this.#token = response.access_token;
          this.#expires = this.now() + Number(response.expires_in) * 1000 - 5000;
          this.#pending = null;
          resolve();
        },
        error_callback: () => fail("AUTHORIZATION_POPUP_FAILED"),
      });
      try { client.requestAccessToken({ prompt }); } catch { fail("AUTHORIZATION_FAILED"); }
    });
  }

  async revoke() {
    const token = this.#token;
    this.clear(); // Local access ends even if the remote revocation fails.
    if (token) await new Promise((resolve, reject) => this.oauth.revoke(token, result => result.successful ? resolve() : reject(new Error("REVOCATION_FAILED"))));
  }

  async request(url, options = {}) {
    const target = new URL(url);
    if (target.origin !== "https://www.googleapis.com" || target.username || target.password || target.hash || !/^\/(?:upload\/)?drive\/v3\//.test(target.pathname)) throw new Error("TOKEN_DESTINATION_REJECTED");
    if (!this.#token || this.now() >= this.#expires) { this.clear(); throw new Error("AUTHORIZATION_REQUIRED"); }
    const generation = this.#generation;
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${this.#token}`);
    const controller = new AbortController();
    this.#requests.add(controller);
    try {
      const response = await this.fetcher(target.href, { ...options, signal: controller.signal, headers, credentials: "omit", redirect: "error", cache: "no-store" });
      if (generation !== this.#generation) throw new Error("AUTH_CONTEXT_CHANGED");
      if (response.status === 401) { this.clear(); throw new Error("AUTHORIZATION_REQUIRED"); }
      if (!response.ok) { const error = new Error(`DRIVE_HTTP_${response.status}`); error.status = response.status; throw error; }
      const data = await response.json();
      if (generation !== this.#generation) throw new Error("AUTH_CONTEXT_CHANGED");
      if (this.now() >= this.#expires) { this.clear(); throw new Error("AUTHORIZATION_REQUIRED"); }
      return { data, etag: response.headers.get("ETag") };
    } finally {
      this.#requests.delete(controller);
    }
  }
}

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const checkedId = id => {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(id)) throw new Error("INVALID_DRIVE_ID");
  return id;
};

export class DriveProbe {
  constructor(auth) {
    this.auth = auth;
    this.scratchFiles = new Set();
    this.createdRoots = new Set();
    auth.onClear = () => { this.scratchFiles.clear(); this.createdRoots.clear(); };
  }

  async metadata(id) {
    return this.auth.request(`${API}/files/${checkedId(id)}?fields=id,name,mimeType,version,parents,capabilities(canEdit)`);
  }

  async selectRoot(id) {
    const { data } = await this.metadata(id);
    if (data.mimeType !== "application/vnd.google-apps.folder") throw new Error("ROOT_NOT_FOLDER");
    return data;
  }

  async listChildren(id) {
    const files = [];
    let pageToken;
    do {
      const query = new URLSearchParams({ q: `'${checkedId(id)}' in parents and trashed = false`, fields: "nextPageToken,files(id,name,mimeType)", pageSize: "100" });
      if (pageToken) query.set("pageToken", pageToken);
      const { data } = await this.auth.request(`${API}/files?${query}`);
      files.push(...data.files);
      pageToken = data.nextPageToken;
    } while (pageToken);
    return files;
  }

  async createRoot() {
    const { data } = await this.auth.request(`${API}/files?fields=id`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Box Storage Stage 1 Probe ${new Date().toISOString()}`, mimeType: "application/vnd.google-apps.folder" }),
    });
    this.createdRoots.add(data.id);
    return data.id;
  }

  async createScratch(rootId, name, document) {
    if (!this.createdRoots.has(rootId)) throw new Error("SCRATCH_ROOT_REQUIRED");
    const boundary = `box_storage_${crypto.randomUUID()}`;
    const metadata = { name, parents: [rootId], mimeType: "application/json" };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(document, null, 2)}\r\n--${boundary}--\r\n`;
    const { data } = await this.auth.request(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
    });
    this.scratchFiles.add(data.id);
    return data.id;
  }

  async snapshot(id) {
    const before = await this.metadata(id);
    const { data } = await this.auth.request(`${API}/files/${checkedId(id)}?alt=media`);
    const after = await this.metadata(id);
    if (before.data.version !== after.data.version) throw new Error("READ_CONFLICT");
    return { fileId: id, document: data, version: after.data.version, etag: after.etag };
  }

  async conditionalProbeWrite(snapshot, document) {
    if (!this.scratchFiles.has(snapshot.fileId)) throw new Error("SCRATCH_FILE_REQUIRED");
    if (!snapshot.etag || snapshot.etag.startsWith("W/")) throw new Error("ATOMIC_WRITE_UNVERIFIED");
    // Experimental probe only: do not assume Drive honours this condition.
    return this.auth.request(`${UPLOAD}/files/${checkedId(snapshot.fileId)}?uploadType=media&fields=id,version`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "If-Match": snapshot.etag }, body: JSON.stringify(document),
    });
  }

  async race(id, mutate) {
    const [a, b] = await Promise.all([this.snapshot(id), this.snapshot(id)]);
    if (a.version !== b.version || a.etag !== b.etag) throw new Error("PROBE_BASELINES_DIFFER");
    const writes = await Promise.allSettled([
      this.conditionalProbeWrite(a, mutate(structuredClone(a.document), "A")),
      this.conditionalProbeWrite(b, mutate(structuredClone(b.document), "B")),
    ]);
    const statuses = writes.map(r => r.status === "fulfilled" ? "accepted" : r.reason.message);
    const final = await this.snapshot(id);
    return {
      statuses,
      conditionalWriteObserved: statuses.filter(s => s === "accepted").length === 1 && statuses.includes("DRIVE_HTTP_412"),
      finalDocument: final.document,
    };
  }
}
