import shared_utils
import os
import win32serviceutil
import win32service
import win32event
import win32process
import win32profile
import win32ts
import win32con
import win32api
import win32gui
import servicemanager
import logging
import psutil
import time
import subprocess
import json
import datetime

"""
To install/run this as a service, 
switch to the current working directory in 
an Administrator Command Prompt & run:
python owlette_service.py install | start | stop | remove
"""

# Constants
LOG_FILE_PATH = shared_utils.get_path('../logs/service.log')
RESULT_FILE_PATH = shared_utils.get_path('../tmp/app_states.json')
MAX_RELAUNCH_ATTEMPTS = 3
SLEEP_INTERVAL = 10
TIME_TO_INIT = 60

# Initialize logging
def initialize_logging():
    with open(LOG_FILE_PATH, 'w'):
        pass
    logging.basicConfig(filename=LOG_FILE_PATH, level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    logging.info("Starting Owlette Service")

# Initialize results file
def initialize_results_file():
    with open(RESULT_FILE_PATH, 'w') as f:
        json.dump({}, f)

# Send email notification
def send_email_notification(process_name, reason, console_user_token, environment, startupInfo):
    config = shared_utils.read_config()
    
    # Check if email configuration exists and is not empty
    email_to = config.get('email', {}).get('to', None)
    if not email_to:
        logging.info("Email to field is empty. Skipping email notification.")
        return

    try:
        start_python_script_as_user(
            shared_utils.get_path('owlette_email.py'),
            f'--process_name "{process_name}" --reason "{reason}"',
            console_user_token, environment,
            startupInfo
        )
        logging.info(f"Email notification sent for process {process_name}.")
    except Exception as e:
        logging.error(f"Could not send email notification for process {process_name}. Error: {e}")

# Check if app is responding (or frozen)
def is_app_not_responding(pid):
    windows = []
    def enum_windows_callback(hwnd, extra):
        _, curr_pid = win32process.GetWindowThreadProcessId(hwnd)
        if curr_pid == pid:
            windows.append(win32gui.GetWindowText(hwnd))
    win32gui.EnumWindows(enum_windows_callback, None)
    #logging.info(windows)
    for title in windows:
        if "Not Responding" in title:
            #logging.info(title)
            return True
    return False

# Check if the service is running
def is_service_running(service_name):
    try:
        # Iterate over all running services
        for service in psutil.win_service_iter():
            if service.name() == service_name:
                if service.status() == 'running':
                    return True
        return False
    except Exception as e:
        print(f"An error occurred: {e}")
        return False

# Check if the script is running
def is_script_running(script_name):
    for process in psutil.process_iter(attrs=['pid', 'name', 'cmdline']):
        if 'python' in process.info['name']:
            #logging.info(process.info['cmdline'])
            if script_name in ' '.join(process.info['cmdline']):
                return True
    return False

# Start a python script as a user
def start_python_script_as_user(script_name, args, console_user_token, environment, startupInfo):
    startupInfo.wShowWindow = win32con.SW_HIDE
    command_line = f'python "{shared_utils.get_path(script_name)}" {args}' if args else f'python "{shared_utils.get_path(script_name)}"'
    #logging.info(command_line)
    win32process.CreateProcessAsUser(console_user_token,
        None,  # Application Name
        command_line,  # Command Line
        None,
        None,
        0,
        win32con.NORMAL_PRIORITY_CLASS,
        environment,  # To open in user's environment
        None,
        startupInfo)

# Start a Windows process as a user
def start_process_as_user(console_user_token, environment, startupInfo, process):
    # show window!
    startupInfo.wShowWindow = win32con.SW_SHOW

    exe_path = process['exe_path']
    file_path = process.get('file_path', '')
    # If file path, add double quotes, else leave as-is (cmd args)
    file_path = f"{file_path}" if os.path.isfile(file_path) else file_path
    logging.info(f"Starting {exe_path} {file_path}...")

    # Build the command line
    command_line = f'"{exe_path}" {file_path}' if file_path else exe_path
    
    # Start the process
    process_info = win32process.CreateProcessAsUser(console_user_token,
        None,  # Application Name
        command_line,  # Command Line
        None,
        None,
        0,
        win32con.NORMAL_PRIORITY_CLASS,
        environment,  # To open in user's environment
        None,
        startupInfo)

    # Get PID
    pid = process_info[2]

    # Get the current Unix timestamp
    current_timestamp = int(time.time())

    # Read existing results from the output file
    if os.path.exists(RESULT_FILE_PATH):
        try:
            with open(RESULT_FILE_PATH, 'r') as f:
                results = json.load(f)
        except json.JSONDecodeError:
            logging.error("Failed to decode JSON from result file.")
            results = {}
        except Exception as e:
            logging.error(f"An error occurred while reading the result file: {e}")
            results = {}
    else:
        results = {}

    # Initialize the entry for the PID if it doesn't exist
    if str(pid) not in results:
        results[str(pid)] = {}

    # Record the timestamp for the newly started process
    results[str(pid)]['timestamp'] = current_timestamp

    #logging.info(results)

    # Write the updated results back to the output file
    with open(RESULT_FILE_PATH, 'w') as f:
        json.dump(results, f)

    return pid

# Check if a Process ID (PID) is running
def is_pid_running(pid):
    try:
        process = psutil.Process(pid)
        return True
    except psutil.NoSuchProcess:
        return False

# Check if process has been restarted more than n times already
def reached_max_relaunch_attempts(process_name, console_user_token, environment, startupInfo):
    try:
        attempts = relaunch_attempts.get(process_name, MAX_RELAUNCH_ATTEMPTS)
        logging.info(f'Process relaunch attempt: {attempts}')

        process_list_id = shared_utils.fetch_process_id_by_name(process_name, shared_utils.read_config())
        relaunches_to_attempt = int(shared_utils.read_config(key='relaunch_attempts', process_list_id=process_list_id))

        if attempts > (relaunches_to_attempt or MAX_RELAUNCH_ATTEMPTS) and relaunches_to_attempt != 0:
            if not is_script_running('prompt_restart.py'):
                success = start_python_script_as_user(
                    shared_utils.get_path('prompt_restart.py'),
                    None,
                    console_user_token, environment,
                    startupInfo
                )
                if success:
                    send_email_notification(
                        process_name,
                        f'Terminated {process_name} {relaunches_to_attempt} times. System reboot imminent.',
                        console_user_token, environment, startupInfo
                    )
                    # Reset the counter for this process
                    del relaunch_attempts[process_name]
                    return True
                else:
                    logging.info(f"Failed to restart {process_name}.")
                    # Reset the counter for this process
                    del relaunch_attempts[process_name]
                    return True

        relaunch_attempts[process_name] = attempts + 1
        return False

    except Exception as e:
        logging.info(e)

# Kill and restart a process
def kill_and_restart_process(pid, process, console_user_token, environment, startupInfo):
    try:
        # If it's been tried 3 times already, prompt user to restart system
        if not reached_max_relaunch_attempts(process['name'], console_user_token, environment, startupInfo):
            psutil.Process(pid).terminate()
            logging.info(f"Terminated process with PID: {pid}")
            
            new_pid = start_process_as_user(console_user_token, environment, startupInfo, process)
            logging.info(f"Restarted process with new PID: {new_pid}")

            send_email_notification(
                process['name'],
                f'Terminated PID {pid} and restarted with new PID {new_pid}',
                console_user_token, environment, startupInfo
            )

            return new_pid

    except Exception as e:
        logging.error(f"Could not kill and restart process {pid}. Error: {e}")

        send_email_notification(
            process['name'],
            f'Could not kill and restart process. Error: {e}',
            console_user_token, environment, startupInfo
        )

        return None

# Main Owlette Windows Service logic
class OwletteService(win32serviceutil.ServiceFramework):
    _svc_name_ = 'OwletteService'
    _svc_display_name_ = 'Owlette Service'

    def __init__(self, args):
        win32serviceutil.ServiceFramework.__init__(self, args)
        self.hWaitStop = win32event.CreateEvent(None, 0, 0, None)
        self.is_alive = True
        self.tray_icon_pid = None
        self.relaunch_attempts = {} # Dictionary to keep track of restart attempts for each process

    # On service stop
    def SvcStop(self):
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        self.is_alive = False
        self.terminate_tray_icon()
        win32event.SetEvent(self.hWaitStop)

    # Terminate the tray icon process if it exists
    def terminate_tray_icon(self):
        if self.tray_icon_pid:
            try:
                psutil.Process(self.tray_icon_pid).terminate()
            except (psutil.NoSuchProcess, Exception) as e:
                logging.error(f"Couldn't terminate tray icon: {e}")

    # While service runs
    def SvcDoRun(self):
        servicemanager.LogMsg(servicemanager.EVENTLOG_INFORMATION_TYPE,
              servicemanager.PYS_SERVICE_STARTED,
              (self._svc_name_, ''))
        self.main()

    def main(self):
        initialize_logging()
        initialize_results_file()
        first_start = True

        # Process startup info
        startupInfo = win32process.STARTUPINFO()
        startupInfo.dwFlags = win32process.STARTF_USESHOWWINDOW

        # Get token for logged-in user
        console_session_id = win32ts.WTSGetActiveConsoleSessionId()
        console_user_token = win32ts.WTSQueryUserToken(console_session_id)
        # Get environment for logged-in user
        environment = win32profile.CreateEnvironmentBlock(console_user_token, False)

        # Dictionary to keep track of the last time a process was started
        last_started = {}

        # Initialize an empty dictionary to hold the results
        results = {}

        while self.is_alive:
            # Start the tray icon script as a subprocess
            if not is_script_running('owlette_tray.py'):
                self.start_owlette_tray(console_user_token, environment, startupInfo)

            # Read the JSON configuration
            config = shared_utils.read_config()

            # Get the current time
            current_time = datetime.datetime.now()

            # Load in latest results from the output file
            content = shared_utils.read_json_from_file(RESULT_FILE_PATH)
            if content:
                results = content

            # Loop over all processes in config json
            for process in config['processes']:
                action = self.handle_process(
                    process,
                    console_user_token,
                    environment,
                    startupInfo,
                    current_time,
                    last_started,
                    results,
                    first_start)
                if action == 'continue':
                    continue

            first_start = False

            # Sleep for 10 seconds
            time.sleep(SLEEP_INTERVAL)

    def start_owlette_tray(self, console_user_token, environment, startupInfo):
        try:
            logging.info("Starting Owlette Tray...")
            startupInfo.wShowWindow = win32con.SW_HIDE
            command_line = f'python "{shared_utils.get_path("owlette_tray.py")}"'
            _, _, pid, _ = win32process.CreateProcessAsUser(console_user_token,
                None,
                command_line,
                None,
                None,
                0,
                win32con.NORMAL_PRIORITY_CLASS,
                environment,
                None,
                startupInfo)
            self.tray_icon_pid = pid
        except Exception as e:
            logging.error(f"Couldn't start Owlette Tray. {e}", exc_info=True)

    def handle_process(self, process, console_user_token, environment, startupInfo, current_time, last_started, results, first_start):
        # Read the autostart_process value from the JSON config
        autostart_process = process.get('autostart_process', False)  # Default to False if not found

        # Only proceed if autostart process is True
        if autostart_process:
            process_name = process['name']
            process_list_id = process['id']
            delay = float(process.get('time_delay', 0))

            last_info = last_started.get(process_list_id, {})
            last_time = last_info.get('time')
            last_pid = last_info.get('pid')

            if last_pid:
                if is_pid_running(last_pid):
                    #logging.info(f'Process is running: {last_pid}')

                    # Run owlette_scout.py to check if process is responsive
                    start_python_script_as_user(
                        'owlette_scout.py', 
                        str(last_pid), 
                        console_user_token, 
                        environment, 
                        startupInfo,
                    )

                    # Read the result file and check if the process is not responding
                    try:
                        is_not_responding = results.get(str(last_pid), {}).get('isNotResponding', False)
                    except json.JSONDecodeError:
                        logging.error("Failed to decode JSON from result file.")
                        is_not_responding = False
                    except Exception as e:
                        logging.error(f"An error occurred while reading the result file: {e}")
                        is_not_responding = False
                    
                    # If process is not responding
                    if is_not_responding:
                        logging.error(f"Process {process_name} (PID: {last_pid}) is not responding.")
                        # Send email notification
                        send_email_notification(process_name, 'frozen', console_user_token, environment, startupInfo)
                        # Attempt to kill and restart process
                        new_pid = kill_and_restart_process(last_pid, process, console_user_token, environment, startupInfo)
                        if new_pid:
                            last_started[process_list_id] = {'time': current_time, 'pid': new_pid}
                    
                    return 'continue'  # Skip the remainder of this iteration if the process is running & responsive

            # Fetch the time to init (how long to give the app to initialize itself / start up)
            time_to_init = float(shared_utils.read_config(key='time_to_init', process_list_id=process_list_id))

            # Give the app time to launch (if it's launching for the first time)
            if last_time is None or (last_time is not None and (current_time - last_time).total_seconds() >= (time_to_init or TIME_TO_INIT)):
                # Delay starting of the app (if applicable)
                time.sleep(delay)

                # If it's not been tried n times already, try to start the process
                if not reached_max_relaunch_attempts(process_name, console_user_token, environment, startupInfo):
                    # Attempt to start the process
                    try:
                        # Only if we're not already on a restart prompt
                        if not is_script_running('prompt_restart.py'):
                            pid = start_process_as_user(console_user_token, environment, startupInfo, process)
                    except Exception as e:
                        logging.error(f"Could not start process {process_name}.\n {e}")
                    # Update the last started time and PID
                    last_started[process_list_id] = {'time': current_time, 'pid': pid}
                    logging.info(f"PID {pid} started.")

                    #logging.info(f'{last_started}')

                    if not first_start:
                        # Send email notification
                        send_email_notification(process_name, 'restarted', console_user_token, environment, startupInfo)

            return 'proceed'

if __name__ == '__main__':
    win32serviceutil.HandleCommandLine(OwletteService)
