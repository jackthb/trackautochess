"""Shared utility functions for the DAC tracker."""

import json
import sys
from pathlib import Path


# ── Paths ─────────────────────────────────────────────────────────────────────

DAC_DIR = Path.home() / ".dac"
CONFIG_PATH = DAC_DIR / "config.json"

def _data_dir() -> Path:
    """Return the data/ directory, works both in dev and PyInstaller bundle."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "data"
    # backend/ → app/ → repo root
    return Path(__file__).resolve().parent.parent.parent / "data"

DATA_DIR = _data_dir()
ICONS_DIR = DATA_DIR / "icons"
REGIONS_CONFIG_PATH = DATA_DIR / "regions_config.json"


# ── Config ────────────────────────────────────────────────────────────────────

DEFAULT_CONFIG = {
    "player_name": "jack",
    "hotkey": "F6",
    "model": "qwen2.5vl:7b",
    "ollama_url": "http://localhost:11434",
    "supabase_url": "https://xkfxykorskdltcmvgihh.supabase.co",
    "supabase_key": "sb_publishable_Tk7hBHGJImbtzxxZzEIgKQ_kwnKuCaK",
    "supabase_db_url": "",
    "steam_id": "",
    "steam_name": "",
    "replay_enabled": True,
    "replay_max_gb": 15,
}


def load_config(interactive: bool = False) -> dict:
    """Load config from ~/.dac/config.json.

    If interactive=True and no config exists, prompts for player name.
    Otherwise creates defaults silently.
    """
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

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


def save_config(config: dict) -> None:
    """Write config dict back to ~/.dac/config.json."""
    DAC_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(config, indent=2))


def load_regions_config() -> dict:
    """Load picker calibration regions from data/regions_config.json."""
    if not REGIONS_CONFIG_PATH.exists():
        return {}
    try:
        data = json.loads(REGIONS_CONFIG_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict) and "aspect_ratios" in data:
            data = data["aspect_ratios"]
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def infer_aspect_ratio(width: int, height: int, available: list[str] | None = None) -> str:
    """Pick the nearest configured aspect ratio label for an image size."""
    if width <= 0 or height <= 0:
        return "16:9"

    ratio = width / height
    known = {
        "16:9": 16 / 9,
        "21:9": 21 / 9,
    }
    if available:
        known = {k: v for k, v in known.items() if k in available} or known
    return min(known, key=lambda key: abs(known[key] - ratio))


# ── Image helpers (lazy imports — cv2/numpy only loaded when called) ──────────

def crop(img, x0: float, y0: float, x1: float, y1: float):
    """Crop image using fractional coords (0..1)."""
    h, w = img.shape[:2]
    return img[int(h * y0):int(h * y1), int(w * x0):int(w * x1)]


def ocr(img, psm: int = 7, whitelist: str = "") -> str:
    """OCR a small image region. Returns stripped text."""
    import cv2
    try:
        import pytesseract
    except ImportError:
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
