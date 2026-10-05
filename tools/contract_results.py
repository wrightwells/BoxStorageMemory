"""Emit fixture results for independent Python/TypeScript parity checking."""

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from shared.python.contracts import (  # noqa: E402
    ContractValidator, edit_item, normalize_box_number, normalize_nfc,
    parse_qr, public_origin, schema_mode,
)

FIXTURES = ROOT / "fixtures/contracts"


def load(name):
    return json.loads((FIXTURES / name).read_text())


def results():
    validator = ContractValidator()
    output = {}
    for case in load("cases.json"):
        try:
            action = case["action"]
            if action == "validate":
                result = validator.validate(case["kind"], load(case["file"]))
            elif action == "nfc":
                result = normalize_nfc(case["input"])
            elif action == "number":
                result = normalize_box_number(case["input"])
            elif action == "qr":
                result = parse_qr(case["input"], case["publicUrl"])
            elif action == "origin":
                result = public_origin(case["input"])
            elif action == "mode":
                result = schema_mode(case["input"])
            else:
                raise RuntimeError("Unknown fixture action")
            output[case["name"]] = {"result": result}
        except ValueError as e:
            output[case["name"]] = {"error": str(e)}
    for case in load("library-cases.json"):
        data = load(case["file"])
        output[case["name"]] = {"result": validator.validate_library(data["index"], data["inventories"])}
    document = load("unknown-fields.json")
    output["edit-preserves-extensions"] = {"result": edit_item(document, document["items"][0]["id"], {"name": "Updated extension lead", "quantity": 2})}
    return output


if __name__ == "__main__":
    print(json.dumps(results(), sort_keys=True))
