# Browsing a library and previewing recovery

Stage 6 provides read-only browsing in the web client. Configure the deployment's shared public OAuth client ID as described in [Google setup](google-setup.md#stage-5-application-setup-and-live-checks), sign in through Google, and select an existing library root in Settings. Ordinary users need no Cloud project or payment-card setup. Root selection does not create an index or inventory.

Open **Library** to see indexed box numbers, names and locations. Enter a number such as `BOX-0001` or `box-1` to open it without scanning. **Browse folders** follows the hierarchy under the selected root; a box link appears when browsing its indexed folder. An empty index is distinct from a missing or damaged index. Items and photographs require a valid inventory whose UUID and number match the index entry.

Box links use `/box/<boxUuid>` and item links use `/box/<boxUuid>/item/<itemUuid>`. IDs are independent of Drive folder names. An authorized deep link resolves through the selected library's index. Account setup retains a requested box/item path and offers **Open requested record** after root selection; a fresh browser reload still needs authorization. Folder renames remain readable by Drive ID. Moving a folder inside the root preserves identity; use recovery preview to discover a moved inventory when its recorded folder ID is stale. Content outside the selected root is rejected.

Open an item and choose **Load photo** to download one referenced photograph directly from Drive. Close it to release its browser object URL. Missing or duplicate filenames produce explicit errors and retry controls. Browsing lists does not download full images. List thumbnails are deferred; see [the limitation](stage-6-findings.md). Photographs, documents and authorization tokens are kept only in memory. Navigating away releases visible photo URLs; changing the account/root or losing authorization also clears runtime records and rejects late responses.

**Refresh library** reloads the index and clears cached records/photos. **Refresh box** also reloads its inventory and reports changes in observed Drive versions. Inventory metadata is authoritative: a difference from the index is reported, without silently updating the index. Missing files, invalid JSON, duplicate records, permission failures and newer schemas display guarded errors. No writable fallback form is offered for an unknown schema.

Choose **Edit box and items** or **Draft a new box** for [Stage 7 in-memory drafts](editing.md). New-box creation is enabled using verified coordinated writes. For a genuinely empty root with no index, choose **Initialize empty library** first. Existing-box saving and recovery publication remain gated.

## Index recovery preview

Choose **Preview rebuilt index** to recursively inspect `inventory.json` files under the selected root. The scan follows folders, skips shortcuts and stops at a 2,000-folder safety limit. It validates every inventory, collects its UUID, number, name, location and authoritative `box.nfcIds`, and proposes current Drive folder IDs. Existing supported index extension fields are preserved.

Review the counts, issues and proposed JSON. Duplicate UUIDs, numbers, NFC IDs, index/inventory filenames, invalid/newer records inaccessible folders and pending creations make a report incomplete. Pending folders/markers/draft inventories are reported and never auto-published or deleted. If a valid original index references an inventory that cannot be rediscovered, its entry is retained and reported. A damaged original index cannot establish all historical entries; its proposed reconstruction remains incomplete, and the original is preserved. The preview is not a backup or a write.

**Replace index after review** stays disabled. The service has confirmation and document/listing conflict checks, followed by the existing fail-closed write adapter. Those checks do not eliminate the race between reading and writing. Saving/replacing/bootstrapping an index requires proven atomic updates and concurrent bootstrap coordination from Stage 1, including a safe backup/recovery procedure. Do not bypass the gate or overwrite a damaged index manually based solely on a preview.

## Live acceptance checklist

Use synthetic disposable data and two ordinary accounts with the same operator-configured OAuth client. Record observations without credentials in [Stage 6 findings](stage-6-findings.md). Automated fixtures do not establish Google's actual browser behaviour.

1. Place valid v1 examples under a disposable root, including nested folders and an empty box. Compare the library, manual number lookup, UUID box/item links and folder traversal with Drive. Verify reload/deep-link account setup retains the requested record.
2. Open an item, load/close a photo, and inspect network destinations. No Google token or inventory/image request may go to the Docker API. Lists must not download full images. Verify missing/duplicate image errors.
3. Rename/move a box folder inside the root and edit its inventory externally. Refresh; verify observed changes and metadata warnings. Move it outside the root and verify access is refused.
4. Preview recovery with a missing index and then with stale folder IDs. Verify number/NFC associations and current folder IDs against the authoritative inventories. Inspect Drive afterward: no file changed.
5. Repeat with corrupt/newer documents, duplicate UUIDs/numbers/NFC mappings and an inaccessible previously indexed box. Review explicit issues and retained unavailable entries. Replacement remains disabled; originals stay unchanged.
6. Load a photo, change the account/root, sign out and test expiry/revocation. Old records/photos must disappear immediately, including responses finishing after the change. The second account must not access unshared content from the first.
7. Run separate [atomic-write/bootstrap experiments](google-setup.md#concurrency-checks) before enabling replacement in a future change. Direct-web thumbnails require an independently verified client-only strategy.
