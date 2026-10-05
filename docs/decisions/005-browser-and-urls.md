# 005 — Browser capabilities and deployment URLs

Status: Capability-based design accepted; browser/hardware execution pending.

Target Chrome desktop, Chrome Android browser, Firefox and Edge for core browser workflows. Check capabilities at runtime rather than promising them from the browser name. Responsive, keyboard-accessible browsing, number lookup and search are always alternatives to scanning.

| Feature | Runtime check and failure behaviour |
| --- | --- |
| Google authorization | GIS library loaded, popup/user gesture permitted, correct registered origin. Show consent/popup/library-load errors. |
| Camera QR/capture | Secure context plus `navigator.mediaDevices?.getUserMedia`; request camera on user action. Denial/unavailable hardware leaves manual lookup/upload. Stop media tracks on navigation/sign-out. |
| File upload | File input capability; validate actual supported image contents in the later photo implementation, not filename alone. |
| Web NFC | Feature enabled, secure top-level context, `NDEFReader` available, permission/hardware enabled, tag compatible, and a usable nonempty serial number. Otherwise disable with a short explanation and keep QR/manual lookup. |

Web NFC is an optional NDEF-oriented API; it does not promise native access to every NFC tag UID. Its reading event may have an empty `serialNumber`. Do not parse a writable tag payload as the permanent box identity or claim a tag was scanned successfully without an identifier. Source: [Chrome Web NFC documentation](https://developer.chrome.com/docs/capabilities/nfc).

The contract preserves UID byte order as delivered by the reader. Normalise representation only; do not reverse bytes heuristically. Hardware-specific order/length compatibility must be checked with reference tags before claiming interoperability with a separately developed native reader.

## Routes and public URL

Version 1 deployments use an origin-level `PUBLIC_URL`, such as `https://boxes.example.com`, without an application subpath, credentials, query or fragment. HTTPS is required remotely; `http://localhost`, `http://127.0.0.1` and `http://[::1]` are permitted for local development. The SPA fallback serves `/box/{uuid}` without intercepting API errors.

QR generation emits the canonical absolute route. Scanners accept only the exact configured canonical origin, `/box/` path and lowercase valid UUID, with no query/fragment/trailing slash or encoded path tricks. Authentication and root selection precede record display, and the requested UUID survives that flow. A QR URL grants no Drive permission.

Folder rename/move, photo updates and tag replacement preserve printed QR validity because they preserve UUID. Moving the deployment to a different origin does not preserve old URL reachability automatically. Retain the old domain with a deliberate HTTPS redirect if it remains controlled, or regenerate labels. Do not automatically trust QR codes from another deployment; they require explicit navigation outside the scanner's automatic-open path.
