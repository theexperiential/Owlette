# -*- mode: python ; coding: utf-8 -*-
import sys
from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

# Common hidden imports needed by multiple executables
common_hidden_imports = [
    'win32timezone',
    'keyring.backends.Windows',
    'customtkinter',
    'PIL',
    'PIL._tkinter_finder',
]

# Service executable
service_exe = Analysis(
    ['src/owlette_service.py'],
    pathex=['src'],
    binaries=[],
    datas=[],
    hiddenimports=common_hidden_imports + ['win32serviceutil', 'win32service', 'win32event'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

service_pyz = PYZ(service_exe.pure, service_exe.zipped_data, cipher=block_cipher)

service = EXE(
    service_pyz,
    service_exe.scripts,
    service_exe.binaries,
    service_exe.zipfiles,
    service_exe.datas,
    [],
    name='owlette_service',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# GUI executable
gui_exe = Analysis(
    ['src/owlette_gui.py'],
    pathex=['src'],
    binaries=[],
    datas=[],
    hiddenimports=common_hidden_imports + ['CTkListbox', 'CTkMessagebox'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

gui_pyz = PYZ(gui_exe.pure, gui_exe.zipped_data, cipher=block_cipher)

gui = EXE(
    gui_pyz,
    gui_exe.scripts,
    gui_exe.binaries,
    gui_exe.zipfiles,
    gui_exe.datas,
    [],
    name='owlette_gui',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# Tray executable
tray_exe = Analysis(
    ['src/owlette_tray.py'],
    pathex=['src'],
    binaries=[],
    datas=[],
    hiddenimports=common_hidden_imports + ['pystray._win32'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

tray_pyz = PYZ(tray_exe.pure, tray_exe.zipped_data, cipher=block_cipher)

tray = EXE(
    tray_pyz,
    tray_exe.scripts,
    tray_exe.binaries,
    tray_exe.zipfiles,
    tray_exe.datas,
    [],
    name='owlette_tray',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)