import os
import sys

# Add the src directory to Python path so imports work when running as service
src_dir = os.path.dirname(os.path.abspath(__file__))
if src_dir not in sys.path:
    sys.path.insert(0, src_dir)

import shared_utils
import installer_utils
import project_utils
import registry_utils
import win32serviceutil
import win32service
import win32event
import win32process
import win32profile
import win32ts
import win32con
import win32gui
import servicemanager
import logging
import psutil
import time
import json
import datetime
import atexit

# Firebase integration
FIREBASE_IMPORT_ERROR = None
try:
    from firebase_client import FirebaseClient
    FIREBASE_AVAILABLE = True
except ImportError as e:
    FIREBASE_AVAILABLE = False
    FIREBASE_IMPORT_ERROR = str(e)
    # Note: logging not initialized yet, so we can't log here

"""
To install/run this as a service, 
switch to the current working directory in 
an Administrator Command Prompt & run:
python owlette_service.py install | start | stop | remove
"""

# Constants
LOG_FILE_PATH = shared_utils.get_data_path('logs/service.log')
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

        # Initialize logging and shared resources with configurable log level
        log_level = shared_utils.get_log_level_from_config()
        shared_utils.initialize_logging("service", level=log_level)

        # Only initialize results file if it doesn't exist (don't clear existing PIDs!)
        if not os.path.exists(shared_utils.RESULT_FILE_PATH):
            Util.initialize_results_file()
            logging.info("Initialized new app_states.json file")

        # Upgrade JSON config to latest version
        logging.info(f"Config path: {shared_utils.CONFIG_PATH}")
        shared_utils.upgrade_config()

        self.hWaitStop = win32event.CreateEvent(None, 0, 0, None)
        self.is_alive = True
        self.tray_icon_pid = None
        self.relaunch_attempts = {} # Restart attempts for each process
        self.first_start = True # First start of this service
        self.last_started = {} # Last time a process was started
        self.results = {} # App process response esults
        self.current_time = datetime.datetime.now()
        self.active_installations = {} # Track active installer processes for cancellation

        # Initialize Firebase client
        self.firebase_client = None
        logging.info(f"Firebase check - Available: {FIREBASE_AVAILABLE}")

        if not FIREBASE_AVAILABLE and FIREBASE_IMPORT_ERROR:
            logging.warning(f"Firebase client not available - Import error: {FIREBASE_IMPORT_ERROR}")
            logging.warning("Running in local-only mode")

        if FIREBASE_AVAILABLE:
            firebase_enabled = shared_utils.read_config(['firebase', 'enabled'])
            logging.info(f"Firebase config - enabled: {firebase_enabled}")

            if firebase_enabled:
                try:
                    # Get configuration
                    site_id = shared_utils.read_config(['firebase', 'site_id'])
                    project_id = shared_utils.read_config(['firebase', 'project_id']) or "owlette-dev-3838a"
                    api_base = shared_utils.read_config(['firebase', 'api_base']) or "https://owlette.app/api"
                    cache_path = shared_utils.get_data_path('cache/firebase_cache.json')

                    logging.info(f"Firebase config - site: {site_id}, project: {project_id}")

                    # Initialize OAuth authentication manager
                    from auth_manager import AuthManager
                    auth_manager = AuthManager(api_base=api_base)

                    # Check if authenticated
                    if not auth_manager.is_authenticated():
                        logging.error("Agent not authenticated - no refresh token found")
                        logging.error("Please run the installer or re-authenticate via web dashboard")
                        self.firebase_client = None
                    else:
                        # Initialize Firebase client with OAuth
                        self.firebase_client = FirebaseClient(
                            auth_manager=auth_manager,
                            project_id=project_id,
                            site_id=site_id,
                            config_cache_path=cache_path
                        )
                        logging.info(f"Firebase client initialized for site: {site_id}")

                except Exception as e:
                    logging.error(f"Failed to initialize Firebase client: {e}")
                    logging.exception("Firebase initialization error details:")
                    self.firebase_client = None

    # On service stop
    def SvcStop(self):
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        logging.info("Service stop requested - setting machine offline in Firebase...")
        self.is_alive = False

        # Stop Firebase client (this sets machine offline)
        if self.firebase_client:
            try:
                self.firebase_client.stop()
                logging.info("✓ Firebase client stopped and machine set to offline")
            except Exception as e:
                logging.error(f"✗ Error stopping Firebase client: {e}")

        # Close any open Owlette windows (GUI, prompts, etc.)
        self.close_owlette_windows()

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

    # Close all Owlette windows
    def close_owlette_windows(self):
        """Close all Owlette GUI windows (config, prompts, etc.) when service stops."""
        try:
            for key, window_title in shared_utils.WINDOW_TITLES.items():
                try:
                    # Try to find the window
                    hwnd = win32gui.FindWindow(None, window_title)
                    if hwnd:
                        # Close the window
                        win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
                        logging.info(f"Closed window: {window_title}")
                except Exception as e:
                    logging.debug(f"Could not close window '{window_title}': {e}")
        except Exception as e:
            logging.error(f"Error closing Owlette windows: {e}")

    # Recover PIDs from previous session
    def recover_running_processes(self):
        """
        On service restart, check if processes from previous session are still running.
        If they are, adopt them instead of launching new instances.
        Also cleans up dead PIDs to prevent unbounded file growth.
        """
        try:
            # Read the persisted state
            app_states = shared_utils.read_json_from_file(shared_utils.RESULT_FILE_PATH)

            if not app_states:
                logging.info("No previous app states found (file empty or doesn't exist)")
                return

            logging.info(f"Found {len(app_states)} PID(s) in app_states.json")

            # Clean up dead PIDs immediately to prevent unbounded growth
            cleaned_states = {}
            dead_pid_count = 0

            # Get current config
            config = shared_utils.read_config()
            if not config:
                logging.warning("Could not load config for process recovery")
                return

            processes = config.get('processes', [])
            logging.info(f"Checking {len(processes)} configured process(es) for recovery")

            # Check each PID in the state file
            recovered_count = 0
            for pid_str, state_info in app_states.items():
                try:
                    pid = int(pid_str)
                    process_id = state_info.get('id')

                    logging.debug(f"Checking PID {pid} (process ID: {process_id})")

                    # Check if this PID is still running
                    if Util.is_pid_running(pid):
                        logging.info(f"PID {pid} is still running")

                        # Validate that this PID is actually the expected process (prevent PID reuse/hijacking)
                        if process_id:
                            process = next((p for p in processes if p.get('id') == process_id), None)

                            if process:
                                # Validate executable path matches
                                try:
                                    import psutil
                                    actual_process = psutil.Process(pid)
                                    actual_exe = actual_process.exe().lower()
                                    expected_exe = process.get('exe_path', '').replace('/', '\\').lower()

                                    # Check if the executable matches
                                    if expected_exe and expected_exe in actual_exe:
                                        # Valid process - keep in cleaned state
                                        cleaned_states[pid_str] = state_info

                                        # Only recover if autolaunch is enabled
                                        if process.get('autolaunch', False):
                                            # Adopt this process
                                            self.last_started[process_id] = {
                                                'time': datetime.datetime.now(),
                                                'pid': pid
                                            }
                                            recovered_count += 1
                                            logging.info(f"✓ Recovered process '{process.get('name')}' with PID {pid}")
                                        else:
                                            logging.info(f"Skipping recovery of '{process.get('name')}' (PID {pid}) - autolaunch is disabled")
                                    else:
                                        # PID reused for different process - don't recover
                                        dead_pid_count += 1
                                        logging.warning(f"PID {pid} is running but executable mismatch (expected: {expected_exe}, actual: {actual_exe}) - likely PID reuse, not recovering")
                                except psutil.NoSuchProcess:
                                    # Process died between is_running check and exe() call
                                    dead_pid_count += 1
                                    logging.debug(f"PID {pid} died during validation")
                                except Exception as e:
                                    # On validation error, keep the PID to be safe
                                    cleaned_states[pid_str] = state_info
                                    logging.warning(f"Could not validate PID {pid}: {e} - keeping in state")
                            else:
                                # Process ID not found in config - keep in state but don't recover
                                cleaned_states[pid_str] = state_info
                                logging.warning(f"PID {pid} is running but process ID {process_id} not found in config")
                        else:
                            # No process ID in state - keep but warn
                            cleaned_states[pid_str] = state_info
                            logging.warning(f"PID {pid} has no process ID in state file")
                    else:
                        # PID is no longer running - don't add to cleaned_states
                        dead_pid_count += 1
                        logging.debug(f"PID {pid_str} is no longer running (will be removed from state file)")
                except Exception as e:
                    logging.error(f"Error checking PID {pid_str}: {e}")
                    # On error, keep the PID to be safe
                    cleaned_states[pid_str] = state_info

            # Write cleaned state back to file (removes dead PIDs)
            if dead_pid_count > 0:
                shared_utils.write_json_to_file(cleaned_states, shared_utils.RESULT_FILE_PATH)
                logging.info(f"✓ Cleaned up {dead_pid_count} dead PID(s) from state file")

            if recovered_count > 0:
                logging.info(f"✓ Successfully recovered {recovered_count} running process(es) from previous session")
            else:
                logging.info("No running processes to recover from previous session")

        except Exception as e:
            logging.error(f"Error recovering processes from previous session: {e}")
            logging.exception("Full traceback:")

    # Log errors
    def log_and_notify(self, process, reason):
        process_name = Util.get_process_name(process)

        # Logging
        logging.error(reason)

        # Note: Gmail and Slack notifications removed - use Firebase for centralized monitoring
    
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

    # Start a python script as a user
    def launch_python_script_as_user(self, script_name, args=None):
        try:
            self.startup_info.wShowWindow = win32con.SW_HIDE
            command_line = f'python "{shared_utils.get_path(script_name)}" {args}' if args else f'python "{shared_utils.get_path(script_name)}"'
            #logging.info(command_line)
            _, _, pid, _ = win32process.CreateProcessAsUser(self.console_user_token,
                None,  # Application Name
                command_line,  # Command Line
                None,
                None,
                0,
                win32con.NORMAL_PRIORITY_CLASS,
                self.environment,  # To open in user's self.environment
                None,
                self.startup_info)
            if 'owlette_tray.py' in script_name:
                self.tray_icon_pid = pid
            return True
        except Exception as e:
            logging.error(f"Failed to start process: {e}")
            return False

    # Start a Windows process as a user
    def launch_process_as_user(self, process):
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
        # Convert forward slashes to backslashes for Windows
        exe_path = exe_path.replace('/', '\\')
        try:
            if not os.path.isfile(exe_path):
                raise FileNotFoundError('Executable path not found!')
        except Exception as e:
            logging.error(f'Error: {e}')
            return None

        # Fetch file path
        file_path = process.get('file_path', '')
        if file_path:
            # Convert forward slashes to backslashes for Windows
            file_path = file_path.replace('/', '\\')
        # If file path exists, leave as-is (could be file or cmd args)
        file_path = f"{file_path}" if os.path.isfile(file_path) else file_path
        logging.info(f"Starting {exe_path}{' ' if file_path else ''}{file_path}...")

        # Build the command line - always quote exe_path for paths with spaces
        command_line = f'"{exe_path}" {file_path}' if file_path else f'"{exe_path}"'

        # Fetch working directory (convert empty string to None)
        cwd = process.get('cwd', None)
        if cwd == '':
            cwd = None
        if cwd and not os.path.isdir(cwd):
            logging.error(f"Working directory {cwd} does not exist.")
            return None

        # Start the process
        try:
            process_info = win32process.CreateProcessAsUser(
                self.console_user_token,
                None,  # Application Name
                command_line,  # Command Line
                None, # Process Attributes
                None, # Thread Attributes
                0, # Inherit handles
                priority_class, # Creation flags
                self.environment,  # To open in user's environment
                cwd, # Current directory
                self.startup_info
            )
        except Exception as e:
            logging.error(f"Failed to start process: {e}")
            return None

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

        # Update status
        self.results[str(pid)]['status'] = 'LAUNCHING'

        # Write the updated results back to the output file
        try:
            shared_utils.write_json_to_file(self.results, shared_utils.RESULT_FILE_PATH)
        except:
            logging.error('JSON write error')

        # Immediately sync to Firestore
        if self.firebase_client and self.firebase_client.is_connected():
            try:
                metrics = shared_utils.get_system_metrics()
                self.firebase_client._upload_metrics(metrics)
                logging.info(f"✓ Process status synced to Firebase: PID {pid} -> LAUNCHING")
            except Exception as e:
                # Don't crash if Firebase sync fails - it will sync on next interval
                logging.error(f"✗ Failed to sync process status to Firebase: {e}")
                logging.exception("Full traceback:")

        return pid

    # Check if process has been restarted more than n times already
    def reached_max_relaunch_attempts(self, process):
        process_name = Util.get_process_name(process)
        try:
            attempts = self.relaunch_attempts.get(process_name, 0 if self.first_start else 1)

            process_list_id = shared_utils.fetch_process_id_by_name(process_name, shared_utils.read_config())
            relaunches_to_attempt = int(shared_utils.read_config(keys=['relaunch_attempts'], process_list_id=process_list_id))
            if not relaunches_to_attempt:
                relaunches_to_attempt = MAX_RELAUNCH_ATTEMPTS

            # Check if restart prompt is running
            if not shared_utils.is_script_running('prompt_restart.py'):
                # If attempts are less than or equal to the relaunch attempts, log it
                if 0 < attempts <= relaunches_to_attempt:
                    self.log_and_notify(
                        process,
                        f'Process relaunch attempt: {attempts} of {relaunches_to_attempt}'
                    )
                # If this is more than the maximum number of attempts allowed
                if attempts > relaunches_to_attempt and relaunches_to_attempt != 0:
                    # If a restart prompt isn't already running, open one
                    started_restart_prompt = self.launch_python_script_as_user(
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
                # Kill the process
                psutil.Process(pid).terminate()
                
                # Launch new process
                new_pid = self.launch_process_as_user(process)

                self.log_and_notify(
                    process,
                    f'Terminated PID {pid} and restarted with new PID {new_pid}'
                )
                # Status message - sync to Firebase immediately
                shared_utils.update_process_status_in_json(new_pid, 'LAUNCHING', self.firebase_client)

                return new_pid

            except Exception as e:
                self.log_and_notify(
                    process,
                    f"Could not kill and restart process {pid}. Error: {e}"
                )
                return None

    # Attempt to launch the process if not running
    def handle_process_launch(self, process):
        # Validate executable path before attempting launch
        exe_path = process.get('exe_path', '').strip()
        if not exe_path:
            process_name = Util.get_process_name(process)
            logging.error(f"Cannot launch '{process_name}': Executable path is not set. Please configure a valid exe_path and disable/re-enable autolaunch.")
            return None

        if not os.path.isfile(exe_path):
            process_name = Util.get_process_name(process)
            logging.error(f"Cannot launch '{process_name}': Executable path does not exist: {exe_path}")
            return None

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

                # Attempt to start the process
                try:
                    pid = self.launch_process_as_user(process)
                except Exception as e:
                    logging.error(f"Could not start process {Util.get_process_name(process)}.\n {e}")

                # Update the last started time and PID
                self.last_started[process_list_id] = {'time': self.current_time, 'pid': pid}
                logging.info(f"PID {pid} started")

                return pid  # Return the new PID

            return None  # Return None if the process was not started

    # If process not responding, attempt to kill and relaunch
    def handle_unresponsive_process(self, pid, process):
        # Check JSON for process response status
        process_name = Util.get_process_name(process)
        try:
            responsive = self.results.get(str(pid), {}).get('responsive', True)
        except json.JSONDecodeError:
            logging.error("Failed to decode JSON from result file")
            responsive = True
        except Exception:
            logging.error("An unexpected error occurred")
            responsive = True

        # Attempt to kill and relaunch if unresponsive
        if not responsive:
            self.log_and_notify(
                process,
                f"Process {process_name} (PID {pid}) is not responding"
            )
            # Status message - sync to Firebase immediately
            shared_utils.update_process_status_in_json(pid, 'STALLED', self.firebase_client)
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
            # Check if we've already recovered this process from a previous session
            if not last_pid:
                # No recovered PID, launch normally
                new_pid = self.handle_process_launch(process)
            else:
                # Process was recovered from previous session, just use it - sync to Firebase immediately
                shared_utils.update_process_status_in_json(last_pid, 'RUNNING', self.firebase_client)
                logging.info(f"Using recovered process '{process.get('name')}' with PID {last_pid}")
                new_pid = None  # Don't update last_started since it's already set

        else:
            # Check if process is running
            if last_pid and Util.is_pid_running(last_pid):
                # Launch scout to check if process is responsive
                self.launch_python_script_as_user(
                    shared_utils.get_path('owlette_scout.py'), 
                    str(last_pid)
                )
                new_pid = self.handle_unresponsive_process(last_pid, process)

                #  Everything is fine, keep calm and carry on - sync to Firebase immediately
                if not new_pid:
                    shared_utils.update_process_status_in_json(last_pid, 'RUNNING', self.firebase_client)

            else:
                # Launch the process again if it isn't running
                new_pid = self.handle_process_launch(process)
        
        # Update last started info (for handling process startup timing)
        if new_pid:
            self.last_started[process_list_id] = {'time': self.current_time, 'pid': new_pid}

    # Clean up stale entries in tracking dictionaries
    def cleanup_stale_tracking_data(self):
        """
        Remove entries from tracking dictionaries for processes that no longer exist in config.
        Prevents memory leaks from accumulation over time.
        """
        try:
            # Get current process IDs from config
            config = shared_utils.read_config()
            if not config:
                return

            current_process_ids = {p.get('id') for p in config.get('processes', []) if p.get('id')}

            # Clean up last_started dictionary
            stale_ids = [pid for pid in self.last_started.keys() if pid not in current_process_ids]
            if stale_ids:
                for pid in stale_ids:
                    del self.last_started[pid]
                logging.info(f"✓ Cleaned up {len(stale_ids)} stale entries from last_started tracking")

            # Clean up relaunch_attempts dictionary (uses process names, need to map)
            current_process_names = {p.get('name') for p in config.get('processes', []) if p.get('name')}
            stale_names = [name for name in self.relaunch_attempts.keys() if name not in current_process_names]
            if stale_names:
                for name in stale_names:
                    del self.relaunch_attempts[name]
                logging.info(f"✓ Cleaned up {len(stale_names)} stale entries from relaunch_attempts tracking")

        except Exception as e:
            logging.error(f"Error cleaning up stale tracking data: {e}")

    # Handle config updates from Firebase
    def handle_config_update(self, new_config):
        """
        Handle configuration updates from Firebase.
        Performs intelligent diffing to terminate removed processes and respect autolaunch changes.

        Args:
            new_config: New configuration dict from Firestore
        """
        try:
            logging.info("Applying config update from Firestore")

            # Read old config before overwriting (for diffing)
            old_config = shared_utils.read_config()

            # Write the new config to local config.json
            shared_utils.write_json_to_file(new_config, shared_utils.CONFIG_PATH)

            logging.info("Local config.json updated from Firestore")

            # Perform config diffing if old config exists
            if old_config:
                old_processes = old_config.get('processes', [])
                new_processes = new_config.get('processes', [])

                # Create lookup maps
                old_process_map = {p.get('id'): p for p in old_processes if p.get('id')}
                new_process_map = {p.get('id'): p for p in new_processes if p.get('id')}

                # Find removed processes
                removed_process_ids = set(old_process_map.keys()) - set(new_process_map.keys())

                # Terminate removed processes
                for removed_id in removed_process_ids:
                    removed_proc = old_process_map[removed_id]
                    logging.info(f"Process removed from config: {removed_proc.get('name')}")

                    # Find and terminate the running process
                    if removed_id in self.last_started:
                        pid_info = self.last_started[removed_id]
                        pid = pid_info.get('pid')

                        if pid and Util.is_pid_running(pid):
                            try:
                                psutil.Process(pid).terminate()
                                # Update status and sync to Firebase immediately
                                shared_utils.update_process_status_in_json(pid, 'STOPPED', self.firebase_client)
                                logging.info(f"✓ Terminated removed process: {removed_proc.get('name')} (PID {pid})")
                            except Exception as e:
                                logging.error(f"Failed to terminate removed process PID {pid}: {e}")

                        # Clean up tracking
                        del self.last_started[removed_id]

                # Check for autolaunch changes (disable -> terminate)
                for process_id, new_proc in new_process_map.items():
                    if process_id in old_process_map:
                        old_proc = old_process_map[process_id]
                        old_autolaunch = old_proc.get('autolaunch', False)
                        new_autolaunch = new_proc.get('autolaunch', False)

                        if old_autolaunch and not new_autolaunch:
                            # Autolaunch disabled - terminate the process
                            logging.info(f"Autolaunch disabled for {new_proc.get('name')} - terminating process")

                            if process_id in self.last_started:
                                pid_info = self.last_started[process_id]
                                pid = pid_info.get('pid')

                                if pid and Util.is_pid_running(pid):
                                    try:
                                        psutil.Process(pid).terminate()
                                        # Update status and sync to Firebase immediately
                                        shared_utils.update_process_status_in_json(pid, 'STOPPED', self.firebase_client)
                                        logging.info(f"✓ Terminated process with disabled autolaunch: {new_proc.get('name')} (PID {pid})")
                                    except Exception as e:
                                        logging.error(f"Failed to terminate PID {pid}: {e}")
                        elif new_autolaunch and not old_autolaunch:
                            logging.info(f"Autolaunch enabled for {new_proc.get('name')} - will start on next cycle")

                # Log summary
                logging.info(f"Config update complete - Processes: {len(old_processes)} -> {len(new_processes)}, Removed: {len(removed_process_ids)}")

            # Push metrics immediately so web dashboard updates instantly
            # CRITICAL: Pass the new config directly to avoid race condition from re-reading disk
            if self.firebase_client:
                try:
                    metrics = shared_utils.get_system_metrics_with_config(new_config)
                    self.firebase_client._upload_metrics(metrics)
                    logging.info("Metrics pushed immediately after config update")
                except Exception as e:
                    logging.error(f"Failed to push metrics after config update: {e}")

        except Exception as e:
            logging.error(f"Error handling config update: {e}")

    # Handle commands from Firebase
    def handle_firebase_command(self, cmd_id, cmd_data):
        """
        Handle commands received from Firebase web portal.

        Args:
            cmd_id: Command ID
            cmd_data: Command data dict with 'type' and parameters

        Returns:
            Result message string
        """
        try:
            cmd_type = cmd_data.get('type')
            logging.info(f"Received Firebase command: {cmd_type} (ID: {cmd_id})")

            if cmd_type == 'restart_process':
                # Restart a specific process by name
                process_name = cmd_data.get('process_name')
                processes = shared_utils.read_config(['processes'])
                for process in processes:
                    if process.get('name') == process_name:
                        process_list_id = process['id']
                        last_info = self.last_started.get(process_list_id, {})
                        last_pid = last_info.get('pid')
                        if last_pid and Util.is_pid_running(last_pid):
                            new_pid = self.kill_and_relaunch_process(last_pid, process)
                            return f"Process {process_name} restarted with new PID {new_pid}"
                        else:
                            new_pid = self.handle_process_launch(process)
                            return f"Process {process_name} started with PID {new_pid}"
                return f"Process {process_name} not found in configuration"

            elif cmd_type == 'kill_process':
                # Kill a specific process by name
                process_name = cmd_data.get('process_name')
                processes = shared_utils.read_config(['processes'])
                for process in processes:
                    if process.get('name') == process_name:
                        process_list_id = process['id']
                        last_info = self.last_started.get(process_list_id, {})
                        last_pid = last_info.get('pid')
                        if last_pid and Util.is_pid_running(last_pid):
                            psutil.Process(last_pid).terminate()
                            # Update status and sync to Firebase immediately
                            shared_utils.update_process_status_in_json(last_pid, 'STOPPED', self.firebase_client)
                            return f"Process {process_name} (PID {last_pid}) terminated"
                        else:
                            return f"Process {process_name} is not running"
                return f"Process {process_name} not found in configuration"

            elif cmd_type == 'toggle_autolaunch':
                # Toggle autolaunch for a specific process
                process_name = cmd_data.get('process_name')
                new_autolaunch_value = cmd_data.get('autolaunch', False)
                config = shared_utils.read_config()
                processes = config.get('processes', [])
                for process in processes:
                    if process.get('name') == process_name:
                        process['autolaunch'] = new_autolaunch_value
                        shared_utils.save_config(config)
                        logging.info(f"Autolaunch for {process_name} set to {new_autolaunch_value}")
                        return f"Autolaunch for {process_name} set to {new_autolaunch_value}"
                return f"Process {process_name} not found in configuration"

            elif cmd_type == 'update_config':
                # Update configuration from Firebase
                new_config = cmd_data.get('config')
                if new_config:
                    shared_utils.write_json_to_file(new_config, shared_utils.CONFIG_PATH)
                    logging.info("Configuration updated from Firebase")
                    return "Configuration updated successfully"
                else:
                    return "No configuration data provided"

            elif cmd_type == 'install_software':
                # Install software from a URL with silent flags
                installer_url = cmd_data.get('installer_url')
                installer_name = cmd_data.get('installer_name', 'installer.exe')
                silent_flags = cmd_data.get('silent_flags', '')
                verify_path = cmd_data.get('verify_path')  # Optional verification path
                timeout_seconds = cmd_data.get('timeout_seconds', 600)  # Default: 10 minutes
                expected_sha256 = cmd_data.get('sha256_checksum')  # Optional but recommended
                deployment_id = cmd_data.get('deployment_id')  # For tracking deployment progress

                if not installer_url:
                    return "Error: No installer URL provided"

                logging.info(f"Starting software installation: {installer_name}")
                logging.info(f"URL: {installer_url}")
                logging.info(f"Flags: {silent_flags}")
                logging.info(f"Timeout: {timeout_seconds} seconds")
                if expected_sha256:
                    logging.info(f"Checksum verification enabled: {expected_sha256[:16]}...")

                # Get temporary path for installer
                temp_installer_path = installer_utils.get_temp_installer_path(installer_name)

                try:
                    # Update status: downloading
                    if self.firebase_client:
                        self.firebase_client.update_command_progress(cmd_id, 'downloading', deployment_id)

                    # Download the installer
                    logging.info(f"Downloading installer to: {temp_installer_path}")
                    download_success = installer_utils.download_file(installer_url, temp_installer_path)

                    if not download_success:
                        return f"Error: Failed to download installer from {installer_url}"

                    # Verify checksum if provided (SECURITY: recommended for remote installations)
                    if expected_sha256:
                        logging.info("Verifying installer checksum...")
                        checksum_valid = installer_utils.verify_checksum(temp_installer_path, expected_sha256)
                        if not checksum_valid:
                            installer_utils.cleanup_installer(temp_installer_path)
                            return f"Error: Checksum verification failed for {installer_name}. Installation aborted for security."
                        logging.info("✓ Checksum verification passed")
                    else:
                        logging.warning("⚠ No checksum provided - skipping verification (security risk)")

                    # Update status: installing
                    if self.firebase_client:
                        self.firebase_client.update_command_progress(cmd_id, 'installing', deployment_id)

                    # Execute the installer (pass active_installations for cancellation support)
                    logging.info("Executing installer with silent flags")
                    success, exit_code, error_msg = installer_utils.execute_installer(
                        temp_installer_path,
                        silent_flags,
                        installer_name,
                        self.active_installations,
                        timeout_seconds
                    )

                    if not success:
                        return f"Error: Installation failed with exit code {exit_code}. {error_msg}"

                    # Optional: Verify installation
                    if verify_path:
                        if installer_utils.verify_installation(verify_path):
                            result_msg = f"Installation completed successfully. Verified at {verify_path}"
                        else:
                            result_msg = f"Installation completed (exit code 0) but verification failed - {verify_path} not found"
                    else:
                        result_msg = f"Installation completed successfully (exit code {exit_code})"

                    logging.info(result_msg)
                    return result_msg

                finally:
                    # Always cleanup the temporary installer file
                    installer_utils.cleanup_installer(temp_installer_path)

            elif cmd_type == 'cancel_installation':
                # Cancel an active installation
                installer_name = cmd_data.get('installer_name')

                if not installer_name:
                    return "Error: No installer name provided for cancellation"

                logging.info(f"Cancellation requested for: {installer_name}")

                # Attempt to cancel the installation
                success, message = installer_utils.cancel_installation(
                    installer_name,
                    self.active_installations
                )

                if success:
                    logging.info(f"Installation cancelled: {installer_name}")
                    return f"Installation cancelled: {installer_name}"
                else:
                    logging.warning(f"Cancellation failed: {message}")
                    return f"Cancellation failed: {message}"

            elif cmd_type == 'uninstall_software':
                # Uninstall software using registry-detected uninstall command
                software_name = cmd_data.get('software_name')
                uninstall_command = cmd_data.get('uninstall_command')
                silent_flags = cmd_data.get('silent_flags', '')
                installer_type = cmd_data.get('installer_type', 'custom')
                verify_paths = cmd_data.get('verify_paths', [])  # Paths to verify removal
                timeout_seconds = cmd_data.get('timeout_seconds', 600)  # Default: 10 minutes
                deployment_id = cmd_data.get('deployment_id')  # For tracking deployment progress

                if not software_name or not uninstall_command:
                    return "Error: Software name and uninstall command required"

                logging.info(f"Starting software uninstallation: {software_name}")
                logging.info(f"Uninstall command: {uninstall_command}")
                logging.info(f"Installer type: {installer_type}")
                logging.info(f"Timeout: {timeout_seconds} seconds")

                # Build complete silent uninstall command
                if not silent_flags:
                    # Auto-detect silent flags if not provided
                    silent_flags = registry_utils.get_silent_uninstall_flags(installer_type)
                    logging.info(f"Auto-detected silent flags: {silent_flags}")

                complete_command = registry_utils.build_silent_uninstall_command(
                    uninstall_command,
                    installer_type
                ) if not silent_flags else f"{uninstall_command} {silent_flags}"

                logging.info(f"Complete uninstall command: {complete_command}")

                try:
                    # Update status: uninstalling
                    if self.firebase_client:
                        self.firebase_client.update_command_progress(cmd_id, 'uninstalling', deployment_id)

                    # Execute the uninstaller (track for cancellation)
                    logging.info("Executing uninstaller with silent flags")

                    # Use installer_utils.execute_installer since it handles process tracking
                    # For uninstall, we don't have a file path, so we'll use subprocess directly
                    import subprocess

                    # Track process name for cancellation
                    uninstall_process_name = f"uninstall_{software_name.replace(' ', '_')}"

                    process = subprocess.Popen(
                        complete_command,
                        shell=True,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True
                    )

                    # Track process for potential cancellation
                    self.active_installations[uninstall_process_name] = process
                    logging.info(f"Tracking uninstall process: {uninstall_process_name} (PID: {process.pid})")

                    # Wait for uninstallation to complete
                    try:
                        stdout, stderr = process.communicate(timeout=timeout_seconds)
                        exit_code = process.returncode
                    except subprocess.TimeoutExpired:
                        process.kill()
                        if uninstall_process_name in self.active_installations:
                            del self.active_installations[uninstall_process_name]
                        return f"Error: Uninstallation timeout (exceeded {timeout_seconds} seconds)"

                    # Remove from active processes once complete
                    if uninstall_process_name in self.active_installations:
                        del self.active_installations[uninstall_process_name]

                    logging.info(f"Uninstaller exit code: {exit_code}")

                    # Check if uninstallation was successful
                    # Note: Some uninstallers return non-zero even on success
                    if exit_code not in [0, 3010]:  # 0 = success, 3010 = success but reboot required
                        logging.warning(f"Uninstaller returned exit code {exit_code}")
                        if stderr:
                            logging.error(f"Uninstaller stderr: {stderr}")

                    # Verify uninstallation
                    verification_results = []
                    if verify_paths:
                        for verify_path in verify_paths:
                            if verify_path:
                                # Check if path still exists (should NOT exist after uninstall)
                                import os
                                path_exists = os.path.exists(verify_path)
                                verification_results.append({
                                    'path': verify_path,
                                    'removed': not path_exists
                                })
                                if path_exists:
                                    logging.warning(f"Verification: Path still exists after uninstall: {verify_path}")
                                else:
                                    logging.info(f"Verification: Path successfully removed: {verify_path}")

                    # Check if software still appears in registry
                    registry_check = registry_utils.search_software_by_name(software_name)
                    still_in_registry = len(registry_check) > 0

                    if still_in_registry:
                        logging.warning(f"Software still appears in registry after uninstall: {software_name}")
                        result_msg = f"Uninstall completed with exit code {exit_code}, but software still appears in registry (may require reboot)"
                    elif any(not vr['removed'] for vr in verification_results):
                        result_msg = f"Uninstall completed with exit code {exit_code}, but some files remain (may require reboot)"
                    else:
                        result_msg = f"Uninstall completed successfully (exit code {exit_code})"

                    logging.info(result_msg)
                    return result_msg

                except Exception as e:
                    error_msg = f"Unexpected error during uninstallation: {e}"
                    logging.error(error_msg)
                    logging.exception("Uninstall error details:")
                    return f"Error: {error_msg}"

            elif cmd_type == 'cancel_uninstall':
                # Cancel an active uninstallation
                software_name = cmd_data.get('software_name')

                if not software_name:
                    return "Error: No software name provided for cancellation"

                # Build process tracking name
                uninstall_process_name = f"uninstall_{software_name.replace(' ', '_')}"
                logging.info(f"Cancellation requested for: {uninstall_process_name}")

                # Attempt to cancel the uninstallation
                success, message = installer_utils.cancel_installation(
                    uninstall_process_name,
                    self.active_installations
                )

                if success:
                    logging.info(f"Uninstallation cancelled: {software_name}")
                    return f"Uninstallation cancelled: {software_name}"
                else:
                    logging.warning(f"Cancellation failed: {message}")
                    return f"Cancellation failed: {message}"

            elif cmd_type == 'distribute_project':
                # Distribute project files (ZIP) with extraction
                project_url = cmd_data.get('project_url')
                project_name = cmd_data.get('project_name', 'project.zip')
                extract_path = cmd_data.get('extract_path')  # Optional custom path
                verify_files = cmd_data.get('verify_files', [])  # List of files to verify
                distribution_id = cmd_data.get('distribution_id')  # For tracking distribution progress

                if not project_url:
                    return "Error: No project URL provided"

                logging.info(f"Starting project distribution: {project_name}")
                logging.info(f"URL: {project_url}")
                logging.info(f"Extract path: {extract_path or 'default'}")

                # Determine extraction path
                if not extract_path:
                    extract_path = project_utils.get_default_project_directory()
                    logging.info(f"Using default extraction path: {extract_path}")

                # Get temporary path for project ZIP
                temp_project_path = project_utils.get_temp_project_path(project_name)

                try:
                    # Update status: downloading
                    if self.firebase_client:
                        self.firebase_client.update_command_progress(cmd_id, 'downloading', distribution_id)

                    # Download the project ZIP
                    logging.info(f"Downloading project to: {temp_project_path}")
                    download_success, result = project_utils.download_project(
                        project_url,
                        project_name,
                        lambda progress: self.firebase_client.update_command_progress(
                            cmd_id, 'downloading', distribution_id, progress
                        ) if self.firebase_client else None
                    )

                    if not download_success:
                        return f"Error: {result}"

                    # Update status: extracting
                    if self.firebase_client:
                        self.firebase_client.update_command_progress(cmd_id, 'extracting', distribution_id)

                    # Extract the ZIP file
                    logging.info(f"Extracting project to: {extract_path}")
                    extract_success, error_msg = project_utils.extract_zip(
                        result,  # result contains the downloaded file path
                        extract_path,
                        lambda progress: self.firebase_client.update_command_progress(
                            cmd_id, 'extracting', distribution_id, progress
                        ) if self.firebase_client else None
                    )

                    if not extract_success:
                        return f"Error: Extraction failed - {error_msg}"

                    # Optional: Verify project files
                    result_msg = f"Project extracted successfully to {extract_path}"
                    if verify_files:
                        all_found, missing_files = project_utils.verify_project_files(extract_path, verify_files)
                        if all_found:
                            result_msg += f". Verified {len(verify_files)} file(s)"
                        else:
                            result_msg += f". Warning: {len(missing_files)} file(s) missing: {', '.join(missing_files)}"

                    logging.info(result_msg)
                    return result_msg

                finally:
                    # Always cleanup the temporary project ZIP
                    project_utils.cleanup_project_zip(temp_project_path)

            elif cmd_type == 'cancel_distribution':
                # Cancel an active project distribution
                project_name = cmd_data.get('project_name')

                if not project_name:
                    return "Error: No project name provided for cancellation"

                logging.info(f"Cancellation requested for project: {project_name}")

                # Note: We don't have a simple way to cancel downloads like we do for installers
                # since download_file is synchronous. For now, just cleanup the temp file.
                project_path = project_utils.get_temp_project_path(project_name)
                project_utils.cleanup_project_zip(project_path)

                return f"Distribution cancelled: {project_name} (cleaned up temporary files)"

            else:
                logging.warning(f"Unknown command type: {cmd_type}")
                return f"Unknown command type: {cmd_type}"

        except Exception as e:
            error_msg = f"Error executing command {cmd_type}: {e}"
            logging.error(error_msg)
            return error_msg

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

        # Start Firebase client and upload local config
        if self.firebase_client:
            try:
                # Register command callback
                self.firebase_client.register_command_callback(self.handle_firebase_command)

                # Register config update callback
                self.firebase_client.register_config_update_callback(self.handle_config_update)

                # Start Firebase background threads
                self.firebase_client.start()
                logging.info("Firebase client started successfully")

                # Register atexit handler to ensure machine is marked offline even if killed abruptly
                def emergency_offline_handler():
                    """Emergency handler to mark machine offline if service is killed without proper shutdown"""
                    try:
                        if self.firebase_client and self.firebase_client.connected:
                            logging.warning("EMERGENCY CLEANUP: Marking machine offline")
                            self.firebase_client._update_presence(False)
                            logging.info("Emergency offline update sent")
                    except:
                        pass  # Fail silently - we're shutting down anyway

                atexit.register(emergency_offline_handler)
                logging.info("Emergency offline handler registered")

                # Upload local config to Firebase on first run
                local_config = shared_utils.read_config()
                if local_config:
                    self.firebase_client.upload_config(local_config)
                    logging.info("Local config uploaded to Firebase")

                # Add Firebase log shipping if enabled
                shared_utils.add_firebase_log_handler(self.firebase_client)

            except Exception as e:
                logging.error(f"Error starting Firebase client: {e}")

        # Recover processes from previous session (if any are still running)
        logging.info("Checking for processes from previous session...")
        self.recover_running_processes()

        # The heart of Owlette
        cleanup_counter = 0  # Counter for periodic cleanup
        log_cleanup_counter = 0  # Counter for log cleanup (runs less frequently)
        while self.is_alive:
            # Start the tray icon script as a process (if it isn't running)
            tray_script = 'owlette_tray.py'
            if not shared_utils.is_script_running(tray_script):
                self.launch_python_script_as_user(tray_script)

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

            # Periodic cleanup of stale tracking data (every 30 iterations = 5 minutes)
            cleanup_counter += 1
            if cleanup_counter >= 30:
                self.cleanup_stale_tracking_data()
                cleanup_counter = 0

            # Periodic cleanup of old log files (every 8640 iterations = 24 hours)
            log_cleanup_counter += 1
            if log_cleanup_counter >= 8640:
                try:
                    max_age_days = shared_utils.read_config(['logging', 'max_age_days']) or 90
                    deleted_count = shared_utils.cleanup_old_logs(max_age_days)
                    if deleted_count > 0:
                        logging.info(f"Daily log cleanup: {deleted_count} old log file(s) removed")
                except Exception as e:
                    logging.error(f"Log cleanup failed: {e}")
                log_cleanup_counter = 0

            # Sleep for 10 seconds
            time.sleep(SLEEP_INTERVAL)

if __name__ == '__main__':
    # Check if running under NSSM (no command-line arguments)
    # or being run directly for debugging/testing
    import sys

    if len(sys.argv) == 1:
        # No arguments - running under NSSM or direct execution
        # Run the service main loop directly
        print("Starting Owlette service (NSSM mode)...")
        service = OwletteService(None)
        service.SvcDoRun()
    else:
        # Has arguments - use normal win32serviceutil command-line handling
        win32serviceutil.HandleCommandLine(OwletteService)
