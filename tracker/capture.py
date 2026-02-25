"""Fullscreen screenshot capture using mss."""

from datetime import datetime
from pathlib import Path

import mss
import mss.tools


SCREENSHOTS_DIR = Path.home() / ".dac" / "screenshots"


def capture_screen() -> Path:
    """Capture fullscreen and save as JPEG. Returns the saved file path."""
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    dest = SCREENSHOTS_DIR / f"{timestamp}.jpg"

    with mss.mss() as sct:
        # Capture the primary monitor (index 1; index 0 is the combined virtual screen)
        monitor = sct.monitors[1]
        screenshot = sct.grab(monitor)
        mss.tools.to_png(screenshot.rgb, screenshot.size, output=str(dest.with_suffix(".png")))

    # Convert PNG to JPEG to reduce file size
    from PIL import Image
    png_path = dest.with_suffix(".png")
    img = Image.open(png_path)
    img = img.convert("RGB")
    img.save(dest, "JPEG", quality=85)
    png_path.unlink()

    return dest
