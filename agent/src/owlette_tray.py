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
import win32gui
import win32con
import threading
import time
import win32serviceutil
import win32service

pid = None
start_on_login = True
current_status = {'service': 'unknown', 'firebase': 'unknown'}
last_status = {'service': 'unknown', 'firebase': 'unknown'}
status_lock = threading.Lock()

# Function to create icon image with different colors
def create_image(status='normal'):
    """
    Create HAL 9000-style eye icon with Windows 11 Fluent Design.

    Status colors for center dot (pupil):
    - normal: White dot (everything OK, Always Watching)
    - warning: Yellow dot (Firebase connection issues)
    - error: Red dot (service stopped/disconnected)

    Design matches Windows 11 native tray icons (network, audio, etc.)
    """
    # Windows 11 tray icons are typically 16x16 at 100% DPI
    # We render at higher resolution for crisp anti-aliasing
    size = 64

    # Create transparent image (Windows 11 tray supports transparency)
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # Center point
    center = size // 2

    # Outer circle (eye outline) - Windows 11 style clean white
    # Slightly thicker outline for visibility at small sizes
    outer_radius = int(size * 0.44)  # 44% of size for good proportions
    outline_width = max(2, size // 16)  # Scale outline with size, minimum 2px

    # Draw outer circle (eye outline) in light gray - matches Windows 11 iconography
    draw.ellipse(
        [center - outer_radius, center - outer_radius,
         center + outer_radius, center + outer_radius],
        outline=(255, 255, 255, 255),  # Solid white outline
        width=outline_width
    )

    # Inner circle (pupil/iris) - status indicator
    inner_radius = int(size * 0.16)  # 16% of size - smaller dot like HAL 9000's central glow

    # Choose pupil color based on status
    if status == 'error':
        # Red - critical error / disconnected
        pupil_color = (239, 68, 68, 255)  # Bright red (red-500) - vibrant but professional
    elif status == 'warning':
        # Yellow - warning state
        pupil_color = (250, 204, 21, 255)  # Bright yellow (yellow-400) - visible but not alarming
    else:  # normal
        # White - all systems operational, "Always Watching"
        pupil_color = (255, 255, 255, 255)  # Pure white - matches Windows 11 success/normal state

    # Draw filled pupil circle
    draw.ellipse(
        [center - inner_radius, center - inner_radius,
         center + inner_radius, center + inner_radius],
        fill=pupil_color,
        outline=None
    )

    # Add subtle inner glow effect for depth (optional - makes it look more polished)
    # This creates the "lens" effect similar to HAL 9000
    glow_radius = int(inner_radius * 1.3)
    glow_color = pupil_color[:3] + (80,)  # Same color, 30% opacity
    draw.ellipse(
        [center - glow_radius, center - glow_radius,
         center + glow_radius, center + glow_radius],
        fill=None,
        outline=glow_color,
        width=1
    )

    return image

# Function to check Windows service status
def check_service_running():
    """
    Check if OwletteService is running.
    Returns True if running, False if stopped/not installed.
    """
    try:
        status = win32serviceutil.QueryServiceStatus('OwletteService')[1]
        # SERVICE_RUNNING = 4
        return status == 4
    except Exception as e:
        logging.debug(f"Service status check failed: {e}")
        return False

# Function to check Firebase connection status
def check_firebase_status():
    """
    Check Firebase connection by:
    1. Checking if Firebase is enabled in config
    2. Checking if credentials file exists
    3. Checking service log for recent connection errors

    Returns: 'connected', 'disabled', or 'error'
    """
    try:
        # Read config to see if Firebase is enabled
        config = shared_utils.read_json_from_file(shared_utils.CONFIG_PATH)
        if not config:
            return 'disabled'

        firebase_enabled = config.get('firebase', {}).get('enabled', False)
        if not firebase_enabled:
            return 'disabled'

        # Check if credentials exist
        credentials_path = shared_utils.get_path('../config/firebase-credentials.json')
        if not os.path.exists(credentials_path):
            return 'error'

        # If enabled and credentials exist, assume connected
        # (We could add more sophisticated checks by reading the log file)
        return 'connected'
    except Exception as e:
        logging.debug(f"Firebase status check failed: {e}")
        return 'error'

# Function to determine overall status
def determine_status():
    """
    Determine overall system status:
    - error: Service stopped/crashed
    - warning: Service running but Firebase has issues
    - normal: Everything good
    """
    service_running = check_service_running()
    firebase_status = check_firebase_status()

    # Format Firebase message
    if firebase_status == 'error':
        firebase_msg = 'Firebase: Connection Issues'
    elif firebase_status == 'disabled':
        firebase_msg = 'Firebase: Disabled'
    else:
        firebase_msg = 'Firebase: Connected'

    # Determine overall status
    if not service_running:
        return 'error', 'Service: Stopped', firebase_msg

    if firebase_status == 'error':
        return 'warning', 'Service: Running', firebase_msg
    else:
        return 'normal', 'Service: Running', firebase_msg

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
def open_config_gui(icon, item):
    global pid
    if not is_process_running(pid):
        try:
            process = subprocess.Popen(["pythonw", shared_utils.get_path('owlette_gui.py')])
            pid = process.pid
        except Exception as e:
            logging.error(f"Failed to open Owlette Configuration: {e}")
    else:
        try:
            # Assuming the window title contains "Owlette"
            hwnd = win32gui.FindWindow(None, shared_utils.WINDOW_TITLES.get("owlette_gui"))
            if hwnd:
                # Restore window if minimized.
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                # Bring window to front.
                win32gui.SetForegroundWindow(hwnd)
        except Exception as e:
            logging.error(f"Failed to bring Owlette Configuration to the front: {e}")

# Function to restart the service (robust implementation using Windows Service API)
def restart_service(icon, item):
    """
    Restart the Owlette service using Windows Service Control Manager API.
    Icon disappears immediately for good UX, then service restarts in background.
    """
    try:
        logging.info("Starting service restart procedure...")

        # Show notification immediately for user feedback
        try:
            icon.notify(
                title="🔄 Restarting Owlette",
                message="Service restarting... back soon!"
            )
        except:
            pass

        # Close all Owlette windows first
        for window_title in shared_utils.WINDOW_TITLES.values():
            try:
                hwnd = win32gui.FindWindow(None, window_title)
                if hwnd:
                    win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
                    logging.info(f"Closed window: {window_title}")
            except Exception as e:
                logging.debug(f"Could not close window '{window_title}': {e}")

        # Use a background thread to restart the service
        # IMPORTANT: Non-daemon thread so it continues after icon stops
        def restart_service_thread():
            try:
                service_name = 'OwletteService'

                # Small delay to let icon stop cleanly
                time.sleep(0.5)

                # 1. Stop the service
                logging.info("Stopping service...")
                try:
                    win32serviceutil.StopService(service_name)
                    logging.info("Stop command sent")

                    # Wait for service to fully stop (max 30 seconds)
                    timeout = 30
                    for i in range(timeout):
                        status = win32serviceutil.QueryServiceStatus(service_name)[1]
                        if status == win32service.SERVICE_STOPPED:
                            logging.info(f"Service stopped successfully after {i+1} seconds")
                            break
                        time.sleep(1)
                    else:
                        logging.warning(f"Service did not stop within {timeout} seconds")

                except Exception as e:
                    logging.error(f"Error stopping service: {e}")
                    # Continue anyway - might already be stopped

                # 2. Wait a bit to ensure clean shutdown
                time.sleep(2)

                # 3. Start the service
                logging.info("Starting service...")
                try:
                    win32serviceutil.StartService(service_name)
                    logging.info("Start command sent")

                    # Wait for service to start (max 30 seconds)
                    timeout = 30
                    for i in range(timeout):
                        status = win32serviceutil.QueryServiceStatus(service_name)[1]
                        if status == win32service.SERVICE_RUNNING:
                            logging.info(f"Service started successfully after {i+1} seconds")
                            break
                        time.sleep(1)
                    else:
                        logging.error(f"Service did not start within {timeout} seconds")
                        # Can't notify user anymore since icon is gone
                        return

                except Exception as e:
                    logging.error(f"Error starting service: {e}")
                    return

                # 4. Wait a moment for service to stabilize
                time.sleep(2)

                # 5. Restart tray icon to pick up any code changes
                logging.info("Restarting tray icon...")
                tray_path = shared_utils.get_path('owlette_tray.py')
                # Pass --restarted flag so new tray instance shows "back online" notification
                subprocess.Popen(['pythonw', tray_path, '--restarted'])

                logging.info("Service restart complete!")

            except Exception as e:
                logging.error(f"Fatal error in restart thread: {e}")

        # Start the restart in a NON-DAEMON background thread
        # This allows it to continue running after icon.stop()
        restart_thread = threading.Thread(target=restart_service_thread, daemon=False)
        restart_thread.start()

        # Stop the icon immediately for good UX (user sees icon disappear)
        # The background thread will handle restarting everything
        time.sleep(0.2)  # Brief delay to ensure notification shows
        icon.stop()
        logging.info("Tray icon stopped, restart thread continues in background")

    except Exception as e:
        logging.error(f"Failed to initiate service restart: {e}")
        try:
            icon.notify(
                title="⚠️ Restart Failed",
                message="Failed to restart service. Check if running as administrator."
            )
        except:
            pass

# Function to exit
def exit_action(icon, item):
    try:
        for key, window_title in shared_utils.WINDOW_TITLES.items():
            # Try to close the configuration window if it's open
            hwnd = win32gui.FindWindow(None, window_title)
            if hwnd:
                # Close the window
                win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)

        # Stop the service
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

# Status monitoring thread
def monitor_status(icon):
    """
    Background thread that monitors service and Firebase status.
    Updates icon and sends notifications when status changes.
    """
    global current_status, last_status

    # Grace period to avoid false alarms during restarts (seconds)
    grace_period = 5
    last_check_time = 0

    while icon.visible:
        try:
            current_time = time.time()

            # Check status every 60 seconds
            if current_time - last_check_time >= 60:
                status_code, service_msg, firebase_msg = determine_status()

                with status_lock:
                    current_status = {
                        'code': status_code,
                        'service': service_msg,
                        'firebase': firebase_msg
                    }

                    # Check if status changed
                    if last_status.get('code') != status_code:
                        # Update icon
                        icon.icon = create_image(status_code)

                        # Update tooltip
                        hostname = psutil.os.environ.get('COMPUTERNAME', 'Unknown')
                        tooltip = f"Owlette ({hostname})\n{service_msg}\n{firebase_msg}"
                        icon.title = tooltip

                        # Send notification on state change (but not on first check)
                        if last_status.get('code') != 'unknown' and current_time - last_check_time > grace_period:
                            send_status_notification(icon, status_code, service_msg, firebase_msg)

                        # Update last status
                        last_status = current_status.copy()

                last_check_time = current_time

            # Sleep for 10 seconds before checking again
            time.sleep(10)

        except Exception as e:
            logging.error(f"Status monitoring error: {e}")
            time.sleep(60)

def send_status_notification(icon, status_code, service_msg, firebase_msg):
    """Send Windows notification when status changes."""
    try:
        if status_code == 'error':
            icon.notify(
                title="⚠️ Owlette Service Stopped",
                message=f"{service_msg}\nThe service may have crashed or failed to start.\nClick 'Restart' to fix."
            )
        elif status_code == 'warning':
            icon.notify(
                title="⚠️ Firebase Connection Issue",
                message=f"{firebase_msg}\nLocal monitoring still works, but cloud sync is unavailable."
            )
        # Don't notify on normal status (too noisy)
    except Exception as e:
        logging.error(f"Failed to send notification: {e}")

# Dynamically generate the menu with status info
def generate_menu():
    hostname = psutil.os.environ.get('COMPUTERNAME', 'Unknown')

    # Get current status for menu display
    with status_lock:
        service_status = current_status.get('service', 'Checking...')
        firebase_status = current_status.get('firebase', 'Checking...')

    return pystray.Menu(
        item(f'Owlette: {hostname}', lambda icon, item: None, enabled=False),
        item(f'Version: {shared_utils.APP_VERSION}', lambda icon, item: None, enabled=False),
        item(f'{service_status}', lambda icon, item: None, enabled=False),
        item(f'{firebase_status}', lambda icon, item: None, enabled=False),
        pystray.Menu.SEPARATOR,
        item('Open Config', open_config_gui),
        item('Start on Login', on_select, checked=lambda text: start_on_login),
        item('Restart', restart_service),
        item('Exit', exit_action)
    )

def is_script_running(script_name):
    count = 0
    for process in psutil.process_iter(attrs=['pid', 'name', 'cmdline']):
        if 'python' in process.info['name']:
            cmdline = process.info.get('cmdline')
            if cmdline:
                if script_name in ' '.join(cmdline):
                    count += 1
    return count > 1

if __name__ == "__main__":
    # Initialize logging with configurable log level
    log_level = shared_utils.get_log_level_from_config()
    shared_utils.initialize_logging("tray", level=log_level)

    # Check if this is a restart (--restarted flag passed)
    is_restarted = '--restarted' in sys.argv

    if not is_script_running('owlette_tray.py'):
        # Do initial status check
        status_code, service_msg, firebase_msg = determine_status()

        with status_lock:
            current_status = {
                'code': status_code,
                'service': service_msg,
                'firebase': firebase_msg
            }
            last_status = current_status.copy()

        # Create the system tray icon with initial status
        hostname = psutil.os.environ.get('COMPUTERNAME', 'Unknown')
        tooltip = f"Owlette ({hostname})\n{service_msg}\n{firebase_msg}"
        image = create_image(status_code)

        icon = pystray.Icon(
            "owlette_icon",
            image,
            tooltip,
            menu=generate_menu()
        )

        # Start status monitoring thread
        monitor_thread = threading.Thread(target=monitor_status, args=(icon,), daemon=True)
        monitor_thread.start()

        # Show "back online" notification if this was a restart
        if is_restarted:
            def show_restart_notification():
                # Wait a moment for icon to fully initialize
                time.sleep(1)
                try:
                    icon.notify(
                        title="✅ Back online!",
                        message="Owlette service running normally."
                    )
                    logging.info("Restart complete - 'back online' notification shown")
                except Exception as e:
                    logging.debug(f"Could not show restart notification: {e}")

            # Show notification in background thread
            notification_thread = threading.Thread(target=show_restart_notification, daemon=True)
            notification_thread.start()

        # Run the icon (blocking call)
        icon.run()

        logging.info('Exiting Tray icon...')

    else:
        logging.info('Tray icon is already running...')
        sys.exit(0)