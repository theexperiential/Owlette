import shared_utils
import tkinter as tk
from tkinter import filedialog
import customtkinter as ctk
from CTkListbox import *
from CTkMessagebox import CTkMessagebox
import os
import signal
import json
import logging
import uuid
import threading
import subprocess
import time

# Lazy import for win32serviceutil (heavy dependency - only import when needed)
# import win32serviceutil  # Moved to methods that use it

# Firebase integration - lazy loaded in background thread
# from firebase_client import FirebaseClient  # Moved to background thread
FIREBASE_AVAILABLE = True  # Assume available, handle import errors in background thread

class OwletteConfigApp:

    def __init__(self, master):
        self.master = master
        self.entry = ctk.CTkEntry(master)
        self.entry.grid(row=0, column=0)

        # Initialize basic window properties FIRST for fast appearance
        self.master.title(shared_utils.WINDOW_TITLES.get("owlette_gui"))
        # Set window icon
        try:
            icon_path = shared_utils.get_path('../../icons/owlette.ico')
            self.master.iconbitmap(icon_path)
        except Exception as e:
            logging.warning(f"Could not load icon: {e}")
        shared_utils.center_window(master, 1280, 460)

        # Initialize state variables
        self.prev_process_list = None
        self.prev_config_hash = None
        self.selected_process = None
        self.selected_index = None
        self.firebase_client = None
        self.config = None
        self.service_running = None

        # Show loading screen immediately
        self.show_loading_screen()

        # Start async initialization
        self.master.after(50, self._complete_initialization)

    def show_loading_screen(self):
        """Display minimal loading screen while heavy operations complete"""
        # Set dark mode
        ctk.set_appearance_mode("dark")

        # Create loading frame
        self.loading_frame = ctk.CTkFrame(master=self.master, fg_color=shared_utils.WINDOW_COLOR)
        self.loading_frame.place(relx=0, rely=0, relwidth=1, relheight=1)

        # Owlette title
        self.loading_title = ctk.CTkLabel(
            self.loading_frame,
            text="OWLETTE",
            text_color=shared_utils.TEXT_COLOR,
            font=("", 32, "bold")
        )
        self.loading_title.place(relx=0.5, rely=0.35, anchor="center")

        # Loading message
        self.loading_message = ctk.CTkLabel(
            self.loading_frame,
            text="Loading configuration...",
            text_color=shared_utils.TEXT_COLOR,
            font=("", 14)
        )
        self.loading_message.place(relx=0.5, rely=0.5, anchor="center")

        # Version label
        self.loading_version = ctk.CTkLabel(
            self.loading_frame,
            text=f"v{shared_utils.APP_VERSION}",
            text_color=shared_utils.TEXT_COLOR,
            font=("", 10)
        )
        self.loading_version.place(relx=0.5, rely=0.9, anchor="center")

    def _complete_initialization(self):
        """Complete initialization in phases to keep UI responsive"""
        # Phase 1: Load config (fast, keep on main thread)
        self.loading_message.configure(text="Loading configuration...")
        self.master.update()
        self.config = shared_utils.load_config()

        # Phase 2: Build full UI (before async operations so widgets exist)
        self.loading_message.configure(text="Building interface...")
        self.master.update()
        self.loading_frame.destroy()  # Remove loading screen
        self.setup_ui()

        # Phase 3: Start background threads for heavy operations
        self._start_background_initialization()

        # Phase 4: Initialize UI with config data
        self.update_process_list()

        # Set default values if empty
        if not self.time_delay_entry.get():
            self.time_delay_entry.insert(0, 0)
        if not self.time_to_init_entry.get():
            self.time_to_init_entry.insert(0, 10)
        if not self.relaunch_attempts_entry.get():
            self.relaunch_attempts_entry.insert(0, 3)

        # Auto-select first process if any exist
        if self.process_list.size() > 0:
            self.process_list.activate(0)

        # Start periodic updates
        self.master.after(1000, self.update_process_list_periodically)

    def _start_background_initialization(self):
        """Start heavy operations in background threads"""
        # Thread 1: Check service status
        def check_service_async():
            try:
                service_name = shared_utils.SERVICE_NAME
                is_running = self.check_service_is_running(service_name)
                self.service_running = is_running

                # If not running, start it
                if not is_running:
                    self.loading_message.configure(text="Starting service...")
                    self.start_service()
                    self.service_running = True

                logging.info(f"Service status: {'Running' if is_running else 'Started'}")
            except Exception as e:
                logging.error(f"Error checking service: {e}")
                self.service_running = False

        # Thread 2: Initialize Firebase client
        def init_firebase_async():
            try:
                # Lazy import Firebase in background thread
                from firebase_client import FirebaseClient

                if self.config.get('firebase', {}).get('enabled', False):
                    site_id = self.config.get('firebase', {}).get('site_id', 'default_site')
                    credentials_path = shared_utils.get_path('../config/firebase-credentials.json')
                    cache_path = shared_utils.get_path('../config/firebase_cache.json')

                    self.firebase_client = FirebaseClient(
                        credentials_path=credentials_path,
                        site_id=site_id,
                        config_cache_path=cache_path
                    )
                    logging.info("GUI Firebase client initialized")

                    # Update UI on main thread
                    self.master.after(0, self.update_firebase_status)
            except ImportError as e:
                logging.warning(f"Firebase not available: {e}")
                self.master.after(0, self.update_firebase_status)
            except Exception as e:
                logging.warning(f"Failed to initialize GUI Firebase client: {e}")
                self.master.after(0, self.update_firebase_status)

        # Start both threads
        threading.Thread(target=check_service_async, daemon=True, name="ServiceCheck").start()
        threading.Thread(target=init_firebase_async, daemon=True, name="FirebaseInit").start()

    def _apply_windows11_theme(self):
        """Apply Windows 11 dark titlebar - deferred for faster startup"""
        try:
            # This works on Windows 11 to set dark titlebar
            self.master.wm_attributes("-alpha", 0.99)  # Slight transparency hack to force dark titlebar
            self.master.wm_attributes("-alpha", 1.0)   # Then set back to full opacity
            # Alternative method for Windows 11
            import ctypes
            HWND = ctypes.windll.user32.GetParent(self.master.winfo_id())
            DWMWA_USE_IMMERSIVE_DARK_MODE = 20
            ctypes.windll.dwmapi.DwmSetWindowAttribute(HWND, DWMWA_USE_IMMERSIVE_DARK_MODE, ctypes.byref(ctypes.c_int(1)), ctypes.sizeof(ctypes.c_int(1)))
            logging.info("Applied Windows 11 dark theme")
        except Exception as e:
            logging.debug(f"Could not apply Windows 11 theme: {e}")
            pass  # Silently fail if not on Windows 11 or if it doesn't work

    def setup_ui(self):
        # Set appearance mode and color theme
        ctk.set_appearance_mode("dark")

        # Defer Windows 11 titlebar customization to after window is shown
        self.master.after(100, self._apply_windows11_theme)

        self.background_frame = ctk.CTkFrame(master=self.master, fg_color=shared_utils.WINDOW_COLOR)
        self.background_frame.place(relx=0, rely=0, relwidth=1, relheight=1)

        # PROCESS LIST (LEFT SIDE)
        # Create a frame for the process list
        self.process_list_frame = ctk.CTkFrame(master=self.master, fg_color=shared_utils.FRAME_COLOR, bg_color=shared_utils.WINDOW_COLOR, border_width=0, corner_radius=12)
        self.process_list_frame.grid(row=0, column=0, sticky='news', rowspan=10, columnspan=3, padx=(10, 5), pady=(10,0))

        # Create a label for the process list
        self.process_list_label = ctk.CTkLabel(self.master, text="MANAGED PROCESSES", fg_color=shared_utils.FRAME_COLOR, bg_color=shared_utils.FRAME_COLOR, text_color=shared_utils.TEXT_COLOR)
        self.process_list_label.grid(row=0, column=0, sticky='w', padx=(20, 10), pady=(20, 0))
        self.process_list_label.configure(width=40)

        # Create a Listbox to display the list of processes
        self.process_list = CTkListbox(self.master, command=self.on_select)
        self.process_list.grid(row=1, column=0, columnspan=3, rowspan=7, sticky='nsew', padx=(20,15), pady=10)
        self.process_list.configure(highlight_color=shared_utils.BUTTON_IMPORTANT_COLOR, hover_color=shared_utils.BUTTON_HOVER_COLOR, fg_color=shared_utils.FRAME_COLOR, border_color="#334155", border_width=1)
        # Adjust scrollbar padding to shift it left
        self.process_list._scrollbar.grid_configure(padx=(0, 8))

        # Button row 1: New/Delete/Kill
        self.new_button = ctk.CTkButton(self.master, text="New", command=self.new_process, width=60, fg_color=shared_utils.BUTTON_IMPORTANT_COLOR, hover_color=shared_utils.BUTTON_HOVER_COLOR, bg_color=shared_utils.FRAME_COLOR, corner_radius=6)
        self.new_button.grid(row=8, column=0, sticky='w', padx=(20, 0), pady=(5, 5))

        self.remove_button = ctk.CTkButton(self.master, text="Delete", command=self.remove_process, width=80, fg_color=shared_utils.BUTTON_COLOR, hover_color=shared_utils.BUTTON_HOVER_COLOR, bg_color=shared_utils.FRAME_COLOR, corner_radius=6)
        self.remove_button.grid(row=8, column=1, sticky='w', padx=5, pady=(5, 5))

        self.kill_button = ctk.CTkButton(self.master, text="Kill", command=self.kill_process, width=60, fg_color=shared_utils.BUTTON_COLOR, hover_color=shared_utils.BUTTON_HOVER_COLOR, bg_color=shared_utils.FRAME_COLOR, corner_radius=6)
        self.kill_button.grid(row=8, column=2, sticky='w', padx=(5, 15), pady=(5, 5))

        # Button row 2: Up/Down arrows
        self.up_button = ctk.CTkButton(self.master, text="↑", command=self.move_up, width=60, fg_color=shared_utils.BUTTON_COLOR, hover_color=shared_utils.BUTTON_HOVER_COLOR, bg_color=shared_utils.FRAME_COLOR, corner_radius=6)
        self.up_button.grid(row=9, column=1, sticky='w', padx=5, pady=(5, 15))

        self.down_button = ctk.CTkButton(self.master, text="↓", command=self.move_down, width=60, fg_color=shared_utils.BUTTON_COLOR, hover_color=shared_utils.BUTTON_HOVER_COLOR, bg_color=shared_utils.FRAME_COLOR, corner_radius=6)
        self.down_button.grid(row=9, column=2, sticky='w', padx=5, pady=(5, 15))

        # Firebase status indicator (left side of row 10)
        self.firebase_status_label = ctk.CTkLabel(self.master, text="", fg_color=shared_utils.WINDOW_COLOR, bg_color=shared_utils.WINDOW_COLOR, text_color=shared_utils.TEXT_COLOR, font=("", 11))
        self.firebase_status_label.grid(row=10, column=0, columnspan=2, sticky='sw', padx=(20, 0), pady=(5, 10))

        # Version label (right side of row 10)
        self.version_label = ctk.CTkLabel(self.master, text=f"v{shared_utils.APP_VERSION}", fg_color=shared_utils.WINDOW_COLOR, bg_color=shared_utils.WINDOW_COLOR, text_color=shared_utils.TEXT_COLOR, font=("", 10))
        self.version_label.grid(row=10, column=2, sticky='se', padx=(0, 15), pady=(5, 10))

        # PROCESS DETAILS (RIGHT SIDE)
        # Create frame for process details
        self.process_details_frame = ctk.CTkFrame(master=self.master, fg_color=shared_utils.FRAME_COLOR, bg_color=shared_utils.WINDOW_COLOR, border_width=0, corner_radius=12)
        self.process_details_frame.grid(row=0, column=4, sticky='news', rowspan=11, columnspan=5, padx=(5, 10), pady=(10,0))

        # Create a label for the process details
        self.process_details_label = ctk.CTkLabel(self.master, text="PROCESS DETAILS", fg_color=shared_utils.FRAME_COLOR, bg_color=shared_utils.FRAME_COLOR, text_color=shared_utils.TEXT_COLOR)
        self.process_details_label.grid(row=0, column=4, columnspan=4, sticky='w', padx=(20, 10), pady=(20, 0))

        # Create a toggle switch for process
        self.autolaunch_label = ctk.CTkLabel(self.master, text="Autolaunch:", fg_color=shared_utils.FRAME_COLOR, bg_color=shared_utils.FRAME_COLOR, text_color=shared_utils.TEXT_COLOR)
        self.autolaunch_label.grid(row=1, column=4, sticky='e', padx=5, pady=5)
        self.autolaunch_toggle = ctk.CTkSwitch(master=self.master, text="", command=self.toggle_launch_process, onvalue="on", offvalue="off")
        self.autolaunch_toggle.grid(row=1, column=5, sticky='w', padx=10, pady=5)
        self.autolaunch_toggle.configure(bg_color=shared_utils.FRAME_COLOR, fg_color='#475569', progress_color=shared_utils.BUTTON_IMPORTANT_COLOR)
        self.autolaunch_toggle.select()

        # Create Name of process field
        self.name_label = ctk.CTkLabel(self.master, text="Name:", fg_color=shared_utils.FRAME_COLOR, bg_color=shared_utils.FRAME_COLOR, text_color=shared_utils.TEXT_COLOR)
        self.name_label.grid(row=2, column=4, sticky='e', padx=5, pady=5)
        self.name_entry = ctk.CTkEntry(self.master, placeholder_text="Name of your process", fg_color=shared_utils.FRAME_COLOR, border_color="#334155", border_width=1, corner_radius=6)
        self.name_entry.grid(row=2, column=5, columnspan=3, sticky='ew', padx=(10, 20), pady=5)

        # Create Exe path field
        self.exe_path_label = ctk.CTkLabel(self.master, text="Executable Path:", fg_color=shared_utils.FRAME_COLOR, bg_color=shared_utils.FRAME_COLOR, text_color=shared_utils.TEXT_COLOR)
        self.exe_path_label.grid(row=3, column=4, sticky='e', padx=5, pady=5)
        self.exe_browse_button = ctk.CTkButton(self.master, text="Browse", command=self.browse_exe, width=80, fg_color=shared_utils.BUTTON_COLOR, hover_color=shared_utils.BUTTON_HOVER_COLOR, bg_color=shared_utils.FRAME_COLOR, corner_radius=6)
        self.exe_browse_button.grid(row=3, column=5, sticky='w', padx=(10, 5), pady=5)
        self.exe_path_entry = ctk.CTkEntry(self.master, placeholder_text="The full path to your executable (application)", fg_color=shared_utils.FRAME_COLOR, border_color="#334155", border_width=1, corner_radius=6)
        self.exe_path_entry.grid(row=3, column=6, columnspan=2, sticky='ew', padx=(5, 20), pady=5)

        # Create File path / cmd line args
        self.file_path_label = ctk.CTkLabel(self.master, text="File Path / Cmd Args:", fg_color=shared_utils.FRAME_COLOR, bg_color=shared_utils.FRAME_COLOR, text_color=shared_utils.TEXT_COLOR)
        self.file_path_label.grid(row=4, column=4, sticky='e', padx=5, pady=5)
        self.file_browse_button = ctk.CTkButton(self.master, text="Browse", command=self.browse_file, width=80, fg_color=shared_utils.BUTTON_COLOR, hover_color=shared_utils.BUTTON_HOVER_COLOR, bg_color=shared_utils.FRAME_COLOR, corner_radius=6)
        self.file_browse_button.grid(row=4, column=5, sticky='w', padx=(10, 5), pady=5)
        self.file_path_entry = ctk.CTkEntry(self.master, placeholder_text="The full path to your document or command line arguments", fg_color=shared_utils.FRAME_COLOR, border_color="#334155", border_width=1, corner_radius=6)
        self.file_path_entry.grid(row=4, column=6, columnspan=2, sticky='ew', padx=(5, 20), pady=5)

        # Create CWD path field
        self.cwd_label = ctk.CTkLabel(self.master, text="Working Directory:", fg_color=shared_utils.FRAME_COLOR, bg_color=shared_utils.FRAME_COLOR, text_color=shared_utils.TEXT_COLOR)
        self.cwd_label.grid(row=5, column=4, sticky='e', padx=5, pady=5)
        self.cwd_browse_button = ctk.CTkButton(self.master, text="Browse", command=self.browse_cwd, width=80, fg_color=shared_utils.BUTTON_COLOR, hover_color=shared_utils.BUTTON_HOVER_COLOR, bg_color=shared_utils.FRAME_COLOR, corner_radius=6)
        self.cwd_browse_button.grid(row=5, column=5, sticky='w', padx=(10, 5), pady=5)
        self.cwd_entry = ctk.CTkEntry(self.master, placeholder_text="The working directory for your process", fg_color=shared_utils.FRAME_COLOR, border_color="#334155", border_width=1, corner_radius=6)
        self.cwd_entry.grid(row=5, column=6, columnspan=2, sticky='ew', padx=(5, 20), pady=5)

        # Create Time delay label and field
        self.time_delay_label = ctk.CTkLabel(self.master, text="Launch Time Delay (sec):", fg_color=shared_utils.FRAME_COLOR, bg_color=shared_utils.FRAME_COLOR, text_color=shared_utils.TEXT_COLOR)
        self.time_delay_label.grid(row=6, column=4, sticky='e', padx=5, pady=5)
        self.time_delay_entry = ctk.CTkEntry(self.master, placeholder_text="0", width=80, fg_color=shared_utils.FRAME_COLOR, text_color=shared_utils.TEXT_COLOR, border_color="#334155", border_width=1, corner_radius=6)
        self.time_delay_entry.grid(row=6, column=5, sticky='w', padx=(10, 5), pady=5)

        # Create Priority dropdown
        self.priority_label = ctk.CTkLabel(self.master, text="Task Priority:", fg_color=shared_utils.FRAME_COLOR, bg_color=shared_utils.FRAME_COLOR, text_color=shared_utils.TEXT_COLOR)
        self.priority_label.grid(row=6, column=6, sticky='e', padx=5, pady=5)
        self.priority_options = ["Low", "Normal", "High", "Realtime"]
        self.priority_menu = ctk.CTkOptionMenu(self.master, values=self.priority_options, command=self.update_selected_process)
        self.priority_menu.configure(fg_color=shared_utils.BUTTON_COLOR, bg_color=shared_utils.FRAME_COLOR, button_color=shared_utils.BUTTON_IMPORTANT_COLOR, button_hover_color=shared_utils.BUTTON_HOVER_COLOR, width=140, dropdown_fg_color=shared_utils.BUTTON_COLOR, corner_radius=6)
        self.priority_menu.grid(row=6, column=7, sticky='w', padx=(5, 20), pady=5)
        self.priority_menu.set('Normal')

        # Create a label and entry for "Time to Initialize"
        self.time_to_init_label = ctk.CTkLabel(self.master, text="Time to Initialize (sec):", fg_color=shared_utils.FRAME_COLOR, bg_color=shared_utils.FRAME_COLOR, text_color=shared_utils.TEXT_COLOR)
        self.time_to_init_label.grid(row=7, column=4, sticky='e', padx=5, pady=5)
        self.time_to_init_entry = ctk.CTkEntry(self.master, placeholder_text="10", width=80, fg_color=shared_utils.FRAME_COLOR, text_color=shared_utils.TEXT_COLOR, border_color="#334155", border_width=1, corner_radius=6)
        self.time_to_init_entry.grid(row=7, column=5, sticky='w', padx=(10, 5), pady=5)

        # Create Visibility dropdown
        self.visibility_label = ctk.CTkLabel(self.master, text="Window Visibility:", fg_color=shared_utils.FRAME_COLOR, bg_color=shared_utils.FRAME_COLOR, text_color=shared_utils.TEXT_COLOR)
        self.visibility_label.grid(row=7, column=6, sticky='e', padx=5, pady=5)
        self.visibility_options = ["Show", "Hide"]
        self.visibility_menu = ctk.CTkOptionMenu(self.master, values=self.visibility_options, command=self.update_selected_process)
        self.visibility_menu.configure(width=140, fg_color=shared_utils.BUTTON_COLOR, bg_color=shared_utils.FRAME_COLOR, button_color=shared_utils.BUTTON_IMPORTANT_COLOR, button_hover_color=shared_utils.BUTTON_HOVER_COLOR, dropdown_fg_color=shared_utils.BUTTON_COLOR, corner_radius=6)
        self.visibility_menu.grid(row=7, column=7, sticky='w', padx=(5, 20), pady=5)
        self.visibility_menu.set('Show')

        # Create a label and entry for "Restart Attempts"
        self.relaunch_attempts_label = ctk.CTkLabel(self.master, text="Relaunch attempts til Restart:", fg_color=shared_utils.FRAME_COLOR, bg_color=shared_utils.FRAME_COLOR, text_color=shared_utils.TEXT_COLOR)
        self.relaunch_attempts_label.grid(row=8, column=4, sticky='e', padx=5, pady=5)
        self.relaunch_attempts_entry = ctk.CTkEntry(self.master, placeholder_text="3", width=80, fg_color=shared_utils.FRAME_COLOR, text_color=shared_utils.TEXT_COLOR, border_color="#334155", border_width=1, corner_radius=6)
        self.relaunch_attempts_entry.grid(row=8, column=5, sticky='w', padx=(10, 5), pady=5)

        # BINDINGS
        # Bind the Entry widgets to auto-save when Return is pressed or focus is lost
        self.name_entry.bind('<Return>', self.update_selected_process)
        self.name_entry.bind('<FocusOut>', self.update_selected_process)

        self.exe_path_entry.bind('<Return>', self.update_selected_process)
        self.exe_path_entry.bind('<FocusOut>', self.update_selected_process)

        self.file_path_entry.bind('<Return>', self.update_selected_process)
        self.file_path_entry.bind('<FocusOut>', self.update_selected_process)

        self.cwd_entry.bind('<Return>', self.update_selected_process)
        self.cwd_entry.bind('<FocusOut>', self.update_selected_process)

        self.time_delay_entry.bind('<Return>', self.update_selected_process)
        self.time_delay_entry.bind('<FocusOut>', self.update_selected_process)

        self.time_to_init_entry.bind('<Return>', self.update_selected_process)
        self.time_to_init_entry.bind('<FocusOut>', self.update_selected_process)

        self.relaunch_attempts_entry.bind('<Return>', self.update_selected_process)
        self.relaunch_attempts_entry.bind('<FocusOut>', self.update_selected_process)

        # Bind a mouse click event to the root window to defocus entry fields
        self.master.bind("<Button-1>", self.defocus_entry)

        # Make columns stretchable
        # Left side (process list): columns 0-2
        self.master.grid_columnconfigure(0, weight=0)
        self.master.grid_columnconfigure(1, weight=0)
        self.master.grid_columnconfigure(2, weight=0)
        # Separator: column 3
        self.master.grid_columnconfigure(3, weight=0)
        # Right side (process details): columns 4-7
        self.master.grid_columnconfigure(4, weight=1)  # Labels column
        self.master.grid_columnconfigure(5, weight=0)  # First input/browse column
        self.master.grid_columnconfigure(6, weight=2)  # Second label/input column
        self.master.grid_columnconfigure(7, weight=2)  # Second input column

        # No row weight configuration needed - keeps layout compact

    # PROCESS HANDLING

    def toggle_launch_process(self):
        if self.selected_process:
            index = shared_utils.get_process_index(self.selected_process)
            current_state = self.config['processes'][index].get('autolaunch', False)
            new_state = not current_state

            # If turning ON, validate required fields
            if new_state:
                name = self.config['processes'][index].get('name', '')
                exe_path = self.config['processes'][index].get('exe_path', '').strip()

                if not name or not exe_path:
                    CTkMessagebox(master=self.master, title="Validation Error", message="Name and Exe Path are required to enable Autolaunch.", icon="cancel")
                    self.autolaunch_toggle.deselect()
                    return

                # Validate that executable path actually exists
                if not os.path.isfile(exe_path):
                    CTkMessagebox(master=self.master, title="Validation Error", message=f"Cannot enable Autolaunch: Executable path does not exist.\n\n{exe_path}\n\nPlease set a valid executable path first.", icon="cancel")
                    self.autolaunch_toggle.deselect()
                    return

            self.config['processes'][index]['autolaunch'] = new_state
            shared_utils.save_config(self.config)

            # Upload to Firestore immediately for fast sync (in background thread)
            if self.firebase_client:
                def upload_in_background():
                    try:
                        self.firebase_client.upload_config(self.config)
                        logging.info("Config uploaded to Firestore immediately after toggle")

                        # Push metrics so web app sees the change immediately
                        metrics = shared_utils.get_system_metrics(skip_gpu=True)
                        self.firebase_client._upload_metrics(metrics)
                        logging.info("Metrics pushed to Firestore after toggle")
                    except Exception as e:
                        logging.error(f"Failed to upload to Firestore: {e}")

                # Run in background thread so GUI stays responsive
                upload_thread = threading.Thread(target=upload_in_background, daemon=True)
                upload_thread.start()

            # Status message if process has been launched
            try:
                pid = shared_utils.fetch_pid_by_id(self.config['processes'][index]['id'])
                shared_utils.update_process_status_in_json(pid, 'INACTIVE' if current_state else 'QUEUED')
            except Exception as e:
                logging.info(e)

    def new_process(self):
        """Create a new process entry immediately with default values"""
        # Generate unique ID
        unique_id = str(uuid.uuid4())

        # Create new process with default values
        new_process = {
            'id': unique_id,
            'name': 'New Process',
            'exe_path': '',
            'file_path': '',
            'cwd': '',
            'priority': 'Normal',
            'visibility': 'Show',
            'time_delay': '0',
            'time_to_init': '10',
            'relaunch_attempts': '3',
            'autolaunch': False
        }

        # Add to config and save
        self.config['processes'].append(new_process)
        shared_utils.save_config(self.config)

        # Upload to Firestore immediately for fast sync (in background thread)
        if self.firebase_client:
            def upload_in_background():
                try:
                    self.firebase_client.upload_config(self.config)
                    logging.info("Config uploaded to Firestore immediately after new process")

                    # Push metrics so web app sees the change immediately
                    metrics = shared_utils.get_system_metrics(skip_gpu=True)
                    self.firebase_client._upload_metrics(metrics)
                    logging.info("Metrics pushed to Firestore after new process")
                except Exception as e:
                    logging.error(f"Failed to upload to Firestore: {e}")

            # Run in background thread so GUI stays responsive
            upload_thread = threading.Thread(target=upload_in_background, daemon=True)
            upload_thread.start()

        # Update the process list to show the new entry
        self.update_process_list()

        # Calculate index for the new process
        new_index = len(self.config['processes']) - 1

        # Delay activation to allow UI to fully update
        self.master.after(150, lambda: self._activate_new_process(new_index))

    def _activate_new_process(self, index):
        """Helper method to activate and focus on a newly created process"""
        try:
            self.process_list.activate(index)
            # Focus on the name field for easy editing
            self.name_entry.focus_set()
            self.name_entry.select_range(0, tk.END)  # Select all text for easy replacement
        except Exception as e:
            logging.error(f"Error activating new process: {e}")

    def update_selected_process(self,event=None):
        # Determine if this is a "soft save" (triggered by Enter key) or "hard save" (Save Changes button)
        is_soft_save = event is not None

        # Field Validation
        name = self.name_entry.get()
        exe_path = self.exe_path_entry.get()
        file_path = self.file_path_entry.get()
        cwd = self.cwd_entry.get()
        priority = self.priority_menu.get()
        visibility = self.visibility_menu.get()
        time_delay = self.time_delay_entry.get()
        time_to_init = self.time_to_init_entry.get()
        relaunch_attempts = self.relaunch_attempts_entry.get()

        # Validate Time Delay
        try:
            if float(time_delay):  # Try converting the time delay to a float
                if float(time_delay) < 0:
                    raise ValueError("Start Time Delay must be greater than or equal to 0.")

        except ValueError:
            if not is_soft_save:
                CTkMessagebox(master=self.master, title="Validation Error", message="Start Time Delay must be a number (integer or float).", icon="cancel")
                self.time_delay_entry.delete(0, tk.END)
                self.time_delay_entry.insert(0, 0)
                return
            else:
                # For soft saves, just use default value but continue saving
                time_delay = '0'

        # Validate Time To Init
        try:
            if float(time_to_init):  # Try converting the time to init to a float
                if float(time_to_init) < 10 or float(time_to_init) == 0:
                    raise ValueError("Time to initialize must be greater than or equal to 10 seconds.")
        except ValueError:
            if not is_soft_save:
                CTkMessagebox(master=self.master, title="Validation Error", message="Time to Initialize must be at least 10 seconds", icon="cancel")
                self.time_to_init_entry.delete(0, tk.END)
                self.time_to_init_entry.insert(0, 10)
                return
            else:
                # For soft saves, just use default value but continue saving
                time_to_init = '10'

        # Validate CWD
        if cwd and not os.path.isdir(cwd):
            if not is_soft_save:
                CTkMessagebox(master=self.master, title="Validation Error", message="The specified working directory does not exist.", icon="cancel")
                return
            # For soft saves, allow invalid paths (user might be typing)

        # Validate Relaunch Attempts
        try:
            if int(relaunch_attempts):  # Try converting the relaunch attempts to an integer
                if int(relaunch_attempts) < 0:
                    raise ValueError("Relaunch attempts must be >=0")
        except ValueError:
            if not is_soft_save:
                CTkMessagebox(master=self.master, title="Validation Error", message="Relaunch attempts must be an integer. 3 is recommended. After 3 attempts, a system restart will be attempted. Set to 0 for unlimited attempts to relaunch (no system restart).", icon="cancel")
                self.relaunch_attempts_entry.delete(0, tk.END)
                self.relaunch_attempts_entry.insert(0, 3)
                return
            else:
                # For soft saves, just use default value but continue saving
                relaunch_attempts = '3'

        # Check if relaunch attempts is empty and set to default if so
        if not relaunch_attempts:
            relaunch_attempts = 3  # Default value

        # Check if time to init is empty and set to default if so
        if not time_to_init:
            relaunch_attempts = 60  # Default value

        # Write config
        if self.selected_process:
            # Updating existing process
            # For soft saves (Enter key), only save if at least name is filled
            # For hard saves (Save Changes button), require both name and exe_path
            if is_soft_save:
                # Soft save: just save whatever is there, no validation errors
                if not name:
                    # If name is empty, just return without saving or showing error
                    return
            else:
                # Hard save: strict validation
                if not name or not exe_path:
                    CTkMessagebox(master=self.master, title="Validation Error", message="Name and Exe Path are required fields.", icon="cancel")
                    return

            index = shared_utils.get_process_index(self.selected_process)

            self.config['processes'][index]['name'] = name
            self.config['processes'][index]['exe_path'] = exe_path
            self.config['processes'][index]['file_path'] = file_path
            self.config['processes'][index]['cwd'] = cwd
            self.config['processes'][index]['priority'] = priority
            self.config['processes'][index]['visibility'] = visibility
            self.config['processes'][index]['time_delay'] = time_delay
            self.config['processes'][index]['time_to_init'] = time_to_init
            self.config['processes'][index]['relaunch_attempts'] = relaunch_attempts

            shared_utils.save_config(self.config)

            # Update the config hash to prevent auto-refresh from reverting the change
            import hashlib
            config_str = json.dumps(self.config['processes'][index], sort_keys=True)
            self.prev_config_hash = hashlib.md5(config_str.encode()).hexdigest()

            # Upload to Firestore immediately for fast sync (in background thread)
            if self.firebase_client:
                def upload_in_background():
                    try:
                        self.firebase_client.upload_config(self.config)
                        logging.info("Config uploaded to Firestore immediately after process update")

                        # Push metrics so web app sees the change immediately
                        metrics = shared_utils.get_system_metrics(skip_gpu=True)
                        self.firebase_client._upload_metrics(metrics)
                        logging.info("Metrics pushed to Firestore after process update")
                    except Exception as e:
                        logging.error(f"Failed to upload to Firestore: {e}")

                # Run in background thread so GUI stays responsive
                upload_thread = threading.Thread(target=upload_in_background, daemon=True)
                upload_thread.start()

            self.update_process_list()

            # Re-select the process
            self.process_list.activate(index)
        else:
            # Adding new process (no process selected)
            # For soft saves, skip validation entirely
            if is_soft_save:
                return

            # Hard save: strict validation
            if not name or not exe_path:
                CTkMessagebox(master=self.master, title="Validation Error", message="Name and Exe Path are required fields.", icon="cancel")
                return

            if not os.path.exists(exe_path):
                CTkMessagebox(master=self.master, title="Validation Error", message="The specified Exe Path does not exist.", icon="cancel")
                return

            if file_path and not os.path.exists(file_path):
                CTkMessagebox(master=self.master, title="Validation Error", message="The specified File Path does not exist.", icon="cancel")
                return

            # Generate unique ID
            unique_id = str(uuid.uuid4())
            autolaunch = True if self.autolaunch_toggle.get() == 'on' else False

            new_process = {
                'id': unique_id,
                'name': name,
                'exe_path': exe_path,
                'file_path': file_path,
                'cwd': cwd,
                'priority': priority,
                'visibility': visibility,
                'time_delay': time_delay,
                'time_to_init': time_to_init,
                'relaunch_attempts': relaunch_attempts,
                'autolaunch': autolaunch
            }

            self.config['processes'].append(new_process)
            shared_utils.save_config(self.config)
            self.update_process_list()

            # Select the newly added process
            self.process_list.activate(len(self.config['processes']) - 1)

        self.master.focus_set() # Defocus from the entry widget back to root

    def add_process(self):
        # Generate a unique ID for the new process
        unique_id = str(uuid.uuid4())

        name = self.name_entry.get()
        exe_path = self.exe_path_entry.get()
        file_path = self.file_path_entry.get()
        cwd = self.cwd_entry.get()
        priority = self.priority_menu.get()
        visibility = self.visibility_menu.get()
        time_delay = self.time_delay_entry.get() if self.time_delay_entry.get() else 0 # Default to 0 if empty
        time_to_init = self.time_to_init_entry.get() if self.time_to_init_entry.get() else 60 # Default to 60 if empty
        relaunch_attempts = self.relaunch_attempts_entry.get() if self.relaunch_attempts_entry.get() else 3 # Default to 3 if empty
        autolaunch = True if self.autolaunch_toggle.get() == 'on' else False
        
        if not name or not exe_path:
            CTkMessagebox(master=self.master, title="Validation Error", message="Name and Exe Path are required fields.", icon="cancel")
            return
        
        if not os.path.exists(exe_path):
            CTkMessagebox(master=self.master, title="Validation Error", message="The specified Exe Path does not exist.", icon="cancel")
            return
        
        if file_path and not os.path.exists(file_path):
            CTkMessagebox(master=self.master, title="Validation Error", message="The specified File Path does not exist.", icon="cancel")
            return

        new_process = {
            'id': unique_id,
            'name': name,
            'exe_path': exe_path,
            'file_path': file_path,
            'cwd': cwd,
            'priority': priority,
            'visibility': visibility,
            'time_delay': time_delay,
            'time_to_init': time_to_init,
            'relaunch_attempts': relaunch_attempts,
            'autolaunch': autolaunch
        }

        self.config['processes'].append(new_process)
        shared_utils.save_config(self.config)
        self.update_process_list()

    # BROWSING FOR FILES

    def browse_exe(self):
        exe_path = filedialog.askopenfilename(initialdir="C:/", title="Select Exe File", filetypes=[("Executable files", "*.exe")])
        self.exe_path_entry.delete(0, tk.END)
        self.exe_path_entry.insert(0, exe_path)
        self.update_selected_process()

    def browse_file(self):
        file_path = filedialog.askopenfilename(initialdir="C:/", title="Select File")
        self.file_path_entry.delete(0, tk.END)
        self.file_path_entry.insert(0, file_path)
        self.update_selected_process()

    def browse_cwd(self):
        cwd = filedialog.askdirectory(initialdir="C:/", title="Select Working Directory")
        self.cwd_entry.delete(0, tk.END)
        self.cwd_entry.insert(0, cwd)
        self.update_selected_process()

    # PROCESS LIST

    def get_os_pid_by_process_id(self, process_list_id, result_file_path):
        app_states = shared_utils.read_json_from_file(result_file_path)
        
        # Filter the dictionary by the process_list_id
        filtered_dict = {pid: info for pid, info in app_states.items() if info.get('id') == process_list_id}
        
        # Sort the filtered dictionary by the timestamp
        sorted_dict = {k: v for k, v in sorted(filtered_dict.items(), key=lambda item: item[1]['timestamp'], reverse=True)}
        
        # Get the last (latest) pid
        last_pid = next(iter(sorted_dict.keys()), None)
        
        return int(last_pid) if last_pid else None

    def kill_process(self):
        if self.selected_process:
            os_pid = self.get_os_pid_by_process_id(self.selected_process, shared_utils.RESULT_FILE_PATH)
            killed = False
            if os_pid:
                try:
                    os.kill(os_pid, signal.SIGTERM)  # or signal.SIGKILL
                    killed = True
                except Exception as e:
                    CTkMessagebox(master=self.master, title="Error", message=f"Failed to kill the process: {e}", icon="cancel")
            else:
                CTkMessagebox(master=self.master, title="Error", message="No OS process ID found for the selected process.", icon="cancel")

            if killed:
                shared_utils.update_process_status_in_json(os_pid, 'KILLED')
        else:
            CTkMessagebox(master=self.master, title="Error", message=f"You must select a process to kill it.", icon="cancel")

    def get_status_indicator(self, status):
        """Map status to fixed-width text badge"""
        status_map = {
            'RUNNING': '[RUN ]',      # Actively running
            'LAUNCHING': '[INIT]',    # Starting up
            'QUEUED': '[WAIT]',       # Waiting to start
            'KILLED': '[STOP]',       # Manually stopped
            'STOPPED': '[STOP]',      # Stopped
            'INACTIVE': '[OFF ]',     # Inactive/not managed
        }
        return status_map.get(status, '[OFF ]')

    def map_status_to_config(self, status_data, config_data):
        id_to_status = {}
        for pid, info in status_data.items():
            id_ = info.get('id', None)
            status = info.get('status', None)
            if id_ and status:
                id_to_status[id_] = status

        for process in config_data['processes']:
            id_ = process.get('id', None)
            if id_:
                process['status'] = id_to_status.get(id_, "INACTIVE")

        return config_data

    def update_process_list(self):
        # Get current keyboard focus (selected entry widget)
        current_focus = str(self.master.focus_get())
        #logging.error(f'current focus = {current_focus}')

        # Get currently selected item from process list
        self.selected_index = self.process_list.curselection()

        status_data = shared_utils.read_json_from_file(shared_utils.RESULT_FILE_PATH)

        # Reload config from disk to catch external changes (from Firestore, etc.)
        fresh_config = shared_utils.read_config()
        if fresh_config:
            self.config = fresh_config

        updated_config = self.map_status_to_config(status_data, self.config)

        # Format with colored dot indicators
        new_list = [f"{self.get_status_indicator(process['status'])} {process['name']}" for process in updated_config['processes']]

        if new_list != self.prev_process_list:
            if self.process_list.size() > 0:
                self.process_list.delete(0, 'end')  # Clear the existing listbox items
            for item in new_list:
                self.process_list.insert('end', item)
            self.prev_process_list = new_list  # Update the previous list

        # Try to reselect process list item automatically (if not editing an entry)
        if self.selected_index is not None and current_focus == '.' or current_focus is None:
            try:
                self.process_list.activate(self.selected_index)
            except Exception as e:
                logging.info(e)

        # Don't auto-refresh displayed fields - only refresh when user explicitly selects a process
        # This prevents overwriting user input before they save
        # External changes from Firestore will be visible when switching processes

    def update_process_list_periodically(self):
        self.update_process_list()
        self.master.after(1000, self.update_process_list_periodically)  # Schedule next run

    def remove_process(self):
        if self.selected_process:
            process = shared_utils.fetch_process_by_id(self.selected_process, self.config)
            if process:
                process_name = shared_utils.fetch_process_name_by_id(self.selected_process, self.config)
                response = CTkMessagebox(master=self.master, title="Remove Process?", message=f"Are you sure you want to remove {process_name}?", icon="question", option_1="Yes", option_2="No")
                if response.get() == 'Yes':
                    index = shared_utils.get_process_index(self.selected_process)
                    if index is not None:
                        del self.config['processes'][index]
                        shared_utils.save_config(self.config)

                        # Upload to Firestore immediately for fast sync (in background thread)
                        if self.firebase_client:
                            def upload_in_background():
                                try:
                                    # Upload config first
                                    self.firebase_client.upload_config(self.config)
                                    logging.info("Config uploaded to Firestore immediately after process removal")

                                    # Then push metrics so web app sees the change immediately
                                    metrics = shared_utils.get_system_metrics(skip_gpu=True)
                                    self.firebase_client._upload_metrics(metrics)
                                    logging.info("Metrics pushed to Firestore after process removal")
                                except Exception as e:
                                    logging.error(f"Failed to upload to Firestore: {e}")

                            # Run in background thread so GUI stays responsive
                            upload_thread = threading.Thread(target=upload_in_background, daemon=True)
                            upload_thread.start()

                        self.update_process_list()            
            else:
                CTkMessagebox(master=self.master, title="Error", message=f"No process found with the name '{self.selected_process}'", icon="cancel")
        else:
            CTkMessagebox(master=self.master, title="Error", message=f"You must select a process to remove it.", icon="cancel")

    def move_up(self):
        if self.selected_process:
            index = shared_utils.get_process_index(self.selected_process)
            if index > 0:
                self.config['processes'][index], self.config['processes'][index-1] = self.config['processes'][index-1], self.config['processes'][index]
                shared_utils.save_config(self.config)

                # Upload to Firestore immediately for fast sync (in background thread)
                if self.firebase_client:
                    def upload_in_background():
                        try:
                            self.firebase_client.upload_config(self.config)
                            logging.info("Config uploaded to Firestore immediately after move up")

                            # Push metrics so web app sees the change immediately
                            metrics = shared_utils.get_system_metrics(skip_gpu=True)
                            self.firebase_client._upload_metrics(metrics)
                            logging.info("Metrics pushed to Firestore after move up")
                        except Exception as e:
                            logging.error(f"Failed to upload to Firestore: {e}")

                    # Run in background thread so GUI stays responsive
                    upload_thread = threading.Thread(target=upload_in_background, daemon=True)
                    upload_thread.start()

                self.update_process_list()
                self.process_list.activate(index-1)
        else:
            CTkMessagebox(master=self.master, title="Error", message=f"You must select a process move it up in the list.", icon="cancel")

    def move_down(self):
        if self.selected_process:
            index = shared_utils.get_process_index(self.selected_process)
            if index < len(self.config['processes']) - 1:
                self.config['processes'][index], self.config['processes'][index+1] = self.config['processes'][index+1], self.config['processes'][index]
                shared_utils.save_config(self.config)

                # Upload to Firestore immediately for fast sync (in background thread)
                if self.firebase_client:
                    def upload_in_background():
                        try:
                            self.firebase_client.upload_config(self.config)
                            logging.info("Config uploaded to Firestore immediately after move down")

                            # Push metrics so web app sees the change immediately
                            metrics = shared_utils.get_system_metrics(skip_gpu=True)
                            self.firebase_client._upload_metrics(metrics)
                            logging.info("Metrics pushed to Firestore after move down")
                        except Exception as e:
                            logging.error(f"Failed to upload to Firestore: {e}")

                    # Run in background thread so GUI stays responsive
                    upload_thread = threading.Thread(target=upload_in_background, daemon=True)
                    upload_thread.start()

                self.update_process_list()
                self.process_list.activate(index+1)
        else:
            CTkMessagebox(master=self.master, title="Error", message=f"You must select a process to move it down in the list.", icon="cancel")

    def on_select(self, process_name):
        # Remove status indicator "[XXX] " from the beginning
        if process_name.startswith('[') and '] ' in process_name:
            process_name = process_name.split('] ', 1)[1]  # Strip status badge
        process_id = shared_utils.fetch_process_id_by_name(process_name, self.config)
        self.selected_process = process_id
        process = shared_utils.fetch_process_by_id(process_id, self.config)
        self.refresh_displayed_fields(process)

    def refresh_displayed_fields(self, process):
        """Update all displayed fields from process data (for external changes)"""
        self.name_entry.delete(0, tk.END)
        self.name_entry.insert(0, process.get('name', ''))
        self.exe_path_entry.delete(0, tk.END)
        self.exe_path_entry.insert(0, process.get('exe_path', ''))
        self.visibility_menu.set(process.get('visibility', 'Show'))
        self.priority_menu.set(process.get('priority', 'Normal'))
        self.file_path_entry.delete(0, tk.END)
        self.file_path_entry.insert(0, process.get('file_path', ''))
        self.cwd_entry.delete(0, tk.END)
        self.cwd_entry.insert(0, process.get('cwd', ''))
        self.time_delay_entry.delete(0, tk.END)
        self.time_delay_entry.insert(0, process.get('time_delay', ''))
        self.time_to_init_entry.delete(0, tk.END)
        self.time_to_init_entry.insert(0, process.get('time_to_init', ''))
        self.relaunch_attempts_entry.delete(0, tk.END)
        self.relaunch_attempts_entry.insert(0, process.get('relaunch_attempts', ''))
        autolaunch = process.get('autolaunch', True)
        if autolaunch:
            self.autolaunch_toggle.select()
        else:
            self.autolaunch_toggle.deselect()

    # FIREBASE STATUS

    def update_firebase_status(self):
        """Update Firebase connection status indicator."""
        import os

        # Check if Firebase is enabled in config
        firebase_enabled = self.config.get('firebase', {}).get('enabled', False)

        # Check if credentials file exists
        credentials_path = shared_utils.get_path('../config/firebase-credentials.json')
        credentials_exist = os.path.exists(credentials_path)

        if firebase_enabled and credentials_exist:
            self.firebase_status_label.configure(text="Firebase: Connected", text_color="#4ade80")  # Green
        elif firebase_enabled and not credentials_exist:
            self.firebase_status_label.configure(text="Firebase: Missing Credentials", text_color="#fbbf24")  # Yellow/Warning
        else:
            self.firebase_status_label.configure(text="Firebase: Disabled", text_color="#6b7280")  # Gray

    # UI

    def defocus_entry(self, event):
        """Defocus entry fields when clicking on the background"""
        widget = self.master.winfo_containing(event.x_root, event.y_root)
        if 'ctkframe' in str(widget):
            self.master.focus_set()  # Transfers focus to the root window (triggers FocusOut auto-save)

    # SYSTEM/MISC

    def check_service_is_running(self, service_name):
        try:
            # Lazy import win32serviceutil only when checking service
            import win32serviceutil
            status = win32serviceutil.QueryServiceStatus(service_name)[1]
            if status == 4:  # 4 means the service is running
                return True
            else:
                return False
        except Exception as e:
            print(f"An error occurred: {e}")
            return None

    def start_service(self):
        try:
            subprocess.Popen(
                ["pythonw", shared_utils.get_path("start_service.py")],
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            print("Service started successfully.")
        except Exception as e:
            print(f"Failed to start service: {e}")

if __name__ == "__main__":
    # Initialize logging
    shared_utils.initialize_logging("gui")
    root = ctk.CTk()
    app = OwletteConfigApp(root)
    root.mainloop()