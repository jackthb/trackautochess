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

# Bundled data files: (source, dest_in_bundle)
datas = [
    (os.path.join(DATA_DIR, "icons"), os.path.join("data", "icons")),
    (os.path.join(DATA_DIR, "units.json"), "data"),
    (os.path.join(DATA_DIR, "items.json"), "data"),
    (os.path.join(DATA_DIR, "relics.json"), "data"),
    (os.path.join(TRACKER_DIR, "prompts"), "prompts"),
    (TESSERACT_DIR, "tesseract"),
]

# Filter out missing paths (optional files)
datas = [(src, dst) for src, dst in datas if os.path.exists(src)]

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
        "plyer",
        "plyer.platforms.win.notification",
        "cv2",
        "pytesseract",
        "mss",
        "mss.windows",
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
    icon=None,  # TODO: add .ico file
)
