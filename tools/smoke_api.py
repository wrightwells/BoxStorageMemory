"""Token-free HTTP contract smoke check; stdlib only, usable by separate clients."""
import json
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    origin = sys.argv[1].rstrip('/')

    def call(path: str, document: object = None, post: bool = False) -> tuple[int, bytes, str]:
        body = json.dumps(document).encode() if post else None
        request = Request(origin + path, data=body, headers={'Content-Type': 'application/json'})
        try:
            response = urlopen(request, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.read(), response.headers.get('Content-Type', '')

    status, body, _ = call('/api/v1/config')
    assert status == 200 and json.loads(body)['compatibility']['supportedSchemaVersions'] == [1]
    for kind, name in [('inventory', 'inventory'), ('index', 'box-index')]:
        status, body, _ = call('/api/v1/schema/' + kind)
        assert status == 200 and json.loads(body) == json.loads((ROOT / 'schemas/v1' / (name + '.schema.json')).read_text())
        document = json.loads((ROOT / 'fixtures/contracts' / ('valid-' + kind + '.json')).read_text())
        status, body, _ = call('/api/v1/validate/' + kind, document, True)
        assert status == 200 and json.loads(body) == {'valid': True, 'errors': []}
    status, body, _ = call('/api/v1/validate/index', {}, True)
    assert status == 200 and json.loads(body)['valid'] is False
    status, body, content_type = call('/api/v1/qr/generate', {'boxId': '12345678-1234-4234-8234-123456789abc'}, True)
    assert status == 200 and content_type == 'image/png' and body.startswith(b'\x89PNG\r\n\x1a\n')
    status, body, _ = call('/api/v1/qr/generate', {'boxId': 'invalid'}, True)
    assert status == 422 and json.loads(body)['error']['code'] == 'INVALID_REQUEST'
    status, body, _ = call('/api/openapi.json')
    assert status == 200 and json.loads(body) == json.loads((ROOT / 'api/v1/openapi.json').read_text())
    print('Stage 4 HTTP contract smoke passed')


if __name__ == '__main__':
    main()
