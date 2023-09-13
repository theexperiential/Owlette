import shared_utils
import pystray
from PIL import Image, ImageDraw
import subprocess
import logging
import os
import psutil

logging.basicConfig(filename=shared_utils.get_path('_tray.log'), level=logging.INFO)
logging.info('Starting Owlette tray icon...')

pid = None

def create_image():
    # Create an image using PIL
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

def open_config(icon, item):
    global pid  # Declare pid as global so you can modify it
    
    if not is_process_running(pid):
        try:
            process = subprocess.Popen(["python", shared_utils.get_path('owlette_gui.py')])
            pid = process.pid
        except Exception as e:
            logging.error(f"Failed to open Owlette GUI: {e}")

def exit_action(icon, item):
    icon.stop()
    try:
        # Stop the OwletteService
        subprocess.run(["python", shared_utils.get_path('owlette_service.py'), "stop"])
    except Exception as e:
        logging.error(f"Failed to stop service: {e}")

# Create the system tray icon
image = create_image()
icon = pystray.Icon(
    "owlette_icon", 
    image, 
    "Owlette", 
    menu=pystray.Menu(
        pystray.MenuItem('Open Config', open_config), 
        pystray.MenuItem('Exit', exit_action)
    )
)

# Run the icon
icon.run()

logging.info('done.')