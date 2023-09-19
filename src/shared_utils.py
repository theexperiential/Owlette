import os
import json
import logging

def get_path(filename=None):
    # Get the directory of the currently executing script
    path = os.path.dirname(os.path.realpath(__file__))

    # Build the full path to the file name
    if filename is not None:
        path = os.path.join(path, filename)

    # Normalize the path
    path = os.path.normpath(path)
    
    return path

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

def generate_config_file():
    config = {'processes': [], 'email': {'to': []}}
    return config

# Specific function to read config
def read_config(key=None, process_name=None):
    config_path = get_path('../config/config.json')
    config = read_json_from_file(config_path)
    
    if config is None:
        config = generate_config_file()
        with open(config_path, 'w') as f:
            json.dump(config, f)
    
    if key and process_name:
        for process in config['processes']:
            if process['name'] == process_name:
                return process.get(key, None)
    
    return config
