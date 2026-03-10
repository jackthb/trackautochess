# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for DAC Tracker single-file exe.

Build:
    cd tracker
    pyinstaller dac_tracker.spec

Output: dist/DACTracker.exe
"""

import os
import sys
from pathlib import Path

block_cipher = None

# Paths relative to spec file location
# SPECPATH is the directory containing the spec file in PyInstaller
TRACKER_DIR = SPECPATH
ROOT_DIR = os.path.dirname(TRACKER_DIR)
DATA_DIR = os.path.join(ROOT_DIR, "data")

# Portable Tesseract OCR — set this to the directory containing tesseract.exe + DLLs + tessdata/
# Download from: https://digi.bib.uni-mannheim.de/tesseract/
# Install, then copy the install directory here (or point to it).
TESSERACT_DIR = os.path.join(os.path.dirname(TRACKER_DIR), "tesseract-portable")

# --- Environment validation — fail early rather than producing a broken build ---

_REQUIRED_PATHS = [
    (os.path.join(DATA_DIR, "icons"),                          "data/icons directory"),
    (os.path.join(DATA_DIR, "sentinel_ref_final_ranking.png"), "data/sentinel_ref_final_ranking.png"),
    (os.path.join(DATA_DIR, "units.json"),                     "data/units.json"),
    (os.path.join(DATA_DIR, "items.json"),                     "data/items.json"),
    (os.path.join(DATA_DIR, "relics.json"),                    "data/relics.json"),
    (os.path.join(TRACKER_DIR, "prompts"),                     "tracker/prompts directory"),
]

_missing = [label for path, label in _REQUIRED_PATHS if not os.path.exists(path)]
if _missing:
    raise SystemExit(
        "[spec] ERROR: Required paths missing — build aborted.\n"
        + "\n".join(f"  missing: {label}" for label in _missing)
    )

_dac_console_raw = os.environ.get("DAC_CONSOLE", "")
if _dac_console_raw not in ("", "0", "1"):
    raise SystemExit(
        f"[spec] ERROR: DAC_CONSOLE must be '0' or '1', got '{_dac_console_raw}'"
    )

print(f"[spec] Environment OK (DAC_CONSOLE={_dac_console_raw or '<default:1>'})")

# --- Bundled data files: (source, dest_in_bundle) ---

datas = [
    (os.path.join(DATA_DIR, "icons"),                          os.path.join("data", "icons")),
    (os.path.join(DATA_DIR, "sentinel_ref_final_ranking.png"), "data"),
    (os.path.join(DATA_DIR, "units.json"),                     "data"),
    (os.path.join(DATA_DIR, "items.json"),                     "data"),
    (os.path.join(DATA_DIR, "relics.json"),                    "data"),
    (os.path.join(TRACKER_DIR, "prompts"),                     "prompts"),
]

# Tesseract is optional — present in CI (downloaded before build) and in full local setups.
# Warn loudly when absent so developers know OCR will not be bundled.
if os.path.exists(TESSERACT_DIR):
    datas.append((TESSERACT_DIR, "tesseract"))
else:
    print(f"[spec] WARNING: Tesseract not found at {TESSERACT_DIR} — OCR will NOT be bundled")

# Find OpenSSL DLLs from the base Python install (not the venv) so HTTPS works
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
    [os.path.join(TRACKER_DIR, "tray_app.py")],
    pathex=[TRACKER_DIR],
    binaries=_ssl_binaries,
    datas=datas,
    hiddenimports=[
        "pystray",
        "pystray._win32",
        "cv2",
        "pytesseract",
        "mss",
        "mss.windows",
        "keyboard",
        "PIL",
        "ssl",
        "_ssl",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="DACTracker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=bool(int(os.environ.get("DAC_CONSOLE", "1"))),
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(DATA_DIR, "icons", "dac_tracker.ico"),
)
