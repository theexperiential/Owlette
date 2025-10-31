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
import psutil

# GLOBAL VARS

APP_VERSION = '2.0.0'
CONFIG_VERSION = '1.3.0'
# Color scheme matching web app (Tailwind slate palette)
WINDOW_COLOR = '#020617'      # slate-950 - main background
FRAME_COLOR = '#0f172a'       # slate-900 - panels/cards
BUTTON_COLOR = '#1e293b'      # slate-800 - buttons
BUTTON_HOVER_COLOR = '#334155' # slate-700 - button hover
BUTTON_IMPORTANT_COLOR = '#2563eb' # blue-600 - accent buttons (New, autolaunch toggle)
TEXT_COLOR = "white"
WINDOW_TITLES = {
    "owlette_gui": "Owlette Configuration", 
    "prompt_slack_config": "Connect to Slack",
    "prompt_restart": "Process repeatedly failing!"
}
SERVICE_NAME = 'OwletteService'


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

def is_script_running(script_name):
    for process in psutil.process_iter(attrs=['pid', 'name', 'cmdline']):
        logging.debug(f"Checking process: {process.info['name']}")
        logging.debug(f"Looking for script: {script_name}")
        if 'python' in process.info['name']:
            if script_name in ' '.join(process.info['cmdline']):
                return True
    return False

# PATHS
CONFIG_PATH = get_path('../config/config.json')
RESULT_FILE_PATH = get_path('../tmp/app_states.json')

# LOGGING
# Initialize logging with a rotating file handler
def initialize_logging(log_file_name, level=logging.INFO):
    log_file_path = get_path(f'../logs/{log_file_name}.log')

    # DON'T clear the log file - let RotatingFileHandler manage it
    # This preserves historical logs for debugging crashes and issues
    # Old code (removed):
    # with open(log_file_path, 'w'):
    #     pass

    # Create a formatter for the log messages
    log_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')

    # Create a handler that writes log messages to a file, with a maximum
    # log file size of 5 MB, keeping 2 old log files.
    # Mode 'a' appends to existing file instead of overwriting
    log_handler = RotatingFileHandler(log_file_path, mode='a', maxBytes=5*1024*1024, backupCount=2, encoding=None, delay=0)

    # Set the formatter for the handler
    log_handler.setFormatter(log_formatter)

    # Create the logger and set its level
    logger = logging.getLogger()
    logger.setLevel(level)

    # Add the handler to the logger
    logger.addHandler(log_handler)

    # Log an initial message with clear separator for new service start
    logging.info("="*60)
    logging.info(f"Starting {log_file_name}...")
    logging.info("="*60)

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
                for key in ['id', 'name', 'exe_path', 'file_path', 'cwd', 'time_delay', 'time_to_init', 'relaunch_attempts', 'autolaunch', 'visibility', 'priority']:
                    if key == 'visibility':
                        process.setdefault(key, 'Show')
                    elif key == 'priority':
                        process.setdefault(key, 'Normal')
                    elif key == 'cwd':
                        process.setdefault(key, None)
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

# Writes a Python dictionary to a JSON file using atomic write pattern
def write_json_to_file(data, file_path):
    with json_lock:
        # Use atomic write pattern: write to temp file, then rename
        temp_path = file_path + '.tmp'
        try:
            # Write to temporary file first
            with open(temp_path, 'w') as f:
                json.dump(data, f, indent=4)

            # Atomic rename (replaces existing file)
            # os.replace is atomic on Windows (unlike os.rename)
            os.replace(temp_path, file_path)
        except Exception as e:
            # Clean up temp file if it exists
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except:
                    pass
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
        logging.debug(f"No processes found with id: {target_id}")
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
        logging.debug(f"Error getting CPU name: {e}")
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

def get_system_metrics():
    """
    Get system metrics with clear units for Firebase.
    Returns CPU %, memory (used/total GB), disk (used/total GB), GPU (usage % and VRAM used/total GB).
    Also includes process information from config and runtime state.
    """
    try:
        # CPU - percentage
        cpu_percent = round(psutil.cpu_percent(interval=0.1), 1)

        # Memory - bytes to GB
        mem = psutil.virtual_memory()
        mem_used_gb = round(mem.used / (1024**3), 2)
        mem_total_gb = round(mem.total / (1024**3), 2)
        mem_percent = round(mem.percent, 1)

        # Disk - bytes to GB
        disk = psutil.disk_usage('/')
        disk_used_gb = round(disk.used / (1024**3), 2)
        disk_total_gb = round(disk.total / (1024**3), 2)
        disk_percent = round(disk.percent, 1)

        # GPU - usage % and VRAM
        gpu_usage_percent = 0
        gpu_vram_used_gb = 0
        gpu_vram_total_gb = 0
        gpu_name = "N/A"
        try:
            gpus = GPUtil.getGPUs()
            if gpus:
                gpu = gpus[0]
                gpu_usage_percent = round(gpu.load * 100, 1)
                gpu_vram_used_gb = round(gpu.memoryUsed / 1024, 2)  # MB to GB
                gpu_vram_total_gb = round(gpu.memoryTotal / 1024, 2)
                gpu_name = gpu.name
        except:
            pass

        # Processes - combine config and runtime state
        processes_data = {}
        try:
            # Read process configuration
            config = read_json_from_file(CONFIG_PATH)
            # Read runtime state
            runtime_state = read_json_from_file(RESULT_FILE_PATH)

            if config and 'processes' in config:
                # Create a map of process IDs to their runtime PIDs
                pid_to_runtime = {}
                if runtime_state:
                    for pid, state_info in runtime_state.items():
                        process_id = state_info.get('id')
                        if process_id:
                            pid_to_runtime[process_id] = {
                                'pid': int(pid),
                                'status': state_info.get('status', 'UNKNOWN'),
                                'responsive': state_info.get('responsive', True),
                                'timestamp': state_info.get('timestamp', 0)
                            }

                # Build processes data structure
                for index, process in enumerate(config['processes']):
                    process_id = process.get('id')
                    if process_id:
                        # Start with configuration data
                        process_data = {
                            'name': process.get('name', ''),
                            'exe_path': process.get('exe_path', ''),
                            'file_path': process.get('file_path', ''),
                            'cwd': process.get('cwd', ''),
                            'autolaunch': process.get('autolaunch', False),
                            'priority': process.get('priority', 'Normal'),
                            'visibility': process.get('visibility', 'Show'),
                            'time_delay': process.get('time_delay', 0),
                            'time_to_init': process.get('time_to_init', 10),
                            'relaunch_attempts': process.get('relaunch_attempts', 3),
                            'index': index  # Preserve config order for web app display
                        }

                        # Add runtime state if available
                        if process_id in pid_to_runtime:
                            runtime = pid_to_runtime[process_id]
                            process_data['pid'] = runtime['pid']
                            process_data['status'] = runtime['status']
                            process_data['responsive'] = runtime['responsive']
                            process_data['last_updated'] = runtime['timestamp']
                        else:
                            # Process not running
                            process_data['pid'] = None
                            process_data['status'] = 'INACTIVE' if not process.get('autolaunch', False) else 'STOPPED'
                            process_data['responsive'] = True
                            process_data['last_updated'] = 0

                        processes_data[process_id] = process_data
        except Exception as e:
            logging.error(f"Error collecting process data: {e}")

        return {
            'cpu': {
                'percent': cpu_percent,
                'unit': '%'
            },
            'memory': {
                'used_gb': mem_used_gb,
                'total_gb': mem_total_gb,
                'percent': mem_percent,
                'unit': 'GB'
            },
            'disk': {
                'used_gb': disk_used_gb,
                'total_gb': disk_total_gb,
                'percent': disk_percent,
                'unit': 'GB'
            },
            'gpu': {
                'name': gpu_name,
                'usage_percent': gpu_usage_percent,
                'vram_used_gb': gpu_vram_used_gb,
                'vram_total_gb': gpu_vram_total_gb,
                'unit': 'GB'
            },
            'processes': processes_data
        }
    except Exception as e:
        logging.error(f"Error getting system metrics: {e}")
        return {
            'cpu': {'percent': 0, 'unit': '%'},
            'memory': {'used_gb': 0, 'total_gb': 0, 'percent': 0, 'unit': 'GB'},
            'disk': {'used_gb': 0, 'total_gb': 0, 'percent': 0, 'unit': 'GB'},
            'gpu': {'name': 'N/A', 'usage_percent': 0, 'vram_used_gb': 0, 'vram_total_gb': 0, 'unit': 'GB'},
            'processes': {}
        }