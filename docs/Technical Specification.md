# Box Storage Memory
## Technical Specification

**Version:** 1.1  
**Date:** 4 October 2026  
**Status:** Revised specification — application-level Google registration

Revision 1.1 incorporates [decision 006](decisions/006-application-oauth-registration.md): operator/publisher registration, separate platform clients and ordinary-user onboarding without Cloud projects or payment-card setup. It also aligns browser authorization with the Stage 1/5 token-model decision. Data schema and REST API versions remain unchanged. Historical local test results are not evidence that live Google acceptance has passed.

---

# 1. Purpose

This document defines the technical design for the Box Storage Memory system described by the approved Functional Specification.

The solution consists of two separately developed projects:

1. **Box Storage Server**
   - Docker-deployed application.
   - Hosts the web application.
   - Provides the Box Storage REST API.
   - Provides common validation, configuration and utility services.
   - Does not persist or receive Google OAuth access or refresh tokens.

2. **Box Storage Android Application**
   - Native Android application.
   - Communicates with Google Drive directly.
   - Uses the Box Storage API where common application services are required.
   - Supports camera QR scanning and native NFC tag scanning.

The two projects shall share:

- the Box Storage data model;
- inventory JSON schema;
- box identifier conventions;
- QR conventions;
- API specification;
- validation rules;
- versioning rules.

They may otherwise be developed and released independently.

---

# 2. Principal Architectural Decision

The most important architectural requirement is:

> Google authentication credentials, access tokens and refresh tokens shall not be stored by the Box Storage Server.

The architecture goes further than this requirement.

**Google OAuth tokens shall not be sent to the Box Storage Server at all.**

Google Drive access shall be performed directly by:

- the user's browser, for the web application;
- the Android application, for the native application.

Therefore the data flow is:

```text
WEB APPLICATION
───────────────

Browser
   │
   ├────────────► Google Authentication
   │
   ├────────────► Google Drive API
   │
   └────────────► Box Storage API
                      │
                      └── No Google token


ANDROID APPLICATION
───────────────────

Android App
   │
   ├────────────► Google Authentication
   │
   ├────────────► Google Drive API
   │
   └────────────► Box Storage API
                      │
                      └── No Google token
```

Application registration and a public OAuth client ID do not give the project owner or Docker operator permission to a user's Drive. Each user shall grant their own authorization directly to Google. The implementation removes the designed server credential transport/storage path.

The browser still trusts the JavaScript supplied by its deployment. A malicious host could replace that code; the token boundary does not establish safety against a compromised application host. Publisher registration shall therefore include only reviewed, trusted deployment origins.

The server therefore acts as an **application host and stateless application service**, rather than a Google Drive proxy.

---

# 3. System Architecture

The system shall use the following logical architecture:

```text
                     ┌───────────────────────┐
                     │       Google          │
                     │                       │
                     │ Identity / OAuth      │
                     │ Google Drive API      │
                     └───────────┬───────────┘
                                 │
                    Direct authenticated access
                                 │
             ┌───────────────────┴───────────────────┐
             │                                       │
     ┌───────▼─────────┐                    ┌────────▼────────┐
     │   Web Browser   │                    │   Android App   │
     │                 │                    │                 │
     │ React/TypeScript│                    │ Kotlin/Compose  │
     │ Google Client   │                    │ Google Client   │
     │ QR / Web NFC    │                    │ QR / NFC        │
     └────────┬────────┘                    └────────┬────────┘
              │                                      │
              └────────────────┬─────────────────────┘
                               │ HTTPS REST
                       ┌───────▼────────┐
                       │ Box Storage API│
                       │                │
                       │ Stateless      │
                       │ No Drive Token │
                       └───────┬────────┘
                               │
                       ┌───────▼────────┐
                       │ Docker Runtime │
                       └────────────────┘
```

---

# 4. Recommended Technology Stack

## 4.1 Server

Recommended implementation:

- **Python 3**
- **FastAPI**
- Pydantic for schema validation
- Uvicorn application server
- REST/JSON API
- OpenAPI 3 generated automatically
- Docker
- Docker Compose

FastAPI is selected because the server is predominantly:

- REST API;
- JSON validation;
- search/utility processing;
- stateless services;
- OpenAPI generation.

The implementation architecture shall nevertheless separate business logic sufficiently that another server framework could replace FastAPI without changing the published API.

---

# 5. Web Application Technology

The web application shall use:

- React;
- TypeScript;
- Vite;
- responsive HTML/CSS;
- Google Identity Services;
- Google Drive REST API;
- browser Camera APIs;
- QR decoding library;
- Web NFC where supported.

The compiled frontend shall be static content served by the Docker application.

The production browser shall communicate only over HTTPS except where localhost is explicitly being used for development.

---

# 6. Android Application Technology

The Android project shall use:

- Kotlin;
- Jetpack Compose;
- Android Architecture Components;
- ViewModel;
- Kotlin Coroutines;
- Retrofit/OkHttp for Box Storage API calls;
- Google authentication libraries;
- Google Drive REST API;
- CameraX;
- ML Kit Barcode Scanning or ZXing;
- Android NFC APIs.

Minimum Android API level should initially be **API 26 / Android 8.0**, unless dependency testing establishes a reason to increase this.

NFC shall be treated as an optional hardware capability rather than making NFC hardware mandatory for installation.

A device without NFC shall still provide:

- QR scanning;
- search;
- browsing;
- viewing;
- editing.

---

# 7. Google Authentication Architecture

## 7.1 Application-level project and platform clients

A managed Box Storage application shall use an operator/publisher-managed Google Cloud project with the Drive API enabled, shared consent branding/audience and separate OAuth client registrations for:

- Web application;
- Android application.

These clients shall normally belong to the same application project. The public web client ID shall be configured once for the Docker deployment and used by all authorized users of that deployment. An OAuth client identifies the application, not an individual user's Google account. See [Google's cross-client identity model](https://developers.google.com/identity/protocols/oauth2/cross-client-identity).

## 7.2 Operator and user responsibilities

The operator/publisher shall configure client registrations, trusted web origins, the native application identity, consent testing/publication, applicable verification and project quotas.

Ordinary web and Android users shall only sign in with Google, grant the requested permissions and choose their accessible library folder. They shall not be required to create a Cloud project, configure OAuth clients, become project members, link a Cloud billing account or provide a payment card to use Box Storage. A user's own Drive storage limits still apply.

During External-audience testing, the operator shall add allowed accounts as consent test users. This does not require giving them Cloud IAM or billing roles. Public distribution remains subject to Google's consent/verification and account policies.

## 7.3 Deployment and native application registration

The web client shall register exact trusted JavaScript origins. Independent Docker deployments require appropriate registration by their own project owner or by a publisher who explicitly trusts that deployment. A shared client ID shall not be advertised as working at arbitrary unregistered hostnames. Wildcard origins, shared passwords and token-relay services shall not be used to bypass registration.

The Android publisher shall register the native application's package/signing identity using the supported Google authorization mechanism. The Android application shall not adopt an arbitrary server-provided web client ID as its trusted native identity. Native implementation remains the separate Android project's responsibility.

## 7.4 Billing and publishing expectations

An operator project with no billing account linked shall be preferred where Google permits the required Drive/OAuth setup. Optional Cloud free-trial enrolment and unrelated paid services are not application requirements. If Console account/project policy blocks setup, that requirement shall be investigated by the operator; the application cannot override Google's policies.

Google's [current Drive API limits/pricing](https://developers.google.com/workspace/drive/api/guides/limits) lists standard usage at no additional cost and planned above-quota charges later in 2026. Any applicable API billing/quota management is associated with the application project, not a payment-card step for each Drive user. Restricted-scope publishing/assessment, hosting and above-quota usage may create operator costs; no unlimited or permanently free usage guarantee is made.

---

# 8. Web Authentication

The web application shall authenticate directly with Google.

The browser shall use the documented Google Identity Services token model:

**`initTokenClient` with a user-gesture authorization popup and callback.**

This supersedes version 1.0's preferred browser code + PKCE mechanism, as resolved in [decision 002](decisions/002-google-authorization.md). No server code exchange, application client secret or refresh-token store shall be introduced. See [Google's browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

The browser shall receive the access token.

The access token shall remain within browser memory.

It shall not be:

- transmitted to the Box Storage server;
- written to server logs;
- placed in URLs;
- stored in the inventory;
- persisted in server-side sessions;
- stored in server databases.

The browser may maintain normal Google authentication state where required by Google's client libraries.

The Box Storage application itself shall not implement persistent storage of Google refresh tokens.

When authorization expires or Google returns 401, the application shall clear local access and request renewed authorization through a user action. Account switching shall clear the previous account/root context before opening Google's chooser. Local sign-out and explicit grant revocation shall be distinct actions.

---

# 9. Android Authentication

The Android application shall authenticate directly against Google using its publisher-registered Android client identity. Users shall not create native OAuth registrations or Cloud billing accounts. See [Android authorization](https://developer.android.com/identity/authorization).

The application shall use the operating-system/browser-mediated Google authentication process rather than embedding a Google username/password form inside the application.

The Android application may use Google's approved operating-system authentication mechanisms. App-held access tokens shall be transient, and the application shall not implement its own persistent Google refresh-token/password store.

Google credentials shall never be forwarded to the Box Storage API.

Selecting **Sign Out** shall clear the application authentication state.

---

# 10. Google Drive Permissions

The application shall request only the Google Drive permissions necessary to satisfy the application requirements.

The implementation shall follow the principle of least privilege.

For the version 1 existing-library requirement, the selected scope is `https://www.googleapis.com/auth/drive`, subject to live verification. This scope grants account-wide Drive permission. Traversal/mutation shall be restricted to the selected library in application code; selecting a folder does not establish an OAuth folder-only permission boundary or override Google's file permissions.

The restricted scope entails applicable publisher verification and potentially security assessment according to deployment/data handling. Registration is shared across users; reducing scope is not required to eliminate per-user Cloud setup.

`drive.file` may be adopted only with an explicit selection/import design and acceptance evidence for existing inventories/photos and cross-deployment portability. Folder selection alone shall not be assumed to authorize every descendant. See [Google's scope definitions](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

The application shall not request access to:

- Gmail;
- Calendar;
- Contacts;
- Photos;
- other Google services.

---

# 11. Google Drive Storage Model

The user shall select or create one Google Drive folder to act as the:

**Box Storage Root**

Example:

```text
Box Storage/
│
├── box-storage-index.json
│
├── Garage/
│   ├── Electrical Box/
│   │   ├── inventory.json
│   │   ├── 001-extension-lead.jpg
│   │   ├── 002-multimeter.jpg
│   │   └── 003-adapters.jpg
│   │
│   └── Plumbing Box/
│       ├── inventory.json
│       └── ...
│
└── Loft/
    └── Christmas Decorations/
        ├── inventory.json
        └── ...
```

Physical nesting of folders is permitted.

Every folder representing a physical storage box shall contain an `inventory.json` file.

---

# 12. Root Index

A file named:

```text
box-storage-index.json
```

shall exist in the Box Storage Root.

Its primary purposes are:

- resolve Box IDs;
- resolve NFC IDs;
- resolve QR references;
- avoid recursively scanning the entire Drive for every lookup;
- provide fast initial box discovery.

Example:

```json
{
  "schemaVersion": 1,
  "updated": "2026-10-03T15:30:00Z",
  "boxes": [
    {
      "boxId": "9a46f128-1b5a-42ad-a240-b9015cff9ca6",
      "name": "Electrical Box",
      "driveFolderId": "1ABCDEF123456",
      "location": "Garage",
      "nfcIds": [
        "04AABBCCDDEE11"
      ]
    }
  ]
}
```

The Drive folder ID shall be stored because folder names and locations may subsequently change.

The application shall not use folder names as permanent identifiers.

---

# 13. Box Identifier

Every box shall have an application-generated UUID.

Example:

```text
9a46f128-1b5a-42ad-a240-b9015cff9ca6
```

This value is the permanent **Box ID**.

The Box ID shall not change when:

- the folder is renamed;
- the folder is moved;
- inventory is edited;
- photographs change;
- an NFC tag is replaced.

---

# 14. QR Code Design

A QR code shall contain an application URL rather than raw inventory data.

Example:

```text
https://boxes.example.com/box/9a46f128-1b5a-42ad-a240-b9015cff9ca6
```

This design allows the same printed QR code to remain valid when:

- inventory changes;
- images change;
- folder names change;
- the box moves to another location.

The QR code itself contains only the immutable Box ID within the URL.

---

# 15. NFC Identification

NFC tags shall identify a box using the tag's unique identifier/serial number.

Inventory information shall not need to be stored on the NFC tag.

Example:

```text
NFC UID:
04:A1:34:CA:92:71:80
```

shall be normalised internally as:

```text
04A134CA927180
```

The index shall associate this with:

```text
Box ID → NFC ID
```

The implementation shall support assigning a replacement NFC tag to an existing Box ID.

Multiple NFC IDs may temporarily be associated with the same box to allow tag replacement.

---

# 16. Web NFC Behaviour

Native NFC is not universally available to web browsers.

The web application shall therefore implement capability detection.

Where Web NFC is available:

```text
Scan NFC
    ↓
Read serialNumber
    ↓
Normalise NFC identifier
    ↓
Look up identifier in box-storage-index.json
    ↓
Open Box
```

Where NFC is unavailable the interface shall:

- disable or hide the NFC function;
- retain QR scanning;
- display a short explanation where appropriate.

Web NFC shall therefore be considered a convenience feature rather than a prerequisite for using the web application.

---

# 17. Android NFC Behaviour

The Android application shall use Android native NFC reader functionality.

On NFC detection:

```text
Tag detected
      │
      ▼
Read tag UID
      │
      ▼
Normalise UID
      │
      ▼
Search local in-memory Box index
      │
      ▼
Resolve Box ID
      │
      ▼
Retrieve inventory.json
      │
      ▼
Display box
```

Where supported by Android, scanning a recognised tag while the application is running shall immediately open its box.

The application may also register for appropriate NFC intents so that scanning can launch or foreground Box Storage.

---

# 18. Inventory JSON Format

Each box folder shall contain:

```text
inventory.json
```

The JSON document shall be the authoritative machine-readable inventory description.

Recommended schema:

```json
{
  "schemaVersion": 1,
  "box": {
    "id": "9a46f128-1b5a-42ad-a240-b9015cff9ca6",
    "name": "Electrical Box",
    "description": "General electrical items",
    "location": "Garage",
    "tags": [
      "electrical",
      "tools"
    ],
    "created": "2026-10-03T14:00:00Z",
    "modified": "2026-10-03T15:30:00Z"
  },
  "items": [
    {
      "id": "77eb8825-f466-4353-a106-d99d78ad0cc9",
      "name": "13A Extension Lead",
      "description": "10 metre orange extension lead",
      "quantity": 1,
      "tags": [
        "electrical",
        "extension"
      ],
      "images": [
        "001-extension-lead.jpg"
      ]
    }
  ]
}
```

---

# 19. Inventory Schema Requirements

Mandatory box fields:

```text
schemaVersion
box.id
box.name
box.created
box.modified
items
```

Recommended fields:

```text
box.description
box.location
box.tags
```

Mandatory item fields:

```text
id
name
quantity
```

Optional item fields:

```text
description
tags
images
notes
```

Unknown fields shall normally be preserved when editing.

This allows future schema extensions without older applications unnecessarily deleting newly introduced data.

---

# 20. Image Storage

Photographs shall be stored directly beside `inventory.json`.

Example:

```text
Electrical Box/
│
├── inventory.json
├── extension-lead.jpg
├── multimeter-front.jpg
└── multimeter-back.jpg
```

The JSON shall reference images by filename.

The application shall not embed photographs as Base64 within JSON.

Images shall remain ordinary Google Drive files.

---

# 21. Image Capture

Both applications shall support:

- selecting an existing photograph;
- taking a new photograph;
- previewing before upload;
- associating one or more images with an inventory item.

The Android application shall use the native camera capability.

The web application shall use standard browser media/camera APIs.

JPEG shall be the default image format.

The application may resize excessively large images before upload.

Recommended target maximum dimension:

```text
2560 pixels
```

while preserving aspect ratio.

Original-quality uploads may subsequently be made configurable.

---

# 22. Search Architecture

Because the server is deliberately prevented from reading Google Drive, server-side persistent indexing shall not be used.

Search shall run within the client.

After login the application shall retrieve:

```text
box-storage-index.json
```

and then retrieve inventory data as required.

For a full inventory search, the client shall build an in-memory search index containing:

- box name;
- box location;
- box tags;
- item name;
- description;
- item tags;
- notes.

No permanent central search database shall be required.

---

# 23. Search Behaviour

Search shall be case-insensitive.

Example:

```text
Search: drill
```

may return:

```text
Power Drill
Box: Power Tools
Location: Garage
```

Selecting the result opens the containing box and highlights or focuses the matched item.

Search should support partial terms.

Example:

```text
exten
```

may match:

```text
Extension Lead
```

---

# 24. Editing Model

Stage 7 implementation note (4 October 2026): the web client provides volatile
creation/edit drafts, source-preserving transforms, local/stateless API validation,
read-only permission guards and unsaved-navigation prompts. New-box creation uses
verified v2 CAS, fixed-ID index initialization and a durable root owner
([decision 007](decisions/007-coordinated-creation.md)); existing-box saving remains gated. Simulator acceptance is distinct from live Drive acceptance. See
[Stage 7 findings](stage-7-findings.md) and [interrupted-operation design](editing.md).

Editing shall occur in the client.

Process:

```text
Load inventory.json
       ↓
Edit locally
       ↓
Validate against schema
       ↓
Check coherent baseline and Drive file version
       ↓
Conditionally replace inventory.json using a verified atomic primitive
       ↓
Verify the committed inventory
       ↓
Conditionally reconcile derived index metadata and folder naming
       ↓
Report verified success or partial/uncertain state
```

Editing shall never require the server to hold Google credentials.

---

# 25. Concurrent Editing

The client shall record the Google Drive file version or modification identifier when loading an inventory.

Before saving, the client shall check whether the file has changed. The check shall be combined with a verified atomic write precondition; reading a version and then uploading unconditionally is insufficient. Independent sessions must demonstrate that a stale writer is rejected. Production writes remain disabled until this is verified for inventory/index updates and relevant metadata mutations.

If another device has modified the inventory, the application shall not silently overwrite it.

The user shall be informed:

```text
This box has been changed since you opened it.

Reload latest version
Review changes
```

Automatic destructive overwrite shall not occur.

---

# 26. Box Creation

Creating a box shall perform:

```text
Generate box UUID, operation UUID and unreserved number proposal
       ↓
Create pending Drive folder, recovery marker and draft inventory
       ↓
Conditionally claim UUID/number/folder in the root index
       ↓
Conditionally publish exactly one inventory.json and verify
       ↓
Finalize folder naming and clean the marker after verification
       ↓
Optionally associate NFC tag
       ↓
Generate QR code
```

Stage 7 new-box creation uses decision 007; ordinary edits and NFC mutations retain their gates. A losing number claimant stays pending and cannot publish a committed box or label. Marker/bootstrap/publication use the verified creation protocol; concurrent recovery publication remains gated; no multi-file transaction is implied. See [editing and recovery instructions](editing.md).

The generated QR code shall be available for:

- screen display;
- printing;
- saving as an image.

---

# 27. NFC Tag Assignment

Tag assignment shall use the following workflow:

```text
Open Box
   ↓
Manage Identifiers
   ↓
Add NFC Tag
   ↓
Tap tag
   ↓
Read UID
   ↓
Check for existing assignment
   ↓
Associate UID with Box ID
   ↓
Update root index
```

If the NFC ID is already assigned to another box, the application shall show the existing assignment and require explicit confirmation before reassignment.

---

# 28. QR Scanning

The web and Android applications shall provide:

```text
Scan QR
```

The expected QR URL shall be validated before processing.

Only URLs matching the configured Box Storage application scheme/domain shall automatically open a box.

Unexpected QR values shall not be followed automatically.

---

# 29. URL Handling

Box URLs shall use:

```text
/box/{boxId}
```

Example:

```text
https://boxes.example.com/box/9a46f128-1b5a-42ad-a240-b9015cff9ca6
```

When opened:

1. application loads;
2. user authenticates to Google if necessary;
3. application loads the Box Storage Root;
4. Box ID is resolved;
5. inventory is displayed.

A QR URL therefore remains safe to share because it does not itself grant access to Google Drive.

---

# 30. Server REST API

The Docker server shall expose a versioned REST API:

```text
/api/v1/
```

The API shall exchange JSON.

Example endpoints:

```text
GET  /api/v1/health
GET  /api/v1/config
GET  /api/v1/schema/inventory
GET  /api/v1/schema/index

POST /api/v1/validate/inventory
POST /api/v1/validate/index

POST /api/v1/search
POST /api/v1/qr/generate
```

No endpoint shall require or accept Google OAuth tokens.

---

# 31. Health Endpoint

```text
GET /api/v1/health
```

Example:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "apiVersion": "v1"
}
```

The endpoint shall not expose:

- environment secrets;
- filesystem information;
- authentication material.

---

# 32. Configuration Endpoint

```text
GET /api/v1/config
```

shall return public client configuration.

Example:

```json
{
  "apiVersion": "v1",
  "appName": "Box Storage",
  "applicationVersion": "1.0.0",
  "publicUrl": "https://boxes.example.com",
  "googleWebClientId": "operator-configured-web-client.apps.googleusercontent.com",
  "features": {
    "webNfc": false,
    "qrFormat": "png"
  },
  "compatibility": {
    "supportedSchemaVersions": [1],
    "minimumWebClientVersion": "1.0.0",
    "minimumAndroidClientVersion": "1.0.0"
  }
}
```

Only information safe for exposure to a browser shall be returned.

A Google OAuth client ID is not treated as a password or application secret.

`googleWebClientId` identifies the configured web application and shall be the same for all users of that deployment. Configuration shall not provide per-user OAuth credentials, Cloud project/billing setup or an arbitrary native-client identity. An empty web ID shall disable web authorization with an operator-configuration message; the token-free utility API shall remain usable. The published [v1 OpenAPI](../api/v1/openapi.json) is the implemented HTTP contract.

---

# 33. Validation API

Example:

```text
POST /api/v1/validate/inventory
```

Request:

```json
{
  "schemaVersion": 1,
  "box": {},
  "items": []
}
```

Response:

```json
{
  "valid": false,
  "errors": [
    {
      "path": "box.name",
      "message": "Field is required"
    }
  ]
}
```

This permits both Android and Web projects to use exactly the same server-side validation rules while still performing basic validation locally.

---

# 34. Search API

The API may provide stateless search processing.

Example:

```text
POST /api/v1/search
```

The client sends already-authorised inventory data:

```json
{
  "query": "extension lead",
  "boxes": [...]
}
```

The server may return ranked matches.

The important distinction is:

**The client sends application data voluntarily; the server never retrieves it from Google Drive itself.**

No search request contents shall be permanently indexed.

The default implementation may alternatively perform search completely within the client.

---

# 35. QR Generation API

Example:

```text
POST /api/v1/qr/generate
```

Request:

```json
{
  "boxId": "9a46f128-1b5a-42ad-a240-b9015cff9ca6"
}
```

Response may be:

```text
image/png
```

or SVG.

The API shall generate the QR code from the configured public application URL plus Box ID.

---

# 36. API Documentation

FastAPI shall expose OpenAPI documentation.

Development deployments may expose:

```text
/api/docs
/api/openapi.json
```

Production deployments may disable the interactive documentation while retaining the OpenAPI definition where required.

The OpenAPI definition shall form the formal contract between the Docker project and Android project.

---

# 37. Android API Client

The Android project shall generate or maintain a typed client against:

```text
/api/v1/
```

All API interaction shall be abstracted behind an interface such as:

```text
BoxStorageApi
```

UI code shall not issue raw HTTP requests directly.

This allows API implementation details to change independently from application screens.

---

# 38. Android Project Architecture

Recommended structure:

```text
app/
│
├── auth/
│   └── Google authentication
│
├── data/
│   ├── drive/
│   ├── api/
│   ├── model/
│   └── repository/
│
├── domain/
│   ├── box/
│   ├── inventory/
│   └── search/
│
├── nfc/
│
├── qr/
│
├── camera/
│
└── ui/
    ├── login/
    ├── library/
    ├── box/
    ├── item/
    ├── search/
    └── settings/
```

A repository layer shall separate Google Drive implementation from the UI.

Example:

```text
BoxRepository
   │
   ├── GoogleDriveBoxRepository
   └── FutureAlternativeRepository
```

---

# 39. Android Screens

The Android application shall provide at least:

```text
Google Login
      ↓
Storage Root Selection
      ↓
Library
      ├── Search
      ├── Scan QR
      ├── Scan NFC
      └── Browse
             ↓
             Box
             ├── Items
             ├── Photos
             ├── Edit
             └── Add Item
```

---

# 40. Web Application Structure

Recommended source structure:

```text
src/
│
├── api/
├── auth/
├── components/
├── drive/
├── models/
├── pages/
├── qr/
├── nfc/
├── search/
├── state/
└── validation/
```

Google Drive operations shall be isolated behind a service interface.

Example:

```text
DriveStorageService
```

with operations such as:

```text
selectRoot()
listBoxes()
loadIndex()
loadInventory()
saveInventory()
uploadImage()
createBox()
deleteImage()
```

This prevents Google-specific API code being spread through the user interface.

---

# 41. Web Routes

Suggested browser routes:

```text
/
 /login
 /library
 /search
 /box/:boxId
 /box/:boxId/edit
 /box/:boxId/item/:itemId
 /settings
```

Direct navigation to:

```text
/box/:boxId
```

shall work so that printed QR codes can launch directly into the relevant box.

---

# 42. Docker Architecture

Recommended deployment:

```text
box-storage/
│
├── Dockerfile
├── compose.yaml
├── backend/
├── frontend/
└── config/
```

Build:

```text
Stage 1
Node image
Build React frontend
        ↓
Stage 2
Python image
Install FastAPI backend
Copy frontend build
        ↓
Production image
```

This produces one main application image.

---

# 43. Container Runtime

Recommended Compose service:

```yaml
services:
  box-storage:
    image: box-storage:latest
    restart: unless-stopped
    environment:
      - PUBLIC_URL=https://boxes.example.com
      - GOOGLE_WEB_CLIENT_ID=...
    ports:
      - "8080:8080"
```

Google user access tokens shall never appear in environment variables.

`GOOGLE_WEB_CLIENT_ID` is one public application-registration value supplied by the operator. Adding or switching users shall not require changing this variable, rebuilding the image or creating another Cloud project.

---

# 44. Persistent Storage

The Docker application shall not require a database for the core application.

Optional persistent server storage may be used for:

- application configuration;
- logs;
- generated application metadata.

It shall not contain:

- Google access tokens;
- Google refresh tokens;
- Google passwords;
- cached Drive contents;
- permanent inventory copies.

The authoritative inventory remains Google Drive.

---

# 45. Reverse Proxy

For remotely accessible deployment, a separate reverse proxy container is recommended.

Supported options may include:

- Nginx;
- Nginx Proxy Manager;
- Caddy;
- Traefik.

Architecture:

```text
Internet
   │
 HTTPS
   │
Reverse Proxy
   │
Docker Network
   │
Box Storage :8080
```

The application container itself need not terminate public TLS.

---

# 46. HTTPS

HTTPS shall be mandatory for normal remote deployment.

This is necessary for:

- secure API communication;
- Google authentication;
- camera access under browser security rules;
- Web NFC;
- protection of inventory information.

Plain HTTP shall only be permitted for appropriate localhost development scenarios.

---

# 47. CORS

Production CORS shall use an explicit allow-list.

Example:

```text
https://boxes.example.com
```

Wildcard:

```text
*
```

shall not be used in normal production configuration.

Where the native Android application accesses the API, it is not subject to browser CORS enforcement.

---

# 48. Security Headers

The reverse proxy/application shall apply appropriate headers including:

```text
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
Content-Security-Policy
Permissions-Policy
```

Permissions Policy shall permit camera/NFC only where required.

---

# 49. Content Security Policy

The CSP shall explicitly permit required Google authentication endpoints and Drive communication.

The policy shall otherwise restrict:

- scripts;
- frames;
- connections;
- image sources.

Inline arbitrary JavaScript shall be avoided.

---

# 50. Logging

Server logs may record:

- request method;
- API path;
- status code;
- duration;
- application errors;
- application version.

Logs shall not contain:

- Google OAuth tokens;
- `Authorization` headers;
- complete inventory payloads;
- image contents;
- personal Google account credentials.

Validation error messages may record structural errors without recording the entire inventory document.

---

# 51. Client Logging

Web and Android production builds shall avoid logging:

- access tokens;
- Google API responses containing sensitive information;
- inventory contents;
- image data.

Debug builds may provide additional diagnostics but shall still never deliberately log OAuth access or refresh tokens.

---

# 52. No Offline Operation

In accordance with the Functional Specification, offline operation is not required.

The application shall therefore assume network connectivity is required for:

- login;
- library loading;
- box loading;
- search refresh;
- editing;
- image upload.

The client may temporarily maintain information in memory while the application is running.

A failure to reach Google Drive shall produce a clear network/error state rather than presenting stale information as current.

---

# 53. Client Cache

Temporary runtime caching is permitted for:

- Box index;
- inventory documents;
- thumbnails;
- search index.

Persistent offline inventory caching is not required.

Sensitive data should preferably be cleared when the user signs out.

---

# 54. Root Folder Selection

On first use the application shall ask the user to:

```text
Select Box Storage Folder
```

or:

```text
Create Box Storage Folder
```

The selected Drive folder ID may be retained as local application configuration on that device, scoped by the authenticated Drive account. Client IDs, billing information and Google credentials shall not be requested from ordinary users during root setup.

This is not an OAuth credential.

The user shall be able to change the selected Box Storage Root from Settings.

---

# 55. Multiple Google Accounts

The system shall support users who have multiple Google accounts.

The active Box Storage library shall belong to the currently authenticated account.

Changing account shall:

1. clear the current runtime inventory/search state;
2. authenticate the selected Google account;
3. load that account's configured Box Storage Root.

Libraries belonging to different Google accounts shall not be merged automatically.

All these accounts shall use the same configured application registration. Account/root changes shall cancel pending work, ignore old responses and clear runtime documents/search/photo state without altering the deployment client ID. Shared application registration shall not grant access to another account's unshared library.

---

# 56. Library Loading

Startup flow:

```text
Start Application
       ↓
Google authenticated?
   ┌───┴─────┐
   │         │
  No        Yes
   │         │
Login        │
   └────┬────┘
        ↓
Root configured?
   ┌────┴────┐
   │         │
  No        Yes
   │         │
Select Root │
   └────┬────┘
        ↓
Load box-storage-index.json
        ↓
Display Library
```

---

# 57. Index Recovery

The root index improves performance but shall not be the sole source of truth.

If:

```text
box-storage-index.json
```

is missing or damaged, the client shall provide:

```text
Rebuild Library Index
```

The rebuild process shall:

1. recursively inspect Box Storage folders;
2. locate `inventory.json`;
3. read Box IDs;
4. reconstruct the index;
5. identify duplicate Box IDs;
6. identify invalid inventories;
7. write a replacement index after confirmation.

---

# 58. Deleted or Missing Boxes

If the index refers to a folder which no longer exists, the application shall mark the entry as unavailable.

The application may offer:

```text
Remove missing box from index
```

It shall not automatically remove references without informing the user.

---

# 59. Schema Versioning

Both:

```text
inventory.json
box-storage-index.json
```

shall contain:

```json
"schemaVersion": 1
```

Clients shall inspect this value before editing.

If a client encounters a newer unsupported schema, it shall allow read-only handling where practical but shall not overwrite the file.

Example:

```text
This inventory was created by a newer version of Box Storage.
Update the application before editing.
```

---

# 60. API Versioning

Server APIs shall use URL versioning:

```text
/api/v1/
```

Breaking API changes shall require:

```text
/api/v2/
```

The server may temporarily operate multiple API versions during Android application migration.

---

# 61. Application Version Compatibility

The configuration endpoint should expose:

```json
{
  "apiVersion": "v1",
  "minimumAndroidVersion": "1.0.0",
  "minimumWebVersion": "1.0.0"
}
```

This allows the Android application to provide a meaningful update message if an API becomes incompatible.

---

# 62. Error Model

API errors shall use a common structure.

Example:

```json
{
  "error": {
    "code": "INVALID_INVENTORY",
    "message": "Inventory validation failed",
    "details": []
  }
}
```

Standard HTTP status codes shall be used.

Examples:

```text
200 Success
400 Invalid request
404 Resource not found
409 Conflict
422 Validation failure
429 Rate limited
500 Internal error
503 Service unavailable
```

---

# 63. Google Drive Rate Handling

Drive quotas apply at application-project and per-user/per-project levels. A shared registration therefore requires operator quota monitoring and bounded client requests; it shall not require each user to create a separately billed project. Rate/limit errors shall not trigger a payment-card onboarding flow. Current limits and pricing shall be checked before publishing; local rate counters are not a guarantee against project-level charges.

Clients shall handle Google API rate limitations gracefully.

The implementation shall use:

- paginated requests;
- minimal requested fields;
- exponential backoff;
- retry for appropriate transient errors.

Bulk library loading shall avoid repeatedly downloading unchanged images.

---

# 64. Thumbnails

Stage 6 implementation note (4 October 2026): list views currently show metadata/photo
counts and retrieve full images only on explicit request. List thumbnails remain an
acceptance gap. Google documents private `thumbnailLink` values as short-lived and
unsuitable for direct web use because of CORS, recommending a proxy. This application
excludes server-side Google token/image proxying; a compatible client-only thumbnail
strategy must be verified before claiming thumbnail support. See [Stage 6 findings](stage-6-findings.md)
and [Google Drive files reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).

Library/search views should use thumbnails rather than full-resolution photographs.

Full-resolution images shall only be retrieved where required.

This reduces:

- data transfer;
- load time;
- memory consumption;
- Google Drive API usage.

---

# 65. Accessibility

Web and Android interfaces should provide:

- scalable text;
- accessible labels;
- suitable touch target sizes;
- keyboard navigation on web;
- screen-reader descriptions;
- text alternatives for important icon-only actions.

Scanning shall not be the only method for opening a box.

Boxes shall always be accessible through normal search/browse functionality.

---

# 66. Testing Strategy

Testing shall include:

### Unit tests

- JSON validation;
- Box ID handling;
- NFC ID normalisation;
- QR URL parsing;
- search;
- index manipulation;
- schema migration.

### Integration tests

- Google authentication;
- Drive folder discovery;
- inventory loading;
- inventory editing;
- image upload;
- conflict detection.

### Web tests

- Chrome desktop;
- Chrome Android;
- Firefox;
- Edge;
- camera scanning;
- responsive layouts.

### Android tests

- NFC enabled;
- NFC disabled;
- device without NFC;
- camera permission granted/denied;
- multiple Google accounts;
- interrupted network.

---

# 67. NFC Testing

Tests shall include:

- known registered tag;
- unknown tag;
- duplicate tag;
- replacement tag;
- malformed/unsupported tag;
- tag already assigned to another box.

Native Android NFC shall be considered the reference implementation.

Web NFC capability shall be treated separately because browser support differs.

---

# 68. QR Testing

Tests shall include:

- valid Box Storage URL;
- unknown Box ID;
- invalid UUID;
- unrelated website URL;
- plain text;
- malformed QR;
- QR for a different Box Storage deployment.

Untrusted QR URLs shall not be automatically opened externally.

---

# 69. Docker Health Check

The container shall implement a health check against:

```text
/api/v1/health
```

Example:

```yaml
healthcheck:
  test:
    - CMD
    - curl
    - -f
    - http://localhost:8080/api/v1/health
  interval: 30s
  timeout: 5s
  retries: 3
```

---

# 70. Container Security

The final application container shall:

- run as a non-root user;
- contain only required runtime dependencies;
- use a minimal production base image;
- expose only the application port;
- not mount the Docker socket;
- not require privileged mode;
- not require host filesystem access.

---

# 71. Configuration

Configuration shall be supplied through environment variables.

Example:

```text
APP_NAME
PUBLIC_URL
GOOGLE_WEB_CLIENT_ID
API_PORT
LOG_LEVEL
ALLOWED_ORIGINS
ENABLE_WEB_NFC
```

No Google user's OAuth tokens shall appear in configuration.

`GOOGLE_WEB_CLIENT_ID` shall represent operator-managed web registration shared by users. Cloud billing credentials, Google account passwords and per-user OAuth configuration shall not be application settings. An independent operator shall ensure its exact deployment origin is authorized under its registration.

---

# 72. Secrets

The application source repository shall contain:

```text
.env.example
```

but shall not contain deployed secrets.

The web OAuth client ID may be public because the browser necessarily receives it. It does not grant Drive access without each user's Google authorization, and shall not be replaced by a shared Google account/password or service-account credential. Neither web nor native users shall need an application client secret.

Private server configuration, if subsequently introduced, shall use:

- Docker secrets;
- environment injection;
- external secret management.

---

# 73. Backup Strategy

No separate server inventory backup mechanism is required for version 1 because Google Drive remains the authoritative data store.

Backup therefore concerns the user's Google Drive contents.

The application design shall ensure that a complete library can be reconstructed from:

```text
folders
+ inventory.json
+ photographs
```

The root index is rebuildable and shall not represent irreplaceable data.

---

# 74. Portability

A primary design goal is that another person can deploy the software without giving the original developer access to their Google account.

Deployment shall therefore consist of:

```text
Docker image
+
configuration
+
Google OAuth application configuration
```

The user authenticates their own Google account directly.

OAuth application setup is performed by the deployment operator/publisher. Ordinary users of an already configured deployment need no Cloud project, project membership or payment-card setup. An independent operator can own a separate project, or use a publisher's registration only when that publisher explicitly authorizes and trusts the deployment origin. Registration ownership does not itself expose user tokens or grant access to user libraries.

There shall be no central Box Storage account controlled by the software author.

---

# 75. Repository Separation

Two repositories are recommended.

## Repository 1

```text
box-storage-server
```

Contains:

- Docker configuration;
- FastAPI backend;
- React web client;
- shared JSON schemas;
- OpenAPI definition;
- server documentation.

## Repository 2

```text
box-storage-android
```

Contains:

- native Android application;
- Android Google authentication;
- Drive client;
- Box Storage API client;
- NFC implementation;
- QR implementation.

---

# 76. Shared Contracts

The server repository should publish versioned copies of:

```text
inventory.schema.json
box-index.schema.json
openapi.json
```

The Android project shall consume or mirror these.

Changes to these contracts shall be treated as interface changes between the two development projects.

---

# 77. Recommended Server Repository Layout

```text
box-storage-server/
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── main.py
│   │
│   └── tests/
│
├── frontend/
│   ├── src/
│   ├── public/
│   └── tests/
│
├── schemas/
│   ├── inventory.schema.json
│   └── box-index.schema.json
│
├── docker/
├── Dockerfile
├── compose.yaml
├── .env.example
└── README.md
```

---

# 78. Recommended Android Repository Layout

```text
box-storage-android/
│
├── app/
│   └── src/
│       ├── main/
│       ├── test/
│       └── androidTest/
│
├── schemas/
├── gradle/
├── build.gradle.kts
├── settings.gradle.kts
└── README.md
```

---

# 79. Server Responsibilities

The Docker application **shall** be responsible for:

- serving the web frontend;
- API versioning;
- shared schema validation;
- QR generation;
- optional stateless search processing;
- application configuration;
- OpenAPI contract;
- health monitoring.

The Docker application **shall not**:

- authenticate to a user's Drive on their behalf;
- receive Google access tokens;
- store Google refresh tokens;
- maintain a central copy of inventories;
- require access to users' Google accounts.

---

# 80. Web Client Responsibilities

The web client shall:

- authenticate with Google;
- access Drive directly;
- select/configure the Box Storage root;
- read the Box Storage index;
- display folders/boxes;
- load inventories;
- load photographs;
- search;
- edit inventories;
- upload photographs;
- scan QR codes;
- use Web NFC where supported;
- communicate with the Box Storage API for shared application services.

---

# 81. Android Client Responsibilities

The Android application shall:

- authenticate with Google;
- access Google Drive directly;
- browse boxes;
- search inventories;
- edit inventories;
- upload photographs;
- take photographs;
- scan QR codes;
- read NFC tag IDs natively;
- resolve NFC identifiers to Box IDs;
- interact with the shared Box Storage API;
- honour the same JSON schemas as the web application.

---

# 82. Privacy Boundary

The trust boundary shall be explicitly documented.

```text
USER'S GOOGLE DATA
        │
        │ OAuth token
        ▼
┌─────────────────┐
│ Browser/Android │
└────────┬────────┘
         │
         │ Application-level request only
         │ NO Google token
         ▼
┌─────────────────┐
│ Box Storage API │
└─────────────────┘
```

This architecture is an intentional privacy property of the system and shall not be changed casually during future development.

Any proposal to proxy Google Drive through the server shall be considered a significant architectural and security change.

---

# 83. Primary Development Sequence

## Phase 1 — Shared data model

Implement:

```text
inventory.schema.json
box-index.schema.json
Box ID
NFC ID normalisation
QR URL specification
```

## Phase 2 — Docker API

Implement:

```text
FastAPI
health
config
validation
QR generation
OpenAPI
Docker build
```

## Phase 3 — Web application

Implement:

```text
Google authentication
Drive root selection
library browsing
box display
search
QR scanning
editing
image management
Web NFC
```

## Phase 4 — Android application

Implement:

```text
Google authentication
Drive repository
library
search
box display
editing
camera
QR
native NFC
API integration
```

## Phase 5 — Deployment/security

Implement:

```text
reverse proxy
HTTPS
CSP
logging
container hardening
production configuration
```

---

# 84. Acceptance Architecture

The technical implementation shall be considered compliant when all of the following are true:

1. The Docker application can be deployed independently using Docker Compose.

2. The web application is served by the Docker deployment.

3. The Android application is a separate project.

4. Web and Android clients can authenticate with Google.

5. Google Drive contents are accessed directly by the clients.

6. Google OAuth access and refresh tokens never pass through or persist on the Box Storage server.

7. A Drive folder containing `inventory.json` and photographs represents a physical box.

8. Every box has an immutable Box ID.

9. QR codes resolve to Box IDs through application URLs.

10. Native Android NFC resolves tag IDs to Box IDs.

11. Supported web browsers may also resolve NFC serial numbers.

12. Boxes can be located by browsing, search, QR or NFC.

13. Inventories can be edited by both web and Android clients.

14. Photographs can be added to individual inventory items.

15. The Box Storage Root index provides rapid resolution of Box and NFC IDs.

16. The root index can be reconstructed from the box folders.

17. The server requires no central inventory database.

18. The complete inventory remains portable as ordinary Google Drive folders, JSON files and photographs.

19. A third party can deploy the application and use their own Google account without granting the software author access to that Drive.

20. The Android and Docker/web projects can be developed independently against the published JSON schemas and OpenAPI contract.

21. At least two ordinary Google accounts without Cloud project membership or billing setup can authorize the same configured web application, keep separate account/root contexts, and cannot access each other's unshared files. The native project shall demonstrate equivalent onboarding through its registered Android identity. Mock tests alone do not close this live acceptance criterion.

22. Operator/publisher registration, authorized origins/native identities, quotas and applicable verification are documented separately from user onboarding. No ordinary-user flow requires Cloud Console, OAuth client creation or payment-card entry.

---

# 85. Final Architectural Summary

The resulting design is deliberately **client-to-Google rather than server-to-Google**.

```text
                  GOOGLE DRIVE
                   ▲         ▲
                  /           \
             OAuth/API      OAuth/API
                /               \
               /                 \
        WEB APPLICATION      ANDROID APP
               \                 /
                \               /
                 └───── API ───┘
                       │
                BOX STORAGE SERVER
                       │
             No Google credentials
             No Drive token storage
             No inventory database
```

This provides the required Box Storage functionality while preserving the key portability and privacy requirement that the Docker server is not entrusted with long-term—or transient—Google Drive credentials.

It also establishes a clean separation between the two development projects while giving both implementations a common storage format and API contract.
