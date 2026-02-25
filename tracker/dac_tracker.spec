# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for DAC Tracker single-file exe.

Build:
    cd tracker
    pyinstaller dac_tracker.spec

Output: dist/DACTracker.exe
"""

import os
from pathlib import Path

block_cipher = None

# Paths relative to spec file location
TRACKER_DIR = os.path.dirname(os.path.abspath(SPECPATH))
ROOT_DIR = os.path.dirname(TRACKER_DIR)
DATA_DIR = os.path.join(ROOT_DIR, "data")

# Bundled data files: (source, dest_in_bundle)
datas = [
    (os.path.join(DATA_DIR, "icons"), os.path.join("data", "icons")),
    (os.path.join(DATA_DIR, "units.json"), "data"),
    (os.path.join(DATA_DIR, "items.json"), "data"),
    (os.path.join(DATA_DIR, "relics.json"), "data"),
    (os.path.join(TRACKER_DIR, "prompts"), "prompts"),
]

# Filter out missing paths (optional files)
datas = [(src, dst) for src, dst in datas if os.path.exists(src)]

a = Analysis(
    [os.path.join(TRACKER_DIR, "tray_app.py")],
    pathex=[TRACKER_DIR],
    binaries=[],
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
    console=True,  # set False for release builds
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,  # TODO: add .ico file
)
