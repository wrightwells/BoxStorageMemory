# Compatibility policy — 1.0.0

This release supports API `v1` and numeric inventory/index schemaVersion `1`. API paths carry the API major version; the OpenAPI application version is `1.0.0`. Released artifacts live under `api/v1` and `schemas/v1`; root schema/OpenAPI aliases are byte-identical current copies. SHA-256 manifests verify their content. Synthetic fixtures specify structural, format, domain, cross-record and identifier semantics.

A compatible client enforces both JSON Schema Draft 2020-12 and domain constraints, preserves unknown extension fields and permanent identity, and never overwrites unsupported newer schemas. Adding optional fields must not invalidate older clients' preservation behavior. Breaking API/record changes require a new version and documented migration; no migration or automatic downgrade exists in this release. Public configuration declares minimum web/Android client versions and supported schema versions, not a write capability guarantee.

Google browser policies, grants, file permissions and device capabilities remain runtime dependencies. Do not infer support from a browser name or a matching application version. Drive write/creation/tag/cleanup gates remain closed until their exact independent-client semantics have been proven. A separately developed client must apply the same controls or remain read-only.

A deployment replacement retaining the canonical public origin and the same Drive root preserves UUID links/labels. Another origin requires retained controlled-domain redirects or regenerated labels; never automatically broaden scanner trust. Folder IDs can change during a Drive restore/copy: rebuild the derived index against current folders without renumbering/reidentifying inventories.
