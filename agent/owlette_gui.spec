# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
# Added Firebase imports for lazy loading support
hiddenimports = [
    'win32timezone',
    'win32serviceutil',  # For service status check
    'customtkinter',
    'CTkListbox',
    'CTkMessagebox',
    'psutil',
    # Firebase (lazy loaded in background thread)
    'firebase_client',
    'firebase_admin',
    'firebase_admin.firestore',
    'firebase_admin.credentials',
    'google.cloud',
    'google.cloud.firestore',
    'google.auth',
    'grpc',
    'google.api_core',
]
tmp_ret = collect_all('win32com')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['src\\owlette_gui.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=2,  # Changed from 0 to 2 for bytecode optimization
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='owlette_gui',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # Changed from True to False for faster startup (trades size for speed)
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,  # Changed from True to False for faster startup
    upx_exclude=[],
    name='owlette_gui',
)
