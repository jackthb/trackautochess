"""Shared utility functions for the DAC tracker."""

import json
from pathlib import Path

import cv2
import numpy as np

try:
    import pytesseract
except ImportError:
    pytesseract = None


# ── Paths ─────────────────────────────────────────────────────────────────────

DAC_DIR = Path.home() / ".dac"
CONFIG_PATH = DAC_DIR / "config.json"
GAMES_CSV = DAC_DIR / "games.csv"
ICONS_DIR = Path(__file__).parent.parent / "data" / "icons"


# ── Config ────────────────────────────────────────────────────────────────────

DEFAULT_CONFIG = {
    "player_name": "jack",
    "hotkey": "ctrl+shift+g",
    "model": "qwen2.5vl:7b",
    "ollama_url": "http://localhost:11434",
    "games_csv": str(GAMES_CSV),
}


def load_config(interactive: bool = False) -> dict:
    """Load config from ~/.dac/config.json.

    If interactive=True and no config exists, prompts for player name.
    Otherwise creates defaults silently.
    """
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text())

    DAC_DIR.mkdir(parents=True, exist_ok=True)
    config = dict(DEFAULT_CONFIG)

    if interactive:
        print("[tracker] First run — creating config.")
        name = input("  Enter your in-game player name: ").strip()
        if name:
            config["player_name"] = name

    CONFIG_PATH.write_text(json.dumps(config, indent=2))
    print(f"[tracker] Config saved to {CONFIG_PATH}")
    return config


# ── Image helpers ─────────────────────────────────────────────────────────────

def crop(img: np.ndarray, x0: float, y0: float, x1: float, y1: float) -> np.ndarray:
    """Crop image using fractional coords (0..1)."""
    h, w = img.shape[:2]
    return img[int(h * y0):int(h * y1), int(w * x0):int(w * x1)]


def ocr(img: np.ndarray, psm: int = 7, whitelist: str = "") -> str:
    """OCR a small image region. Returns stripped text."""
    if pytesseract is None:
        return ""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    config = f"--psm {psm}"
    if whitelist:
        config += f" -c tessedit_char_whitelist={whitelist}"
    try:
        return pytesseract.image_to_string(gray, config=config).strip()
    except Exception:
        return ""


def unit_stem(name: str) -> str:
    """Convert unit name to the filename stem used for icon files."""
    return name.lower().replace(" ", "_").replace("-", "_").replace("'", "")
