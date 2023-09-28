import os
import json
import logging
from logging.handlers import RotatingFileHandler
import keyring
import requests
import ctypes
import socket
from packaging import version

# GLOBAL VARS

APP_VERSION = '0.3.1b'
CONFIG_VERSION = '1.1.0'
FRAME_COLOR = '#28292b'
BUTTON_COLOR = '#374448'
BUTTON_HOVER_COLOR = '#27424a'
BUTTON_IMPORTANT_COLOR = '#2d5e6c'
WINDOW_TITLES = {
    "owlette_gui": "Owlette Configuration", 
    "prompt_slack_config": "Connect to Slack",
    "prompt_restart": "Process repeatedly failing!"
}

# OS

def get_hostname():
    return socket.gethostname()

def get_path(filename=None):
    # Get the directory of the currently executing script
    path = os.path.dirname(os.path.realpath(__file__))

    # Build the full path to the file name
    if filename is not None:
        path = os.path.join(path, filename)

    # Normalize the path
    path = os.path.normpath(path)
    
    return path

CONFIG_PATH = get_path('../config/config.json')

# LOGGING

def initialize_logging(log_file_name, level=logging.INFO):
    log_file_path = get_path(f'../logs/{log_file_name}.log')
    
    # Clear the log file
    with open(log_file_path, 'w'):
        pass
    
    # Create a formatter for the log messages
    log_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
    
    # Create a handler that writes log messages to a file, with a maximum
    # log file size of 5 MB, keeping 2 old log files.
    log_handler = RotatingFileHandler(log_file_path, mode='a', maxBytes=5*1024*1024, backupCount=2, encoding=None, delay=0)
    
    # Set the formatter for the handler
    log_handler.setFormatter(log_formatter)
    
    # Create the logger and set its level
    logger = logging.getLogger()
    logger.setLevel(level)
    
    # Add the handler to the logger
    logger.addHandler(log_handler)
    
    # Log an initial message
    logging.info(f"Starting {log_file_name}...")

# CONFIG JSON

# Maintain compatibility from JSON config versions < 1.1.0
def upgrade_config():
    # Directly read the original config file
    config = read_json_from_file(CONFIG_PATH)

    # Check if 'version' key exists and its value
    current_version = config.get('version', '0.0.0')

    # If version is less than 1.1.0, apply changes
    if version.parse(current_version) < version.parse('1.1.0'):
        # Add or update the 'version' key
        config['version'] = '1.1.0'

        # Update other keys as needed
        if 'email' in config:
            config['gmail'] = config.pop('email')
            config['gmail']['enabled'] = True

        # Update 'autostart_process' to 'autolaunch_process'
        for process in config['processes']:
            if 'autostart_process' in process:
                process['autolaunch_process'] = process.pop('autostart_process')

        # Reorder the keys so that 'version' is at the top
        ordered_config = {'version': config['version']}
        for key in config:
            if key != 'version':
                ordered_config[key] = config[key]

        # Write the updated config back to the file
        with open(CONFIG_PATH, 'w') as f:
            json.dump(order, f, indent=4)

# Generic function to read JSON from a file
def read_json_from_file(file_path):
    try:
        with open(file_path, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        logging.info(f"{file_path} not found.")
        return None
    except json.JSONDecodeError:
        logging.error("Failed to decode JSON.")
        return None
    except Exception as e:
        logging.error(f"An error occurred while reading the file: {e}")
        return None

def write_json_to_file(data, file_path):
    try:
        with open(file_path, 'w') as f:
            json.dump(data, f, indent=4)
    except Exception as e:
        logging.error(f"An error occurred while writing to the file: {e}")

def generate_config_file(existing_config=None):
    default_config = {
        "version": CONFIG_VERSION, 
        "processes": [], 
        "gmail": {
            "enabled": False, 
            "to": []
        },
        "slack": {
            "enabled": False
        }
    }
    
    if existing_config is None:
        return default_config

    # Update only missing keys
    for key, value in default_config.items():
        if key not in existing_config:
            existing_config[key] = value

    return existing_config

# Read configuration JSON file
def read_config(keys=None, process_list_id=None):
    config = read_json_from_file(CONFIG_PATH)

    # If process_list_id is provided, find the corresponding process
    if process_list_id:
        for process in config['processes']:
            if process['id'] == process_list_id:
                if keys:
                    item = process
                    for key in keys:
                        item = item.get(key, None)
                        if item is None:
                            return None
                    return item
                else:
                    return process

    # If keys are provided, traverse the config to find the value
    elif keys:
        item = config
        for key in keys:
            item = item.get(key, None)
            if item is None:
                return None
        return item

    return config

def write_config(keys, value):
    config = read_json_from_file(CONFIG_PATH)

    # Traverse the config dictionary using the keys to find the item to update
    item = config
    for key in keys[:-1]:
        item = item.get(key, {})

    # Update the value
    item[keys[-1]] = value

    write_json_to_file(config, CONFIG_PATH)


# PROCESSES 

def fetch_process_by_id(id, data):
    return next((process for process in data['processes'] if process['id'] == id), None)

def fetch_process_name_by_id(id, data):
    process = next((process for process in data['processes'] if process['id'] == id), None)
    return process['name'] if process else None   

def fetch_process_id_by_name(name, data):
    process = next((process for process in data['processes'] if process['name'] == name), None)
    return process['id'] if process else None

def get_process_index(selected_process_id):
    return next((i for i, p in enumerate(read_config()['processes']) if p['id'] == selected_process_id), None)


# WINDOWS / UI

def get_scaling_factor():
    hdc = ctypes.windll.user32.GetDC(0)
    LOGPIXELSX = 88
    actual_dpi = ctypes.windll.gdi32.GetDeviceCaps(hdc, LOGPIXELSX)
    ctypes.windll.user32.ReleaseDC(0, hdc)
    return actual_dpi / 96.0  # 96 DPI is the standard DPI, so we divide the actual by 96 to get the scaling factor

def center_window(root, width, height):
    scaling_factor = get_scaling_factor()

    # Get screen width and height
    screen_width = root.winfo_screenwidth() * scaling_factor
    screen_height = root.winfo_screenheight() * scaling_factor

    # Calculate position x and y coordinates
    x = (screen_width / 2) - (width * scaling_factor / 2)
    y = (screen_height / 2) - (height * scaling_factor / 2)
    root.geometry(f'{int(width)}x{int(height)}+{int(x)}+{int(y)}')


upgrade_config()