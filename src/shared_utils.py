import os
import json
import logging
from logging.handlers import RotatingFileHandler
import ctypes
import socket
from packaging import version
import psutil
import GPUtil
import platform
import subprocess
import threading

# GLOBAL VARS

APP_VERSION = '0.3.5b'
CONFIG_VERSION = '1.2.0'
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
# Initialize a global lock
json_lock = threading.Lock()

# Return the hostname of the machine where the script is running
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

# PATHS
CONFIG_PATH = get_path('../config/config.json')
RESULT_FILE_PATH = get_path('../tmp/app_states.json')

# LOGGING
# Initialize logging with a rotating file handler
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

# Reads a JSON configuration file from a given path and optionally updates 
# an emails_to_entry list with email addresses from the configuration.
def load_config(emails_to_entry=None):
    try:
        config = read_json_from_file(CONFIG_PATH)
        if emails_to_entry is not None:
            emails_to_entry.insert(0, ', '.join(config['gmail']['to']))
        return config
        
    except FileNotFoundError as e:
        logging.error(f"Failed to load config: {e}")
        return generate_config_file()

# Writes a given configuration to a JSON file at a specified path. 
# If emails_to_entry is provided, the function updates the email addresses 
# in the configuration before saving.
def save_config(config=None, emails_to_entry=None):
    if config is None:
        config = read_json_from_file(CONFIG_PATH)
    
    if emails_to_entry is not None:
        config['gmail']['to'] = [email.strip() for email in emails_to_entry.get().split(',')]
    
    write_json_to_file(config, CONFIG_PATH)
  
# Maintain compatibility from JSON config versions < 1.1.0
def upgrade_config():
    # Directly read the original config file
    config = read_json_from_file(CONFIG_PATH)
    if config:
        # Check if 'version' key exists and its value
        current_version = config.get('version', '0.0.0')

        # If version is less than 1.1.0, apply changes
        if version.parse(current_version) < version.parse(CONFIG_VERSION):
            # Add or update the 'version' key to latest
            config['version'] = CONFIG_VERSION

            # Update other keys as needed
            if 'email' in config:
                config['gmail'] = config.pop('email')
                config['gmail']['enabled'] = True

            # Update autostart to autolaunch
            for process in config['processes']:
                if 'autostart_process' in process:
                    process['autolaunch'] = process.pop('autostart_process')
                elif 'autolaunch_process' in process:
                    process['autolaunch'] = process.pop('autolaunch_process')

                # Ensure all necessary keys are in each process object
                for key in ['id', 'name', 'exe_path', 'file_path', 'time_delay', 'time_to_init', 'relaunch_attempts', 'autolaunch', 'visibility', 'priority']:
                    if key == 'visibility':
                        process.setdefault(key, 'Show')
                    elif key == 'priority':
                        process.setdefault(key, 'Normal')
                    else:
                        process.setdefault(key, '')

            # Reorder the keys so that 'version' is at the top
            ordered_config = {'version': config['version']}
            for key in config:
                if key != 'version':
                    ordered_config[key] = config[key]

            # Write the updated config back to the file
            write_json_to_file(ordered_config, CONFIG_PATH)


    else:
        # if there are problems, just regenerate the config file
        new_config = generate_config_file()
        
        # Write the updated config back to the file
        write_json_to_file(new_config, CONFIG_PATH)

# Read a JSON file and returns its content as a Python dictionary
def read_json_from_file(file_path):
    with json_lock:
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

# Writes a Python dictionary to a JSON file
def write_json_to_file(data, file_path):
    with json_lock:
        try:
            with open(file_path, 'w') as f:
                json.dump(data, f, indent=4)
        except Exception as e:
            logging.error(f"An error occurred while writing to the file: {e}")

# Generate a default configuration file, optionally merging with an existing one
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

# Read specific keys from the configuration file or a specific process by its ID
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

# Write a specific value to a specific key in the configuration file
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

def fetch_pid_by_id(target_id):
    data = read_json_from_file(RESULT_FILE_PATH)
    
    # Filter out the processes that match the target_id
    matching_processes = {pid: info for pid, info in data.items() if info['id'] == target_id}
    
    if not matching_processes:
        print(f"No processes found with id: {target_id}")
        return None
    
    # Find the pid of the process with the newest timestamp
    newest_pid = max(matching_processes.keys(), key=lambda pid: matching_processes[pid]['timestamp'])
    
    return newest_pid

def update_process_status_in_json(pid, new_status):
    data = read_json_from_file(RESULT_FILE_PATH)
    data[str(pid)]['status'] = new_status
    write_json_to_file(data, RESULT_FILE_PATH)

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
    root.minsize(width, height)

# METRICS
def get_cpu_name():
    try:
        cpu_name = subprocess.check_output('wmic cpu get name', shell=True, text=True, stderr=subprocess.STDOUT).strip().split('\n')[-1]
        return cpu_name
    except Exception as e:
        print(f"An error occurred: {e}")
        return None

def get_system_info():
    # Get system information
    cpu_info = get_cpu_name()
    if not cpu_info:
        # Revert to platform info
        cpu_info = platform.processor()
    cpu_usage = psutil.cpu_percent()
    memory_info = psutil.virtual_memory()
    disk_info = psutil.disk_usage('/')
    gpus = GPUtil.getGPUs()
    gpu_info = gpus[0] if gpus else "No GPU detected"

    # Convert bytes to gigabytes
    bytes_to_gb = lambda x: round(x / (1024 ** 3), 2)

    return {
        'cpu_model': cpu_info,
        'cpu_usage': cpu_usage,
        'memory_used': bytes_to_gb(memory_info.used),
        'memory_total': bytes_to_gb(memory_info.total),
        'disk_used': bytes_to_gb(disk_info.used),
        'disk_total': bytes_to_gb(disk_info.total),
        'gpu_model': gpu_info.name if gpu_info else 'N/A',
        'gpu_info': gpu_info.memoryUsed if gpu_info else 'N/A',
        'gpu_total': gpu_info.memoryTotal if gpu_info else 'N/A'
    }