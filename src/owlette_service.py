import shared_utils
import os
import win32serviceutil
import win32service
import win32event
import win32process
import win32profile
import win32ts
import win32con
import servicemanager
import logging
import psutil
import time
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
MAX_RELAUNCH_ATTEMPTS = 3
SLEEP_INTERVAL = 10
TIME_TO_INIT = 60

# Utility functions
class Util:

    # Initialize results file
    @staticmethod
    def initialize_results_file():
        with open(shared_utils.RESULT_FILE_PATH, 'w') as f:
            json.dump({}, f)

    # Check if the script is running
    @staticmethod
    def is_script_running(script_name):
        for process in psutil.process_iter(attrs=['pid', 'name', 'cmdline']):
            if 'python' in process.info['name']:
                if script_name in ' '.join(process.info['cmdline']):
                    return True
        return False

    # Check if a Process ID (PID) is running
    @staticmethod
    def is_pid_running(pid):
        try:
            process = psutil.Process(pid)
            return True
        except psutil.NoSuchProcess:
            return False

    @staticmethod
    def get_process_name(process):
        return process.get('name', 'Error retrieving process name')


# Main Owlette Windows Service logic
class OwletteService(win32serviceutil.ServiceFramework):
    _svc_name_ = 'OwletteService'
    _svc_display_name_ = 'Owlette Service'

    def __init__(self, args):
        win32serviceutil.ServiceFramework.__init__(self, args)

        # Initialize logging and shared resources
        shared_utils.initialize_logging("service")
        Util.initialize_results_file()

        # Upgrade JSON config to latest version
        shared_utils.upgrade_config()

        self.hWaitStop = win32event.CreateEvent(None, 0, 0, None)
        self.is_alive = True
        self.tray_icon_pid = None
        self.relaunch_attempts = {} # Restart attempts for each process
        self.first_start = True # First start of this service
        self.last_started = {} # Last time a process was started
        self.results = {} # App process response esults
        self.current_time = datetime.datetime.now()

    # On service stop
    def SvcStop(self):
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        self.is_alive = False
        self.terminate_tray_icon()
        win32event.SetEvent(self.hWaitStop)

    # While service runs
    def SvcDoRun(self):
        try:
            servicemanager.LogMsg(servicemanager.EVENTLOG_INFORMATION_TYPE,
                  servicemanager.PYS_SERVICE_STARTED,
                  (self._svc_name_, ''))
            self.main()
        except Exception as e:
            logging.error(f"An unhandled exception occurred: {e}")

    # Log errors
    def log_and_notify(self, process, reason):
        process_name = Util.get_process_name(process)

        # Logging
        logging.error(reason)

        # Slack
        if shared_utils.read_config(['slack', 'enabled']):
            self.send_notification('slack', process_name, reason)
        
        # Email
        if shared_utils.read_config(['gmail', 'enabled']):
            self.send_notification('gmail', process_name, reason)
    
    # Start the tray icon as a user process
    def start_tray_icon(self):
        try:
            logging.info("Starting Owlette Tray...")
            self.startup_info.wShowWindow = win32con.SW_HIDE
            command_line = f'python "{shared_utils.get_path("owlette_tray.py")}"'
            _, _, pid, _ = win32process.CreateProcessAsUser(self.console_user_token,
                None,
                command_line,
                None,
                None,
                0,
                win32con.NORMAL_PRIORITY_CLASS,
                self.environment,
                None,
                self.startup_info)
            self.tray_icon_pid = pid

        except win32process.error as e:
            logging.error(f"Win32 Process Error while starting Owlette Tray: {e}")
        except PermissionError as e:
            logging.error(f"Permission Error while starting Owlette Tray: {e}")         
        except Exception as e:
            logging.error(f"Couldn't start Owlette Tray. {e}", exc_info=True)

    # Terminate the tray icon process if it exists
    def terminate_tray_icon(self):
        if self.tray_icon_pid:
            try:
                psutil.Process(self.tray_icon_pid).terminate()
            except psutil.NoSuchProcess:
                logging.error("No such process to terminate.")
            except psutil.AccessDenied:
                logging.error("Access denied while trying to terminate the process.")
            except Exception as e:
                logging.error(f"An unexpected error occurred while terminating the process: {e}")

    # Send gmail/slack notification
    def send_notification(self, notification_type, process_name, reason):
        try:
            if notification_type == 'gmail':
                script_path = shared_utils.get_path('owlette_gmail.py')
            elif notification_type == 'slack':
                script_path = shared_utils.get_path('owlette_slack.py')
            else:
                logging.error(f"Unknown notification type: {notification_type}")
                return

            self.start_python_script_as_user(
                script_path,
                f'--process_name "{process_name}" --reason "{reason}"'
            )
            logging.info(f"{notification_type.capitalize()} notification sent for process {process_name}")
        except Exception as e:
            logging.error(f"Could not send {notification_type} notification for process {process_name}. Error: {e}")


    # Start a python script as a user
    def start_python_script_as_user(self, script_name, args):
        try:
            self.startup_info.wShowWindow = win32con.SW_HIDE
            command_line = f'python "{shared_utils.get_path(script_name)}" {args}' if args else f'python "{shared_utils.get_path(script_name)}"'
            #logging.info(command_line)
            win32process.CreateProcessAsUser(self.console_user_token,
                None,  # Application Name
                command_line,  # Command Line
                None,
                None,
                0,
                win32con.NORMAL_PRIORITY_CLASS,
                self.environment,  # To open in user's self.environment
                None,
                self.startup_info)
            return True
        except Exception as e:
            logging.error(f"Failed to start process: {e}")
            return False

    # Start a Windows process as a user
    def start_process_as_user(self, process):
        # Get visibility, default is shown
        visibility = process.get('visibility', 'Show')

        # Map process priority, default is normal
        priority = process.get('priority', 'Normal')
        priority_mapping = {
            "Low": win32con.IDLE_PRIORITY_CLASS,
            #"Below Normal": win32con.BELOW_NORMAL_PRIORITY_CLASS, # doesn't seem to work?
            "Normal": win32con.NORMAL_PRIORITY_CLASS,
            #"Above Normal": win32con.ABOVE_NORMAL_PRIORITY_CLASS, # doesn't seem to work?
            "High": win32con.HIGH_PRIORITY_CLASS,
            "Realtime": win32con.REALTIME_PRIORITY_CLASS
        }
        priority_class = priority_mapping.get((priority), win32con.NORMAL_PRIORITY_CLASS)

        # Show or hide window!
        self.startup_info.wShowWindow = win32con.SW_SHOW if visibility == 'Show' else win32con.SW_HIDE

        # Fetch and verify executable path
        exe_path = process.get('exe_path', '')
        try:
            if not os.path.isfile(exe_path):
                raise FileNotFoundError('Executable path not found!')
        except Exception as e:
            logging.error(f'Error: {e}')
            return None

        # Fetch file path
        file_path = process.get('file_path', '')
        # If file path, add double quotes, else leave as-is (cmd args)
        file_path = f"{file_path}" if os.path.isfile(file_path) else file_path
        logging.info(f"Starting {exe_path}{' ' if file_path else ''}{file_path}...")

        # Build the command line
        command_line = f'"{exe_path}" {file_path}' if file_path else exe_path
        
        # Start the process
        process_info = win32process.CreateProcessAsUser(
            self.console_user_token,
            None,  # Application Name
            command_line,  # Command Line
            None, # Process Attributes
            None, # Thread Attributes
            0, # Inherit handles
            priority_class, # Creation flags
            self.environment,  # To open in user's self.environment
            None, # Current directory
            self.startup_info)

        # Get PID
        pid = process_info[2]

        # Get the current Unix timestamp
        self.current_timestamp = int(time.time())

        # Read existing results from the output file
        try:
            self.results = shared_utils.read_json_from_file(shared_utils.RESULT_FILE_PATH)
        except:
            logging.error('JSON read error')
            self.results = {}

        # Initialize the entry for the PID if it doesn't exist
        if str(pid) not in self.results:
            self.results[str(pid)] = {}

        # Record the timestamp for the newly started process
        self.results[str(pid)]['timestamp'] = self.current_timestamp

        # Add process list ID
        self.results[str(pid)]['id'] = process['id']

        # Write the updated results back to the output file
        try:
            shared_utils.write_json_to_file(self.results, shared_utils.RESULT_FILE_PATH)
        except:
            logging.error('JSON write error')

        return pid

    # Check if process has been restarted more than n times already
    def reached_max_relaunch_attempts(self, process):
        process_name = Util.get_process_name(process)
        try:
            attempts = self.relaunch_attempts.get(process_name, 0 if self.first_start else 1)

            process_list_id = shared_utils.fetch_process_id_by_name(process_name, shared_utils.read_config())
            relaunches_to_attempt = int(shared_utils.read_config(keys=['relaunch_attempts'], process_list_id=process_list_id))

            # Check if restart prompt is running
            if not Util.is_script_running('prompt_restart.py'):
                if 0 < attempts <= (relaunches_to_attempt or MAX_RELAUNCH_ATTEMPTS):
                    self.log_and_notify(
                        process,
                        f'Process relaunch attempt: {attempts}'
                    )
                if attempts > (relaunches_to_attempt or MAX_RELAUNCH_ATTEMPTS) and relaunches_to_attempt != 0:
                    # If a restart prompt isn't already running, open one
                    started_restart_prompt = self.start_python_script_as_user(
                        shared_utils.get_path('prompt_restart.py'),
                        None
                    )
                    if started_restart_prompt:
                        self.log_and_notify(
                            process,
                            f'Terminated {process_name} {relaunches_to_attempt} times. System reboot imminent'
                        )
                        # Reset the counter for this process
                        del self.relaunch_attempts[process_name]
                        return True
                    else:
                        logging.info('Failed to open restart prompt.')
            else:
                return True # If it's running, we've already reached the max attempts

            self.relaunch_attempts[process_name] = attempts + 1
            return False

        except Exception as e:
            logging.info(e)

    # Kill and restart a process
    def kill_and_relaunch_process(self, pid, process):
        # Ensure process has not exceeded maximum relaunch attempts
        process_name = Util.get_process_name(process)
        if not self.reached_max_relaunch_attempts(process):
            try:
                psutil.Process(pid).terminate()
                new_pid = self.start_process_as_user(process)
                self.log_and_notify(
                    process,
                    f'Terminated PID {pid} and restarted with new PID {new_pid}'
                )

                return new_pid

            except Exception as e:
                self.log_and_notify(
                    process,
                    f"Could not kill and restart process {pid}. Error: {e}"
                )
                return None

    # Attempt to launch the process if not running
    def handle_process_launch(self, process):
        # Ensure process has not exceeded maximum relaunch attempts
        if not self.reached_max_relaunch_attempts(process):
            process_list_id = process['id']
            delay = float(process.get('time_delay', 0))
            
            # Fetch the time to init (how long to give the app to initialize itself / start up)
            time_to_init = float(shared_utils.read_config(keys=['time_to_init'], process_list_id=process_list_id))

            # Give the app time to launch (if it's launching for the first time)
            last_info = self.last_started.get(process_list_id, {})
            last_time = last_info.get('time')
            
            if last_time is None or (last_time is not None and (self.current_time - last_time).total_seconds() >= (time_to_init or TIME_TO_INIT)):
                # Delay starting of the app (if applicable)
                time.sleep(delay)

                logging.info('got here')
                # Attempt to start the process
                try:
                    pid = self.start_process_as_user(process)
                except Exception as e:
                    logging.error(f"Could not start process {Util.get_process_name(process)}.\n {e}")
                
                # Update the last started time and PID
                self.last_started[process_list_id] = {'time': self.current_time, 'pid': pid}
                logging.info(f"PID {pid} started")
                
                logging.info(pid)

                return pid  # Return the new PID
            
            return None  # Return None if the process was not started

    # If process not responding, attempt to kill and relaunch
    def handle_unresponsive_process(self, pid, process):
        # Check JSON for process response status
        process_name = Util.get_process_name(process)
        try:
            is_not_responding = self.results.get(str(pid), {}).get('isNotResponding', False)
        except json.JSONDecodeError:
            logging.error("Failed to decode JSON from result file")
            is_not_responding = False
        except Exception:
            logging.error("An unexpected error occurred")
            is_not_responding = False

        # Attempt to kill and relaunch if unresponsive
        if is_not_responding:
            self.log_and_notify(
                process,
                f"Process {process_name} (PID {pid}) is not responding"
            )
            time.sleep(1)
            new_pid = self.kill_and_relaunch_process(pid, process)
            return new_pid
        return None

    # Main process handler
    def handle_process(self, process):
        process_list_id = process['id']
        last_info = self.last_started.get(process_list_id, {})
        last_pid = last_info.get('pid')
        
        # Launch process if this is the first startup
        if self.first_start:
            new_pid = self.handle_process_launch(process)
        else:
            # Check if process is running
            if last_pid and Util.is_pid_running(last_pid):
                # Launch scout to check if process is responsive
                self.start_python_script_as_user(
                    shared_utils.get_path('owlette_scout.py'), 
                    str(last_pid)
                )
                new_pid = self.handle_unresponsive_process(last_pid, process)
            else:
                # Launch the process if it isn't running
                new_pid = self.handle_process_launch(process)
    
        if new_pid:
            self.last_started[process_list_id] = {'time': self.current_time, 'pid': new_pid}

    # Main main
    def main(self):
        # Process startup info
        self.startup_info = win32process.STARTUPINFO()
        self.startup_info.dwFlags = win32process.STARTF_USESHOWWINDOW

        # Get token for logged-in user
        self.console_session_id = win32ts.WTSGetActiveConsoleSessionId()
        self.console_user_token = win32ts.WTSQueryUserToken(self.console_session_id)
        # Get self.environment for logged-in user
        self.environment = win32profile.CreateEnvironmentBlock(self.console_user_token, False)

        # The heart of Owlette
        while self.is_alive:
            # Start the tray icon script as a process (if it isn't running)
            if not Util.is_script_running('owlette_tray.py'):
                self.start_tray_icon()

            # Get the current time
            self.current_time = datetime.datetime.now()

            # Load in latest results from the output file
            content = shared_utils.read_json_from_file(shared_utils.RESULT_FILE_PATH)
            if content:
                self.results = content

            # Load in all processes in config json
            processes = shared_utils.read_config(['processes'])
            for process in processes:
                if process.get('autolaunch', False): # Default to False if not found
                    self.handle_process(process)

            if self.first_start:
                logging.info('Owlette initialized')

            self.first_start = False

            # Sleep for 10 seconds
            time.sleep(SLEEP_INTERVAL)

if __name__ == '__main__':
    win32serviceutil.HandleCommandLine(OwletteService)
