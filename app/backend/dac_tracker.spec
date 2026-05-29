# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for DAC Tracker headless backend.

Builds the headless JSON Lines backend that Electron spawns as a subprocess.
Output: dist/headless/ directory containing headless.exe + dependencies.

Build:
    cd app/backend
    pyinstaller dac_tracker.spec
"""

import os
import sys
from pathlib import Path

block_cipher = None

BACKEND_DIR = SPECPATH
APP_DIR = os.path.dirname(BACKEND_DIR)
ROOT_DIR = os.path.dirname(APP_DIR)
DATA_DIR = os.path.join(ROOT_DIR, "data")
VENDOR_DIR = os.path.join(BACKEND_DIR, "vendor")

# --- Environment validation — fail early rather than producing a broken build ---

_REQUIRED_PATHS = [
    (os.path.join(DATA_DIR, "icons"),                          "data/icons directory"),
    (os.path.join(DATA_DIR, "units.json"),                     "data/units.json"),
    (os.path.join(DATA_DIR, "units_full.json"),                "data/units_full.json"),
    (os.path.join(DATA_DIR, "items.json"),                     "data/items.json"),
    (os.path.join(DATA_DIR, "relics.json"),                    "data/relics.json"),
]

_missing = [label for path, label in _REQUIRED_PATHS if not os.path.exists(path)]
if _missing:
    raise SystemExit(
        "[spec] ERROR: Required paths missing — build aborted.\n"
        + "\n".join(f"  missing: {label}" for label in _missing)
    )

print("[spec] Environment OK")

# --- Bundled data files: (source, dest_in_bundle) ---

datas = [
    (os.path.join(DATA_DIR, "icons"),                          os.path.join("data", "icons")),
    (os.path.join(DATA_DIR, "units.json"),                     "data"),
    (os.path.join(DATA_DIR, "units_full.json"),                "data"),
    (os.path.join(DATA_DIR, "items.json"),                     "data"),
    (os.path.join(DATA_DIR, "relics.json"),                    "data"),
    (os.path.join(DATA_DIR, "synergies.json"),                 "data"),
]

# ffmpeg for replay recording (AV1/H.264)
FFMPEG_DIR = os.path.join(VENDOR_DIR, "ffmpeg")
if os.path.exists(FFMPEG_DIR):
    datas.append((FFMPEG_DIR, "ffmpeg"))
else:
    print(f"[spec] WARNING: ffmpeg not found at {FFMPEG_DIR} — replay recording will use system ffmpeg")

# Find OpenSSL DLLs from the base Python install so HTTPS works
_base = Path(sys.base_prefix) / "DLLs"
_ssl_binaries = [
    (str(p), ".") for p in _base.glob("libssl*")
] + [
    (str(p), ".") for p in _base.glob("libcrypto*")
] + [
    (str(p), ".") for p in _base.glob("_ssl*")
]
print(f"[spec] SSL binaries from {_base}: {_ssl_binaries}")

a = Analysis(
    [os.path.join(BACKEND_DIR, "headless.py")],
    pathex=[BACKEND_DIR],
    binaries=_ssl_binaries,
    datas=datas,
    hiddenimports=[
        "db",
        "nettable_capture",
        "nettable_parser",
        "replay",
        "screen_capture",
        "steam_auth",
        "telemetry",
        "updater",
        "utils",
        "posthog",
        "posthog.client",
        "posthog.consumer",
        "posthog.request",
        "posthog.exception_capture",
        "cv2",
        "mss",
        "mss.windows",
        "PIL",
        "av",
        "ssl",
        "_ssl",
        "httpx",
        "httpx._transports",
        "httpx._transports.default",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "pystray",
        "keyboard",
        "tkinter",
        "pytesseract",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="headless",
    debug=False,
    strip=False,
    upx=True,
    console=True,  # Needs stdin/stdout for JSON Lines IPC with Electron
    icon=os.path.join(DATA_DIR, "icons", "dac_tracker.ico"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    name="headless",
)
