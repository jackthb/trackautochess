"""Shared utility functions for the DAC tracker."""

import json
import os
import sys
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────

DAC_DIR = Path(os.environ.get("DAC_DIR") or (Path.home() / ".dac"))
CONFIG_PATH = DAC_DIR / "config.json"


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


# ── Config ────────────────────────────────────────────────────────────────────

DEFAULT_CONFIG = {
    "player_name": "jack",
    "hotkey": "F6",
    "supabase_url": "https://xkfxykorskdltcmvgihh.supabase.co",
    "supabase_key": "sb_publishable_Tk7hBHGJImbtzxxZzEIgKQ_kwnKuCaK",
    "supabase_db_url": "",
    "steam_id": "",
    "steam_name": "",
    "replay_enabled": True,
    "replay_max_gb": 15,
    # Raw nettable dumps are noisy/debug data. Keep them on-device by
    # default and upload only the processed match/timeline representation.
    "keep_local_nettable_dumps": True,
    "upload_raw_nettable_dumps": False,
    "local_nettable_retention_days": 14,
    "local_nettable_max_mb": 500,
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
