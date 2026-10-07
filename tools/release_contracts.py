"""Reproducible independent-client contract package; no credentials or user records."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "api/v1/contract-manifest.json"


def files() -> list[Path]:
    result = [ROOT / name for name in [
        "api/v1/openapi.json", "docs/client-integration.md", "docs/compatibility.md",
        "docs/contracts.md", "docs/api.md", "requirements-contracts.txt",
        "docs/performance-review.md", "docs/performance-review-prompt.md",
        "docs/deployment.md", "docs/release-acceptance.md", "docs/qr-nfc.md",
        "docs/deployment-test-2026-10-04.md", "docs/live-box-creation-test.md", "docs/live-item-save-test.md", "docs/live-photo-management-test.md",
        "docs/google-setup.md", "docs/library.md", "docs/photos.md", "docs/editing.md",
        "docs/release-notes-1.0.0.md", "docs/decisions/004-writes-and-recovery.md",
        "docs/decisions/006-application-oauth-registration.md",
        "shared/python/contracts.py", "shared/typescript/contracts.ts", "shared/typescript/contract-core.ts", "shared/typescript/models.ts",
        "tools/smoke_api.py", "tools/check_running_openapi.py", "tools/release_contracts.py", "tools/smoke_http.py",
    ]]
    for directory in ["schemas/v1", "fixtures/contracts", "examples/library", "docs/performance"]:
        result.extend((ROOT / directory).rglob("*.json"))
    result.extend((ROOT / "docs/decisions").glob("*.md"))
    return sorted(set(result), key=lambda path: path.relative_to(ROOT).as_posix())


def manifest() -> dict[str, object]:
    return {"releaseVersion": "1.0.0", "apiVersion": "v1", "schemaVersions": [1],
            "productionWritesVerified": False, "creationWritesVerified": True, "editingWritesVerified": True, "photoWritesVerified": True,
            "files": {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                      for path in files()}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    document = json.dumps(manifest(), indent=2, sort_keys=True) + "\n"
    if args.check:
        assert MANIFEST.read_text() == document, "Contract manifest is stale; run tools/release_contracts.py"
    else:
        MANIFEST.write_text(document)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(args.output, "w", compression=ZIP_DEFLATED) as archive:
            for path in [*files(), MANIFEST]:
                info = ZipInfo(path.relative_to(ROOT).as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                archive.writestr(info, path.read_bytes())
        print(f"Contract package written: {args.output}")
    print("Versioned contract manifest verified.")


if __name__ == "__main__":
    main()
