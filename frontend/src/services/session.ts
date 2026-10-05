import { ApiClient, type PublicConfig } from "./api";
import {
  checkedId,
  DriveStorageService,
  type DriveAccount,
  type DriveFile,
} from "./drive";
import { ClientError } from "./errors";
import { LibraryService } from "./library";
import { PhotoService } from "./photos";
import { EditingService } from "./editing";
import { NfcService } from "./nfc";
import { SearchService } from "./search";
import {
  GoogleAuthService,
  loadGoogleOAuth,
  type GoogleOAuth,
  type AuthState,
} from "./google";

export interface SessionState {
  auth: AuthState;
  loading: boolean;
  ready: boolean;
  busy: boolean;
  config?: PublicConfig;
  account?: DriveAccount;
  root?: DriveFile;
  error?: string;
  notice?: string;
  revision: number;
}
interface Preferences {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
function preferences(): Preferences | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export class StorageSession {
  readonly drive: DriveStorageService;
  readonly library: LibraryService;
  readonly editing: EditingService;
  readonly photos: PhotoService;
  readonly search: SearchService;
  readonly nfc: NfcService;
  #oauth?: GoogleOAuth;
  #state: SessionState;
  #listeners = new Set<() => void>();
  #initialization?: Promise<void>;
  #operation = 0;
  #disposed = false;
  private readonly unsubscribeAuth: () => void;
  constructor(
    readonly auth = new GoogleAuthService(),
    readonly api = new ApiClient(),
    private readonly loadOAuth = loadGoogleOAuth,
    private readonly prefs: Preferences | undefined = preferences(),
  ) {
    this.drive = new DriveStorageService(auth);
    this.library = new LibraryService(this.drive, () => auth.generation);
    this.search = new SearchService(
      this.drive,
      this.library,
      () => auth.generation,
    );
    this.editing = new EditingService(
      this.drive,
      this.library,
      this.api,
      () => auth.generation,
    );
    this.photos = new PhotoService(
      this.drive,
      this.library,
      this.api,
      () => auth.generation,
      () => this.editing.getSnapshot().dirty,
    );
    this.nfc = new NfcService(
      this.drive,
      this.library,
      this.api,
      () => auth.generation,
      () => this.#state.config?.features.webNfc === true,
      () =>
        this.editing.getSnapshot().dirty ||
        this.editing.getSnapshot().busy ||
        this.photos.getSnapshot().busy,
    );
    this.#state = {
      auth: auth.state,
      loading: true,
      ready: false,
      busy: false,
      revision: 0,
    };
    this.unsubscribeAuth = auth.subscribe(() => {
      if (auth.state.status !== "connected") {
        this.#operation++;
        this.nfc.reset();
        this.photos.reset();
        this.editing.reset();
        this.library.reset();
        this.drive.clear();
        this.update({
          auth: auth.state,
          account: undefined,
          root: undefined,
          busy: false,
          error: auth.state.error,
          notice: undefined,
          revision: this.#state.revision + 1,
        });
      } else this.update({ auth: auth.state });
    });
  }
  getSnapshot = (): SessionState => this.#state;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  private update(patch: Partial<SessionState>) {
    if (this.#disposed) return;
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }
  initialize(): Promise<void> {
    if (this.#initialization) return this.#initialization;
    this.#initialization = (async () => {
      this.update({ loading: true, error: undefined });
      try {
        const config = await this.api.config();
        this.update({ config });
        if (!config.googleWebClientId)
          throw new ClientError("GOOGLE_NOT_CONFIGURED");
        this.#oauth = await this.loadOAuth();
        this.update({ ready: true });
      } catch (error) {
        this.update({
          error:
            error instanceof ClientError ? error.code : "GOOGLE_SCRIPT_FAILED",
          ready: false,
        });
      } finally {
        this.update({ loading: false });
      }
    })();
    return this.#initialization;
  }
  retryInitialization(): Promise<void> {
    this.#initialization = undefined;
    return this.initialize();
  }
  connect(): Promise<void> {
    if (!this.#oauth || !this.#state.config || !this.#state.ready)
      return Promise.resolve();
    // Clears the previous account before opening the chooser, including during renewal.
    const result = this.auth.authorize(
      this.#oauth,
      this.#state.config.googleWebClientId,
    );
    const operation = this.#operation;
    this.update({ busy: true, error: undefined });
    return (async () => {
      try {
        await result;
        if (operation !== this.#operation) return;
        const account = await this.drive.account();
        if (operation !== this.#operation) return;
        this.update({ account });
        let saved: string | null = null;
        try {
          saved =
            this.prefs?.getItem(
              `box-storage:root:${encodeURIComponent(account.id)}`,
            ) ?? null;
        } catch {
          /* Preferences are optional. */
        }
        if (saved) {
          try {
            checkedId(saved);
            const root = await this.drive.selectRoot(saved);
            if (operation === this.#operation) this.update({ root });
          } catch (error) {
            if (operation === this.#operation) this.report(error);
          }
        }
      } catch (error) {
        if (operation !== this.#operation) return;
        this.auth.clear(
          "error",
          error instanceof ClientError ? error.code : "AUTH_FAILED",
        );
      } finally {
        if (operation === this.#operation) this.update({ busy: false });
      }
    })();
  }
  report(error: unknown) {
    this.update({
      error: error instanceof ClientError ? error.code : "UNAVAILABLE",
    });
  }
  signOut() {
    this.auth.clear();
  }
  async revoke() {
    if (!this.#oauth) {
      this.signOut();
      return;
    }
    const result = this.auth.revoke(this.#oauth);
    const operation = this.#operation;
    try {
      await result;
    } catch (error) {
      if (operation === this.#operation) this.report(error);
    }
  }
  changeRoot() {
    this.#operation++;
    this.auth.cancelRequests();
    this.nfc.reset();
    this.photos.reset();
    this.editing.reset();
    this.library.reset();
    this.drive.clear();
    this.update({
      root: undefined,
      busy: false,
      error: undefined,
      notice: undefined,
      revision: this.#state.revision + 1,
    });
  }
  async selectRoot(id: string) {
    const account = this.#state.account;
    if (!account) {
      this.report(new ClientError("AUTH_REQUIRED"));
      return;
    }
    this.changeRoot();
    const operation = this.#operation;
    this.update({ busy: true });
    try {
      const root = await this.drive.selectRoot(id);
      if (operation !== this.#operation) return;
      this.update({ root });
      try {
        this.prefs?.setItem(
          `box-storage:root:${encodeURIComponent(account.id)}`,
          root.id,
        );
      } catch {
        /* Never block Drive use on storage permissions. */
      }
    } catch (error) {
      if (operation === this.#operation) this.report(error);
    } finally {
      if (operation === this.#operation) this.update({ busy: false });
    }
  }
  async createRoot(name: string) {
    if (!this.#state.account) {
      this.report(new ClientError("AUTH_REQUIRED"));
      return;
    }
    this.changeRoot();
    const operation = this.#operation;
    this.update({ busy: true });
    try {
      const root = await this.drive.createRoot(name);
      if (operation !== this.#operation) return;
      const selection = this.selectRoot(root.id);
      const selectionOperation = this.#operation;
      await selection;
      if (selectionOperation === this.#operation)
        this.update({
          notice: this.#state.root
            ? `Created ${root.name} in My Drive.`
            : `Created ${root.name} in My Drive, but could not connect to it. Select it from the folder list instead of creating it again.`,
        });
    } catch (error) {
      if (operation === this.#operation) this.report(error);
    } finally {
      if (operation === this.#operation) this.update({ busy: false });
    }
  }
  dispose() {
    this.signOut();
    this.search.dispose();
    this.#disposed = true;
    this.unsubscribeAuth();
    this.#listeners.clear();
  }
}
