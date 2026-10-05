import logging

import uvicorn

from backend.app.config import Settings


def main() -> None:
    settings = Settings()
    logging.basicConfig(level=settings.log_level, format="%(levelname)s %(name)s %(message)s")
    uvicorn.run(
        "backend.app.main:create_app",
        factory=True,
        host=settings.api_host,
        port=settings.api_port,
        log_level=settings.log_level.lower(),
        access_log=False,
        proxy_headers=False,
    )


if __name__ == "__main__":
    main()
