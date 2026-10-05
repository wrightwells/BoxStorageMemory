"""Compare the running token-free API with the released OpenAPI document."""
import json
import sys
from pathlib import Path
from urllib.request import urlopen

origin = sys.argv[1].rstrip("/")
with urlopen(origin + "/api/openapi.json", timeout=10) as response:
    actual = json.load(response)
expected = json.loads((Path(__file__).resolve().parents[1] / "api/v1/openapi.json").read_text())
assert actual == expected, "Running API differs from released OpenAPI"
print("Running OpenAPI matches the released contract.")
