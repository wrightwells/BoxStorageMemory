"""Export or check the deployment-independent v1 HTTP contract."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.config import Settings  # noqa: E402
from backend.app.main import create_app  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    content = json.dumps(create_app(Settings(_env_file=None)).openapi(), indent=2, sort_keys=True) + '\n'
    for path in [ROOT / 'openapi.json', ROOT / 'api/v1/openapi.json']:
        if args.check:
            if not path.exists() or path.read_text() != content:
                raise SystemExit(f'OpenAPI export is stale: {path.relative_to(ROOT)}')
        else:
            path.write_text(content)


if __name__ == '__main__':
    main()
