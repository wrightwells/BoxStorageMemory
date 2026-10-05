import io
from typing import Literal

import qrcode
from qrcode.image.pil import PilImage

from backend.app.models.utilities import ValidationIssue, ValidationResponse
from shared.python.contracts import ContractValidator, qr_url


class UtilityService:
    def __init__(self) -> None:
        self.validator = ContractValidator()

    def validate(self, kind: Literal["inventory", "index"], document: object) -> ValidationResponse:
        result = self.validator.validate(kind, document)
        return ValidationResponse(
            valid=result["valid"],
            errors=[
                ValidationIssue(
                    path=error["path"],
                    code=error["code"],
                    message=error["code"].replace("_", " ").capitalize(),
                )
                for error in result["errors"]
            ],
        )

    def qr(self, public_url: str, box_id: str) -> bytes:
        return self._qr_image(qr_url(public_url, box_id))

    def drive_folder_qr(self, folder_id: str) -> bytes:
        return self._qr_image("https://drive.google.com/drive/folders/" + folder_id)

    def _qr_image(self, url: str) -> bytes:
        code = qrcode.QRCode(
            error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=4
        )
        code.add_data(url)
        code.make(fit=True)
        output = io.BytesIO()
        code.make_image(image_factory=PilImage, fill_color="black", back_color="white").save(
            output, format="PNG"
        )
        return output.getvalue()
