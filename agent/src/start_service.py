import ctypes
import sys
import subprocess
import shared_utils

def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False

def run_with_admin_privileges():
    if not is_admin():
        # Re-run the script with administrative privileges
        ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, " ".join(sys.argv), None, 1)
    else:
        # The script is running with administrative privileges, so launch the original script
        svc = shared_utils.get_path() + '/owlette_service.py'
        command = f'python {svc} start'
        subprocess.run(command, shell=True)

if __name__ == "__main__":
    run_with_admin_privileges()
