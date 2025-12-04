import ctypes
import json
import os
import sys
import time
import win32gui
import win32process
import shared_utils

def is_app_responsive(pid):
    hung_windows = []
    def enum_windows_callback(hwnd, extra):
        _, curr_pid = win32process.GetWindowThreadProcessId(hwnd)
        if curr_pid == pid:
            if ctypes.windll.user32.IsHungAppWindow(hwnd):
                hung_windows.append(hwnd)
    win32gui.EnumWindows(enum_windows_callback, None)
    
    # Return False if any hung windows are found, otherwise return True
    if hung_windows:
        return False
    return True

# Get the PID from command-line arguments
pid = int(sys.argv[1])
current_time = int(time.time())  # Get the current timestamp
result = True

# Read existing results from the output file
results = shared_utils.read_json_from_file(shared_utils.RESULT_FILE_PATH)

# Defensive programming: ensure results is never None
if results is None:
    results = {}

# Check if the process has a timestamp and if it's older than 60 seconds
process_info = results.get(str(pid), {})
timestamp = process_info.get('timestamp', 0)
current_time = int(time.time())
time_since_launch = current_time - timestamp

if time_since_launch < 60:
    # Process is still initializing, don't check responsiveness yet
    result = True
else:
    result = is_app_responsive(pid)

# Update the results dictionary
if str(pid) not in results:
    results[str(pid)] = {}

results[str(pid)]['responsive'] = result

# Track hung_since timestamp for confirmation-based killing
if not result:
    # Process is hung - record when we first detected it (if not already recorded)
    if 'hung_since' not in results[str(pid)] or results[str(pid)].get('responsive_prev', True):
        results[str(pid)]['hung_since'] = current_time
else:
    # Process is responsive - clear any hung tracking
    if 'hung_since' in results[str(pid)]:
        del results[str(pid)]['hung_since']

# Track previous responsive state for edge detection
results[str(pid)]['responsive_prev'] = result

# Write the updated results back to the output file
shared_utils.write_json_to_file(results, shared_utils.RESULT_FILE_PATH)