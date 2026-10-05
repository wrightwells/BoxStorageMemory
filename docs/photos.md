# Item photograph management

Open a box, open an item, then choose **Manage photographs**. The deployed workflow supports upload, viewing, replacement, reference removal, item deletion, confirmed cleanup and explicit association of recovered owned uploads. It uses [coordinated photo writes](decisions/009-coordinated-photos.md).

## Add and view photographs

1. Choose files with **Choose photographs**, use the device capture input, or start the camera preview. Denied/unavailable camera access leaves file selection usable.
2. Review the prepared JPEG previews. Remove unwanted previews before uploading. Optional resizing defaults to a 2560-pixel longest side without upscaling.
3. Choose **Upload selected photographs**. The client validates the intended inventory, uploads ordinary JPEG files directly to Drive, verifies the stored bytes and conditionally publishes their filename references.
4. Wait for **Photo association complete.** Use **Load photo** to view the stored image; **Close photo** releases its browser URL. Fresh navigation reloads references from Drive.

JPEG, PNG, WebP, GIF and AVIF sources are supported through browser decoding. Limits are 25 MiB per source, 20 selections, 40 million decoded pixels and a 16384-pixel side. GIF becomes a still image; unsupported formats such as HEIC require conversion. JPEG quality is 0.9 with transparency painted white. Device orientation/hardware acceptance remains pending.

## Replace, remove and clean up

Choose exactly one new preview and select **Photograph to replace**, then **Replace with selected photograph**. The new JPEG is uploaded and verified before replacing the reference. The old file remains until cleanup.

**Remove photograph reference** removes the filename from the item. **Delete item and review its photos** removes the item and its references. Both require confirmation and retain photo files for review. Already missing files do not block removal of their references.

After a confirmed reference change, choose **Review and clean up unreferenced photos**. Cleanup holds the library owner while checking fresh inventory, file identity/version, unique name, ownership and permissions. Only verified owned, unreferenced candidates move to Drive trash. Referenced, changed, duplicate, unrelated or unverified files remain. Permanent deletion is never used.

The v1 contract rejects a filename owned by multiple items. Invalid shared ownership stops mutation/cleanup and retains files for manual review. Historical files lacking application provenance can have references removed, but cleanup preserves those files. Ordinary item deletion in the box editor retains every photo; use this workflow when reviewed cleanup is required.

## Recover owned uploads

On a fresh photo-management page choose **Scan owned uploads**. Referenced, duplicate and unverified files are retained. Select eligible unreferenced JPEGs, then confirm **Associate selected recovered photos** or **Clean up selected recovered photos**. These actions recheck current authority and reviewed metadata under the library lock. Association never uploads again or guesses a previous replacement intent. A removed item's URL remains usable for cleanup when matching owned files exist; association cannot recreate the item.

## Interrupted operations and privacy

An interrupted coordinated operation keeps its durable marker and root owner in Drive. **Re-read current Drive records** and upload discovery are read-only inspection. **Retry reference update** remains disabled for pending coordinated operations; automatic resume, lock expiry and blind mutation retry are unavailable. Discarding in-memory review does not undo Drive writes or release the durable owner. Review the marker before deliberate recovery.

Generated upload IDs and intended filenames are recorded before uploads. Lost responses therefore do not authorize another upload or deletion of unknown files. Pending records block other coordinated writers and recovery publication.

Previews and camera streams are released on confirmed navigation, account/root change or sign-out. Drafts and tokens remain private browser memory; no offline inventory queue or server operation database is introduced. Only ordinary validation JSON goes to the application backend; image bytes and Google tokens go directly to Google.

See [photo test evidence](live-photo-management-test.md) for automated and live results.
