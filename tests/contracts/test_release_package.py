import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]


def test_versioned_handoff_is_reproducible_and_hash_verified(tmp_path):
    packages = [tmp_path / "first.zip", tmp_path / "second.zip"]
    for package in packages:
        subprocess.run([sys.executable, "tools/release_contracts.py", "--check", "--output", str(package)], cwd=ROOT, check=True, capture_output=True)
    assert packages[0].read_bytes() == packages[1].read_bytes()
    with ZipFile(packages[0]) as package:
        manifest = json.loads(package.read("api/v1/contract-manifest.json"))
        assert manifest["productionWritesVerified"] is False
        assert manifest["schemaVersions"] == [1]
        assert "docs/client-integration.md" in manifest["files"]
        for name, digest in manifest["files"].items():
            assert hashlib.sha256(package.read(name)).hexdigest() == digest
        assert not any(name.startswith(".env") for name in package.namelist())
