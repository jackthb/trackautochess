"""Image cropping utilities for focusing the vision model on relevant regions."""

import base64
import io
from pathlib import Path

from PIL import Image


def _encode(img: Image.Image, quality: int = 95) -> str:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality)
    return base64.standard_b64encode(buf.getvalue()).decode()


def synergy_crops_b64(image_path: Path) -> list[str]:
    """
    Return two crops, one per end-screen type, so the synergy detection call
    can pick whichever one actually contains synergy badges.

    Crop 1 — GAME OVER table synergy column (x 28–52%, y 11–24%):
        Jack's row in the results table. The Synergies column sits here with
        5 icon+count badges clearly visible at this zoom level.

    Crop 2 — Final Ranking floating badges (x 12–45%, y 32–58%):
        In the Final Ranking overlay the synergy count badges float over the
        board below the player name label (e.g. jack's "(4)(2)(2)(2)(1)").
    """
    img = Image.open(image_path)
    w, h = img.size

    table_syn   = img.crop((int(w * 0.28), int(h * 0.11), int(w * 0.52), int(h * 0.24)))
    board_float = img.crop((int(w * 0.12), int(h * 0.32), int(w * 0.45), int(h * 0.58)))

    return [_encode(table_syn), _encode(board_float)]
