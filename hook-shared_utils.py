from PyInstaller.utils.hooks import collect_all

# Collect everything from psutil
psutil_datas, psutil_binaries, psutil_hiddenimports = collect_all('psutil')

# Add the collections to the globals that PyInstaller reads
datas = psutil_datas
binaries = psutil_binaries
hiddenimports = psutil_hiddenimports