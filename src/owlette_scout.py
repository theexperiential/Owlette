import ctypes
import json
import os
import sys
import time
import win32gui
import win32process
import shared_utils

def is_app_hung(pid):
    hung_windows = []
    def enum_windows_callback(hwnd, extra):
        _, curr_pid = win32process.GetWindowThreadProcessId(hwnd)
        if curr_pid == pid:
            if ctypes.windll.user32.IsHungAppWindow(hwnd):
                hung_windows.append(hwnd)
    win32gui.EnumWindows(enum_windows_callback, None)
    
    # Return True if any hung windows are found, otherwise return False
    if hung_windows:
        return True
    return False

# Get the PID from command-line arguments
pid = int(sys.argv[1])
current_time = int(time.time())  # Get the current timestamp
result = None

# Read existing results from the output file
result_file_path = shared_utils.get_path('../tmp/app_states.json')
if os.path.exists(result_file_path):
    with open(result_file_path, 'r') as f:
        results = json.load(f)
else:
    results = {}

# Check if the process has a timestamp and if it's older than 60 seconds
process_info = results.get(str(pid), {})
timestamp = process_info.get('timestamp', 0)
current_time = int(time.time())
time_since_launch = current_time - timestamp

if time_since_launch < 60:
    print("Ignoring the process as it was launched less than 60 seconds ago.")
    result = False
else:
    result = is_app_hung(pid)

    # Update the results dictionary
    results[str(pid)]['isNotResponding'] = result

# Write the updated results back to the output file
with open(shared_utils.get_path('../tmp/app_states.json'), 'w') as f:
    json.dump(results, f)