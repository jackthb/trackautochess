"""Shared utility functions for the DAC tracker."""

import json
import os
import sys
from pathlib import Path


# ── Paths ─────────────────────────────────────────────────────────────────────

DAC_DIR = Path(os.environ.get("DAC_DIR") or (Path.home() / ".dac"))
CONFIG_PATH = DAC_DIR / "config.json"
LOCAL_DUMPS_DIR = DAC_DIR / "nettable_dumps"
LOCAL_MATCH_PLAYERS_DIR = DAC_DIR / "match_players"
LOCAL_PLAYERS_DIR = DAC_DIR / "players"
LOCAL_MATCHES_DIR = DAC_DIR / "matches"
LOCAL_END_BOARDS_DIR = DAC_DIR / "end_boards"
LOCAL_PERSONAL_END_BOARDS_DIR = DAC_DIR / "personal_end_boards"
LOCAL_MATCH_TIMELINES_DIR = DAC_DIR / "match_timelines"
# Backwards-compat: callers still importing LOCAL_GAMES_DIR (CV pipeline)
# get the new match_players location transparently.
LOCAL_GAMES_DIR = LOCAL_MATCH_PLAYERS_DIR


def local_only_mode() -> bool:
    """True when the backend should skip all Supabase HTTP calls.

    Env wins over config so a single launch can flip without touching disk:
        DAC_LOCAL_ONLY=1 pnpm run dev
    """
    env = os.environ.get("DAC_LOCAL_ONLY", "").strip().lower()
    if env in ("1", "true", "yes", "on"):
        return True
    if env in ("0", "false", "no", "off"):
        return False
    try:
        cfg = load_config()
    except Exception:
        return False
    return bool(cfg.get("local_only", False))

def _data_dir() -> Path:
    """Return the data/ directory, works both in dev and PyInstaller bundle."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "data"
    # backend/ → app/ → repo root
    return Path(__file__).resolve().parent.parent.parent / "data"

DATA_DIR = _data_dir()
ICONS_DIR = DATA_DIR / "icons"
DEFAULT_REGIONS_CONFIG_PATH = DATA_DIR / "regions_config.json"
REGIONS_CONFIG_PATH = DAC_DIR / "regions_config.json"


_TESSERACT_SETUP_DONE = False


def setup_tesseract() -> None:
    """Point pytesseract at a bundled Tesseract binary when one is available."""
    global _TESSERACT_SETUP_DONE
    if _TESSERACT_SETUP_DONE:
        return
    _TESSERACT_SETUP_DONE = True

    try:
        import pytesseract
    except ImportError:
        return

    backend_dir = Path(__file__).resolve().parent
    app_dir = backend_dir.parent

    candidates: list[Path] = []
    env_cmd = os.environ.get("TESSERACT_CMD")
    if env_cmd:
        candidates.append(Path(env_cmd))

    if getattr(sys, "frozen", False):
        candidates.append(Path(sys._MEIPASS) / "tesseract" / "tesseract.exe")

    candidates.extend([
        backend_dir / "vendor" / "tesseract-portable" / "tesseract.exe",
        backend_dir / "dist" / "headless" / "_internal" / "tesseract" / "tesseract.exe",
        app_dir / "release" / "win-unpacked" / "resources" / "headless" / "_internal" / "tesseract" / "tesseract.exe",
    ])

    for tess_exe in candidates:
        if not tess_exe.exists():
            continue
        tess_dir = tess_exe.parent
        pytesseract.pytesseract.tesseract_cmd = str(tess_exe)
        os.environ["PATH"] = str(tess_dir) + os.pathsep + os.environ.get("PATH", "")
        tessdata = tess_dir / "tessdata"
        if tessdata.exists() and not os.environ.get("TESSDATA_PREFIX"):
            os.environ["TESSDATA_PREFIX"] = str(tessdata)
        return


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
    """Load Parser Lab regions, merging user overrides onto defaults.

    Schema is flat — single 16:9 profile, no aspect-ratio dispatch.
    """
    def _read(path: Path) -> dict:
        if not path.exists():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _merge(base: dict, override: dict) -> dict:
        merged = dict(base)
        for key, value in override.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key] = _merge(merged[key], value)
            else:
                merged[key] = value
        return merged

    defaults = _read(DEFAULT_REGIONS_CONFIG_PATH)
    overrides = _read(REGIONS_CONFIG_PATH)
    return _merge(defaults, overrides) if defaults else overrides


# ── Image helpers (lazy imports — cv2/numpy only loaded when called) ──────────

def crop(img, x0: float, y0: float, x1: float, y1: float):
    """Crop image using fractional coords (0..1)."""
    h, w = img.shape[:2]
    return img[int(h * y0):int(h * y1), int(w * x0):int(w * x1)]


def ocr(img, psm: int = 7, whitelist: str = "", lang: str = "") -> str:
    """OCR a small image region. Returns stripped text."""
    import cv2
    setup_tesseract()
    try:
        import pytesseract
    except ImportError:
        return ""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    config = f"--psm {psm}"
    if whitelist:
        config += f" -c tessedit_char_whitelist={whitelist}"
    if lang:
        config += f" -l {lang}"
    try:
        return pytesseract.image_to_string(gray, config=config).strip()
    except Exception:
        return ""


def unit_stem(name: str) -> str:
    """Convert unit name to the filename stem used for icon files."""
    return name.lower().replace(" ", "_").replace("-", "_").replace("'", "")
