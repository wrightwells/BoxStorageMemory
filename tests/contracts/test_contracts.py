from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

from shared.python.contracts import ContractValidator, edit_item
from tools.contract_results import load, results

ROOT = Path(__file__).resolve().parents[2]


class ContractTests(unittest.TestCase):
    def test_shared_vectors(self):
        actual = results()
        for case in load("cases.json") + load("library-cases.json"):
            with self.subTest(case=case["name"]):
                expected = {"error": case["error"]} if "error" in case else {"result": case["expected"]}
                self.assertEqual(actual[case["name"]], expected)

    def test_versioned_publication(self):
        for name in ("inventory", "box-index"):
            self.assertEqual((ROOT / f"schemas/{name}.schema.json").read_bytes(), (ROOT / f"schemas/v1/{name}.schema.json").read_bytes())
        manifest = json.loads((ROOT / "schemas/v1/manifest.json").read_text())
        for published in manifest["schemas"]:
            data = (ROOT / "schemas/v1" / published["file"]).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), published["sha256"])
            self.assertEqual(json.loads(data)["$id"], published["id"])

    def test_edit_preserves_extensions_without_mutating_source(self):
        document = load("unknown-fields.json")
        original = deepcopy(document)
        edited = edit_item(document, document["items"][0]["id"], {"quantity": 2})
        self.assertEqual(document, original)
        self.assertEqual(edited["futureRoot"], original["futureRoot"])
        self.assertEqual(edited["box"]["futureBox"], original["box"]["futureBox"])
        self.assertEqual(edited["items"][0]["futureItem"], original["items"][0]["futureItem"])
        self.assertEqual(edited["items"][0]["quantity"], 2)

    def test_identity_and_newer_version_are_uneditable(self):
        document = load("valid-inventory.json")
        with self.assertRaisesRegex(ValueError, "INVALID_ITEM_EDIT"):
            edit_item(document, document["items"][0]["id"], {"id": "different"})
        document["schemaVersion"] = 2
        with self.assertRaisesRegex(ValueError, "UNEDITABLE_INVENTORY"):
            edit_item(document, document["items"][0]["id"], {"name": "changed"})


if __name__ == "__main__":
    unittest.main()
