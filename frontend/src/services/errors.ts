export class ClientError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ClientError";
  }
}

export function errorMessage(error: unknown): string {
  const code = error instanceof ClientError ? error.code : "UNAVAILABLE";
  const messages: Record<string, string> = {
    INVALID_QR_URL:
      "This QR code is not a valid box label for this deployment. Use browsing or box-number lookup.",
    NFC_UNAVAILABLE:
      "Web NFC could not start. Check permissions and hardware, or use QR/search/box-number lookup.",
    NFC_UNREADABLE:
      "This NFC tag could not be read. Try a compatible tag or use another lookup method.",
    INVALID_NFC_ID:
      "This tag has no usable hexadecimal identifier. Tag payloads are not used as box identity.",
    NFC_NOT_ASSIGNED:
      "This tag is no longer assigned to the selected box. Read it again to review the current mapping.",
    NFC_MOVE_CONFIRMATION_REQUIRED:
      "Confirm removing this tag from its current box before assigning it here.",
    IMAGE_TOO_LARGE:
      "Choose an image up to 25 MiB and 40 million pixels, with each dimension at most 16384 pixels.",
    IMAGE_ENCODING_FAILED:
      "This browser could not create the JPEG photograph. Try another image or browser.",
    CAMERA_UNAVAILABLE:
      "Camera access is unavailable or was denied. You can choose a photograph from your device instead.",
    TOO_MANY_PHOTOS: "Select up to 20 photographs at a time.",
    PHOTO_SELECTION_REQUIRED:
      "Select photos before uploading; replacement requires exactly one new photo.",
    PHOTO_EDITOR_DIRTY:
      "Save or discard your box draft before changing photographs.",
    EDIT_BUSY: "Another editor action is still running. Wait for it to finish.",
    EDIT_LOCKED:
      "Review the operation result and reload current records before editing again.",
    IMMUTABLE_IDENTITY:
      "Box numbers, UUIDs, creation times, NFC assignments and photo references cannot be changed by this editor.",
    DELETE_CONFIRMATION_REQUIRED:
      "Confirm item removal and review its photo consequences first.",
    NUMBER_EXHAUSTED:
      "This library has reached the supported box-number limit.",
    PENDING_CREATION:
      "An incomplete Drive operation was found. Review its pending records before saving, creating or rebuilding.",
    ATOMIC_WRITE_UNVERIFIED:
      "A required atomic Drive mutation has not been verified. No unconditional replacement is allowed.",
    API_UNAVAILABLE:
      "The application service is unavailable. Check your connection and retry.",
    API_INCOMPATIBLE:
      "This application service is incompatible with this web client.",
    GOOGLE_NOT_CONFIGURED:
      "The application operator has not configured Google sign-in. Contact them to enable it.",
    GOOGLE_SCRIPT_FAILED:
      "Google sign-in could not load. Check your connection and retry.",
    CONSENT_DENIED:
      "Google Drive permission was not granted. You can try connecting again.",
    POPUP_FAILED:
      "The Google window was blocked or closed. Allow popups and try again.",
    AUTH_REQUIRED:
      "Your Google session expired or access was revoked. Connect again to continue.",
    AUTH_FAILED: "Google authorization failed. Try connecting again.",
    CONTEXT_CHANGED: "The account or folder changed. Start this action again.",
    DRIVE_FORBIDDEN:
      "Google Drive denied this request. Check the account’s Drive access and, if selecting a folder, its permissions.",
    DRIVE_API_DISABLED:
      "Google Drive API is disabled or has not been used in the application’s Google Cloud project. The operator must enable Google Drive API for the project owning this OAuth client, wait a few minutes, then sign in again.",
    DRIVE_SCOPE_REQUIRED:
      "Google did not grant the Drive permission needed for this request. Reconnect and grant the requested Google Drive access.",
    DRIVE_DOMAIN_POLICY:
      "This Google Workspace account’s administrator blocks the app’s Drive access. Contact the administrator or use an allowed account.",
    DRIVE_NOT_FOUND:
      "This file or folder is unavailable to the connected account.",
    DRIVE_CONFLICT:
      "This file changed in another session. Reload and review your changes.",
    DRIVE_FAILED: "Google Drive could not complete this action. Try again.",
    DRIVE_BUSY:
      "Google Drive is temporarily unavailable or rate limited. Try again shortly.",
    NETWORK_FAILED:
      "Google Drive could not be reached. Check your connection and retry.",
    INVALID_DRIVE_DATA: "Google Drive returned an unexpected response.",
    INVALID_DRIVE_ID: "Enter a valid Google Drive folder ID.",
    INVALID_FOLDER_NAME: "Enter a folder name of up to 200 characters.",
    ROOT_NOT_FOLDER: "Choose an ordinary Google Drive folder for the library.",
    ROOT_REQUIRED: "Choose a library folder first.",
    OUTSIDE_ROOT: "This file is outside the selected library folder.",
    AMBIGUOUS_WRITE:
      "Google Drive did not confirm the change. Check Drive before trying again; the change may have succeeded.",
    WRITE_GATE_CLOSED:
      "Inventory and photo changes are awaiting concurrency verification.",
    DRIVE_ALREADY_EXISTS:
      "The reserved Drive file already exists. Refresh its current state before continuing.",
    LIBRARY_NOT_EMPTY:
      "This folder contains existing files. Review recovery; an empty index will not be created over an existing library.",
    UNSUPPORTED_WRITE_PROTOCOL:
      "This library uses an unsupported creation protocol. Use a compatible client before creating boxes.",
    READ_CONFLICT: "This file changed while loading. Refresh to try again.",
    DUPLICATE_FILE:
      "Multiple files have this name. Review them in Google Drive before continuing.",
    INVALID_JSON: "The file does not contain valid JSON.",
    INVALID_IMAGE: "This file is not a supported photograph.",
    REVOCATION_FAILED:
      "Local access ended, but Google did not confirm revocation. Remove access in your Google account settings.",
    INDEX_MISSING:
      "The library index is missing. Preview a rebuild to discover existing boxes.",
    INVALID_INDEX:
      "The library index is invalid. Review a recovery preview; the original stays unchanged.",
    UNSUPPORTED_SCHEMA:
      "This record uses a newer schema. This client cannot interpret it safely and will not edit or replace it.",
    INVENTORY_MISSING:
      "This box folder has no inventory.json. Check Drive or preview index recovery.",
    INVALID_INVENTORY:
      "This inventory does not match the supported contract. The file remains unchanged.",
    INVALID_BOX_ID: "This box link has an invalid identifier.",
    INVALID_BOX_NUMBER: "Enter a box number such as BOX-0001.",
    BOX_NOT_FOUND: "This box is not indexed in the selected library.",
    ITEM_NOT_FOUND: "This item is not in the current box inventory.",
    IMAGE_NOT_FOUND:
      "This photograph is missing or is no longer referenced by this item.",
    IDENTITY_MISMATCH:
      "The inventory identity does not match this index entry. Use recovery to review the records.",
    INDEX_STALE:
      "The index metadata differs from the current inventory. The authoritative inventory is shown; review index recovery.",
    INVENTORY_CHANGED:
      "The Drive inventory changed since the previous read. The refreshed contents are shown.",
    SCAN_LIMIT:
      "The recovery scan reached its folder limit. The proposal is incomplete and cannot replace the index.",
    DUPLICATE_INDEX:
      "Multiple root indexes were found. Review the original files in Drive.",
    DUPLICATE_INVENTORY:
      "Multiple inventory.json files were found in a box folder. Review them in Drive.",
    UNAVAILABLE_RECORD_RETAINED:
      "An existing entry could not be rediscovered. It remains in the proposal and blocks replacement.",
    DUPLICATE_BOX_ID:
      "Multiple folders contain the same box UUID. Resolve the ambiguity before recovery.",
    DUPLICATE_BOX_NUMBER:
      "Multiple boxes use the same permanent number. Resolve the ambiguity before recovery.",
    DUPLICATE_FOLDER_ID: "Multiple index entries refer to the same folder.",
    DUPLICATE_NFC_ID:
      "An NFC identifier belongs to multiple boxes. Resolve the ambiguity before recovery.",
    RECOVERY_INCOMPLETE:
      "The recovery proposal contains unresolved records and cannot replace the index.",
    CONFIRMATION_REQUIRED:
      "Review the proposed index and confirm replacement before saving.",
  };
  return messages[code] ?? "The action could not be completed. Try again.";
}
