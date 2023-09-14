import shared_utils
import pystray
from pystray import MenuItem as item
from PIL import Image, ImageDraw
import subprocess
import logging
import os
import psutil
import ctypes
import sys
import winreg

logging.basicConfig(filename=shared_utils.get_path('_tray.log'), level=logging.INFO)
logging.info('Starting Owlette tray icon...')

pid = None
start_on_login = True

# Function to create icon image
def create_image():
    width, height = 64, 64
    color1 = (255, 255, 255)
    color2 = (0, 0, 0)
    image = Image.new('RGB', (width, height), color1)
    dc = ImageDraw.Draw(image)
    dc.rectangle(
        (width // 2, 0, width, height // 2),
        fill=color2)
    dc.rectangle(
        (0, height // 2, width // 2, height),
        fill=color2)
    return image

# Function to check if process is running
def is_process_running(pid):
    if pid is None:
        return False
    try:
        process = psutil.Process(pid)
        return True if process.is_running() else False
    except psutil.NoSuchProcess:
        return False
    except Exception as e:
        logging.error(f"Failed to check if process is running: {e}")
        return False

# Function to open configuration
def open_config(icon, item):
    global pid
    if not is_process_running(pid):
        try:
            process = subprocess.Popen(["python", shared_utils.get_path('owlette_gui.py')])
            pid = process.pid
        except Exception as e:
            logging.error(f"Failed to open Owlette Configuration: {e}")

# Function to exit
def exit_action(icon, item):
    try:
        ctypes.windll.shell32.ShellExecuteW(None, "runas", "cmd.exe", f"/c python {shared_utils.get_path('owlette_service.py')} stop", None, 0)
    except Exception as e:
        logging.error(f"Failed to stop service: {e}")
    icon.stop()

# Function to change the registry setting for the Windows Service
def on_select(icon, item):
    global start_on_login  # Declare global to modify it
    
    try:
        #logging.info(f"Checkbox state before action: {start_on_login}")

        # Check for admin rights
        is_admin = ctypes.windll.shell32.IsUserAnAdmin() != 0

        # Set the service start type
        start_type = "delayed-auto" if not start_on_login else "disabled"

        if not is_admin:
            # Re-run the command with admin rights
            ctypes.windll.shell32.ShellExecuteW(None, "runas", "cmd.exe", f"/k sc config OwletteService start= {start_type}", None, 0)
        else:
            subprocess.run('sc config OwletteService start= disabled', shell=True)

        start_on_login = not start_on_login  # Toggle the checkbox state
        #logging.info(f"Checkbox state after action: {start_on_login}")
        
        # Update menu
        icon.update_menu(generate_menu())

    except Exception as e:
        logging.error(f"Failed to change service startup type: {e}")


# Function to check the service status
def check_service_status():
    try:
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, 'SYSTEM\\CurrentControlSet\\Services\\OwletteService', 0, winreg.KEY_READ)
        start_type, _ = winreg.QueryValueEx(key, 'Start')
        winreg.CloseKey(key)
        return start_type == 0x2
    except Exception as e:
        logging.error(f"Failed to read service start type: {e}")
        return False

# Dynamically generate the menu
def generate_menu():
    return pystray.Menu(
        item('Open Config', open_config),
        item('Start on Login', on_select, checked=lambda text: start_on_login),
        item('Exit', exit_action)
    )

# Create the system tray icon
image = create_image()
icon = pystray.Icon(
    "owlette_icon", 
    image, 
    "Owlette", 
    menu=generate_menu()
)

# Run the icon
icon.run()

logging.info('Exiting Tray icon...')
