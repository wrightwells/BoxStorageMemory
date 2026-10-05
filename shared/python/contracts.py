"""Version 1 identifier, schema and domain rules. Never performs network I/O."""

from copy import deepcopy
from datetime import datetime
import math
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
NUMBER = re.compile(r"BOX-(?=[0-9]*[1-9])(?:[0-9]{4}|[1-9][0-9]{4,8})")

FORMAT_CHECKER = FormatChecker()


@FORMAT_CHECKER.checks("date-time")
def valid_datetime(value):
    # Do not silently skip date checking when optional jsonschema extras are absent.
    if not isinstance(value, str):
        return True
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).tzinfo is not None
    except ValueError:
        return False


def normalize_nfc(value):
    if not isinstance(value, str):
        raise ValueError("INVALID_NFC_ID")
    raw = value.strip(" \t\r\n\v\f")
    # Accept raw hex or consistently separated pairs; never strip arbitrary text.
    if re.fullmatch(r"(?:[0-9a-fA-F]{2}){1,32}", raw):
        return raw.upper()
    for separator in (":", "-", " "):
        if re.fullmatch(r"[0-9a-fA-F]{2}(?:" + re.escape(separator) + r"[0-9a-fA-F]{2}){1,31}", raw):
            return raw.replace(separator, "").upper()
    raise ValueError("INVALID_NFC_ID")


def normalize_box_number(value):
    if not isinstance(value, str):
        raise ValueError("INVALID_BOX_NUMBER")
    raw = value.strip(" \t\r\n\v\f").upper()
    if not re.fullmatch(r"BOX-[0-9]{1,9}", raw):
        raise ValueError("INVALID_BOX_NUMBER")
    number = int(raw[4:])
    if number < 1:
        raise ValueError("INVALID_BOX_NUMBER")
    return f"BOX-{number:04d}"


def public_origin(value):
    if not isinstance(value, str) or re.search(r"[\s\\?#]", value):
        raise ValueError("INVALID_PUBLIC_URL")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        raise ValueError("INVALID_PUBLIC_URL") from None
    host = parsed.hostname
    if not host or parsed.username is not None or parsed.password is not None or parsed.path not in ("", "/"):
        raise ValueError("INVALID_PUBLIC_URL")
    if not re.fullmatch(r"[a-zA-Z0-9.-]+|::1", host) or (port is not None and not 1 <= port <= 65535):
        raise ValueError("INVALID_PUBLIC_URL")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and host in ("localhost", "127.0.0.1", "::1")):
        raise ValueError("INVALID_PUBLIC_URL")
    authority = f"[{host}]" if host == "::1" else host.lower()
    if host != "::1" and host.split(".")[-1].isdigit():
        parts = host.split(".")
        if len(parts) != 4 or any(not p.isdigit() or str(int(p)) != p or not 0 <= int(p) <= 255 for p in parts):
            raise ValueError("INVALID_PUBLIC_URL")
    if port is not None and port != (443 if parsed.scheme == "https" else 80):
        authority += f":{port}"
    default_port = 443 if parsed.scheme == "https" else 80
    bare_host = f"[{host}]" if host == "::1" else host.lower()
    if parsed.netloc.lower() not in (authority, f"{bare_host}:{default_port}"):
        raise ValueError("INVALID_PUBLIC_URL")
    return f"{parsed.scheme}://{authority}"


def qr_url(public_url, box_id):
    if not isinstance(box_id, str) or not UUID.fullmatch(box_id):
        raise ValueError("INVALID_BOX_ID")
    return f"{public_origin(public_url)}/box/{box_id}"


def parse_qr(value, public_url):
    origin = public_origin(public_url)
    if not isinstance(value, str) or not value.startswith(origin + "/box/"):
        raise ValueError("INVALID_QR_URL")
    box_id = value[len(origin + "/box/"):]
    if not UUID.fullmatch(box_id) or value != qr_url(origin, box_id):
        raise ValueError("INVALID_QR_URL")
    return box_id


def schema_mode(document):
    version = document.get("schemaVersion") if isinstance(document, dict) else None
    integer = type(version) is int or (type(version) is float and math.isfinite(version) and version.is_integer())
    if integer and version == 1:
        return "supported"
    if integer and version > 1:
        return "read-only"
    return "invalid"


def issue(path, code):
    return {"path": path, "code": code}


def pointer(parts):
    return "".join("/" + str(part).replace("~", "~0").replace("/", "~1") for part in parts)


def _duplicates(records, field, prefix, code):
    seen = set()
    errors = []
    for index, record in enumerate(records):
        value = record[field]
        if value in seen:
            errors.append(issue(f"{prefix}/{index}/{field}", code))
        seen.add(value)
    return errors


def domain_errors(kind, document):
    """Call only after successful structural validation."""
    if kind == "inventory":
        errors = _duplicates(document["items"], "id", "/items", "DUPLICATE_ITEM_ID")
        # Compare parsed instants, not variable-length fractional strings.
        created = datetime.fromisoformat(document["box"]["created"].replace("Z", "+00:00"))
        modified = datetime.fromisoformat(document["box"]["modified"].replace("Z", "+00:00"))
        if modified < created:
            errors.append(issue("/box/modified", "INVALID_TIMESTAMP_ORDER"))
        seen_images = set()
        for i, item in enumerate(document["items"]):
            for j, image in enumerate(item.get("images", [])):
                if image in seen_images:
                    errors.append(issue(f"/items/{i}/images/{j}", "IMAGE_HAS_MULTIPLE_OWNERS"))
                seen_images.add(image)
    else:
        errors = []
        for field, code in (("boxId", "DUPLICATE_BOX_ID"), ("boxNumber", "DUPLICATE_BOX_NUMBER"), ("driveFolderId", "DUPLICATE_FOLDER_ID")):
            errors.extend(_duplicates(document["boxes"], field, "/boxes", code))
        seen_nfc = set()
        for i, box in enumerate(document["boxes"]):
            for j, uid in enumerate(box["nfcIds"]):
                if uid in seen_nfc:
                    errors.append(issue(f"/boxes/{i}/nfcIds/{j}", "DUPLICATE_NFC_ID"))
                seen_nfc.add(uid)
    return sorted(errors, key=lambda e: (e["path"], e["code"]))


class ContractValidator:
    def __init__(self, schema_dir=None):
        directory = Path(schema_dir) if schema_dir else ROOT / "schemas/v1"
        self.validators = {}
        for kind, filename in (("inventory", "inventory.schema.json"), ("index", "box-index.schema.json")):
            schema = json.loads((directory / filename).read_text())
            Draft202012Validator.check_schema(schema)
            self.validators[kind] = Draft202012Validator(schema, format_checker=FORMAT_CHECKER)

    def validate(self, kind, document):
        errors = [issue(pointer(e.absolute_path), "SCHEMA_VIOLATION") for e in self.validators[kind].iter_errors(document)]
        # Semantic checks need structurally valid inputs.
        if not errors:
            errors = domain_errors(kind, document)
        unique = {(e["path"], e["code"]) for e in errors}
        errors = [issue(p, c) for p, c in sorted(unique)]
        return {"valid": not errors, "errors": errors}

    def validate_library(self, index, inventories):
        """inventories maps Drive folder IDs to parsed inventories; no Drive access."""
        errors = self.validate("index", index)["errors"]
        if errors:
            return {"valid": False, "errors": errors}
        for i, entry in enumerate(index["boxes"]):
            inventory = inventories.get(entry["driveFolderId"])
            base = f"/boxes/{i}"
            if inventory is None:
                errors.append(issue(base, "MISSING_INVENTORY"))
                continue
            if not self.validate("inventory", inventory)["valid"]:
                errors.append(issue(base, "INVALID_INVENTORY"))
                continue
            box = inventory["box"]
            for key, inventory_key in (("boxId", "id"), ("boxNumber", "number"), ("name", "name"), ("location", "location")):
                if entry.get(key, "") != box.get(inventory_key, ""):
                    errors.append(issue(base + "/" + key, "INDEX_MISMATCH"))
            if sorted(entry["nfcIds"]) != sorted(box["nfcIds"]):
                errors.append(issue(base + "/nfcIds", "INDEX_MISMATCH"))
        for folder_id in inventories:
            if folder_id not in {b["driveFolderId"] for b in index["boxes"]}:
                errors.append(issue("/boxes", "UNINDEXED_INVENTORY"))
        errors = sorted(errors, key=lambda e: (e["path"], e["code"]))
        return {"valid": not errors, "errors": errors}


def edit_item(document, item_id, changes):
    """Copy the source document, changing only known mutable fields of one item."""
    validator = ContractValidator()
    if schema_mode(document) != "supported" or not validator.validate("inventory", document)["valid"]:
        raise ValueError("UNEDITABLE_INVENTORY")
    allowed = {"name", "quantity", "description", "tags", "images", "notes"}
    if not isinstance(changes, dict) or not set(changes) <= allowed:
        raise ValueError("INVALID_ITEM_EDIT")
    result = deepcopy(document)
    target = next((item for item in result["items"] if item["id"] == item_id), None)
    if target is None:
        raise ValueError("ITEM_NOT_FOUND")
    target.update(deepcopy(changes))
    if not validator.validate("inventory", result)["valid"]:
        raise ValueError("INVALID_ITEM_EDIT")
    return result
