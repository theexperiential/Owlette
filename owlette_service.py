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

# Initialize logging
log_file_path = shared_utils.get_path('_service.log')

# Clear the log file after system restart
with open(log_file_path, 'w'):
    pass

logging.basicConfig(filename=log_file_path, level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logging.info("Starting Owlette Service")

def is_process_running(process_name):
    for process in psutil.process_iter(['name']):
        if process.info['name'] == process_name:
            return True
    return False

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

def is_script_running(script_name):
    for process in psutil.process_iter(attrs=['pid', 'name', 'cmdline']):
        if 'python' in process.info['name']:
            #logging.info(process.info['cmdline'])
            if script_name in ' '.join(process.info['cmdline']):
                return True
    return False

def start_python_script_as_user(script_name, args, console_user_token, environment, startupInfo):
    startupInfo.wShowWindow = win32con.SW_HIDE
    command_line = f"python {shared_utils.get_path(script_name)} {args}"
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

def start_process_as_user(console_user_token, environment, startupInfo, process):
    # show window!
    startupInfo.wShowWindow = win32con.SW_SHOW

    exe_path = process['exe_path']
    file_path = process.get('file_path', '')
    logging.info(f"Starting {exe_path} {file_path}...")

    # Build the command line
    command_line = f"{exe_path} {file_path}" if file_path else exe_path
    
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

    return process_info[2] # return PID

def is_pid_running(pid):
    try:
        process = psutil.Process(pid)
        return True
    except psutil.NoSuchProcess:
        return False

class OwletteService(win32serviceutil.ServiceFramework):
    _svc_name_ = 'OwletteService'
    _svc_display_name_ = 'Owlette Service'

    def __init__(self, args):
        win32serviceutil.ServiceFramework.__init__(self, args)
        self.hWaitStop = win32event.CreateEvent(None, 0, 0, None)
        self.is_alive = True

    def SvcStop(self):
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        self.is_alive = False
        win32event.SetEvent(self.hWaitStop)

    def SvcDoRun(self):
        servicemanager.LogMsg(servicemanager.EVENTLOG_INFORMATION_TYPE,
              servicemanager.PYS_SERVICE_STARTED,
              (self._svc_name_, ''))
        self.main()

    def main(self):
        # Is this the first start?
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

        while self.is_alive:
            # Start the tray icon script as a subprocess
            if not is_script_running('owlette_tray.py'):
                try:
                    logging.info("Starting Owlette Tray...")
                    startupInfo.wShowWindow = win32con.SW_HIDE
                    command_line = f"python {shared_utils.get_path('owlette_tray.py')}"
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
                except Exception as e:
                    logging.error(f"Couldn't start Owlette Tray. {e}")

            # Start each application from JSON config
            # Read the JSON configuration
            with open(shared_utils.get_path('config.json'), 'r') as f:
                config = json.load(f)

            # Get the current time
            current_time = datetime.datetime.now()

            for process in config['processes']:
                process_name = process['name']
                delay = float(process.get('time_delay', 0))

                last_info = last_started.get(process_name, {})
                last_time = last_info.get('time')
                last_pid = last_info.get('pid')

                if last_pid and is_pid_running(last_pid):
                    continue  # Skip this iteration if the process is running
                
                if last_time is None or (current_time - last_time).seconds >= 60:  # 60 seconds
                    # Delay the app (if applicable)
                    time.sleep(delay)
                    # Attempt to start the process
                    try:
                        pid = start_process_as_user(console_user_token, environment, startupInfo, process)
                    except Exception as e:
                        logging.error(f"Could not start process {process_name}.\n {e}")
                    # Update the last started time and PID
                    last_started[process_name] = {'time': current_time, 'pid': pid}
                    logging.info(f"PID {pid} started.")

                    if not first_start:
                        # Send email notification
                        try:
                            start_python_script_as_user(
                                shared_utils.get_path('owlette_email.py'),
                                f'--process_name {process_name}',
                                console_user_token, environment,
                                startupInfo
                            )
                        except Exception as e:
                            logging.error(e)

            # Now that all apps have started for the session, start monitoring
            # And send an email if they get restarted
            first_start = False

            # Sleep for 10 seconds
            time.sleep(10)


if __name__ == '__main__':
    win32serviceutil.HandleCommandLine(OwletteService)
