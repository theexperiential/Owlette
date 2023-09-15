import shared_utils
import tkinter as tk
from tkinter import ttk
from tkinter import messagebox
from tkinter import filedialog
import os
import json
from email_validator import validate_email, EmailNotValidError
from google_auth_oauthlib.flow import InstalledAppFlow
import keyring
import logging

def load_config(email_from_entry, emails_to_entry):
    try:
        with open(shared_utils.get_path('config.json'), 'r') as f:
            config = json.load(f)
            email_from_entry.insert(0, config['email']['from'])
            emails_to_entry.insert(0, ', '.join(config['email']['to']))
            return config
    except FileNotFoundError:
        logging.error(f"Failed to load config: {e}")
        return {shared_utils.generateConfigFile()}
        

def save_config(config):
    config['email']['from'] = email_from_entry.get()
    config['email']['to'] = [email.strip() for email in emails_to_entry.get().split(',')]
    with open(shared_utils.get_path('config.json'), 'w') as f:
        json.dump(config, f, indent=4)

def update_process_list():
    process_list.delete(0, tk.END)
    for process in config['processes']:
        process_list.insert(tk.END, process['name'])

def add_process():
    name = name_entry.get()
    exe_path = exe_path_entry.get()
    file_path = file_path_entry.get()
    time_delay = time_delay_entry.get() if time_delay_entry.get() else 0 # Default to 0 if empty

    # Check for duplicate names
    if any(process['name'] == name for process in config['processes']):
        tk.messagebox.showwarning("Validation Error", "A process with this name already exists.")
        return
    
    if not name or not exe_path:
        tk.messagebox.showwarning("Validation Error", "Name and Exe Path are required fields.")
        return
    
    if not os.path.exists(exe_path):
        tk.messagebox.showwarning("Validation Error", "The specified Exe Path does not exist.")
        return
    
    if file_path and not os.path.exists(file_path):
        tk.messagebox.showwarning("Validation Error", "The specified File Path does not exist.")
        return

    new_process = {'name': name, 'exe_path': exe_path, 'file_path': file_path, 'time_delay': time_delay}    
    config['processes'].append(new_process)
    save_config(config)
    update_process_list()

def browse_exe():
    exe_path = filedialog.askopenfilename(initialdir="C:/", title="Select Exe File", filetypes=[("Executable files", "*.exe")])
    exe_path_entry.delete(0, tk.END)
    exe_path_entry.insert(0, exe_path)
    update_selected_process()

def browse_file():
    file_path = filedialog.askopenfilename(initialdir="C:/", title="Select File")
    file_path_entry.delete(0, tk.END)
    file_path_entry.insert(0, file_path)
    update_selected_process()

def remove_process():
    selected_process = process_list.curselection()
    if selected_process:
        index = selected_process[0]
        process_name = config['processes'][index]['name']
        
        confirm = tk.messagebox.askyesno("Confirmation", f"Are you sure you want to remove {process_name}?")
        
        if confirm:
            del config['processes'][index]
            save_config(config)
            update_process_list()

def move_up():
    selected_process = process_list.curselection()
    if selected_process:
        index = selected_process[0]
        if index > 0:
            config['processes'][index], config['processes'][index-1] = config['processes'][index-1], config['processes'][index]
            save_config(config)
            update_process_list()
            process_list.select_set(index-1)

def move_down():
    selected_process = process_list.curselection()
    if selected_process:
        index = selected_process[0]
        if index < len(config['processes']) - 1:
            config['processes'][index], config['processes'][index+1] = config['processes'][index+1], config['processes'][index]
            save_config(config)
            update_process_list()
            process_list.select_set(index+1)

def on_select(event):
    selected_process = process_list.curselection()
    if selected_process:
        index = selected_process[0]
        process = config['processes'][index]
        name_entry.delete(0, tk.END)
        name_entry.insert(0, process['name'])
        exe_path_entry.delete(0, tk.END)
        exe_path_entry.insert(0, process['exe_path'])
        file_path_entry.delete(0, tk.END)
        file_path_entry.insert(0, process['file_path'])
        time_delay_entry.delete(0, tk.END)
        time_delay_entry.insert(0, process.get('time_delay', ''))

def validate_email_address(email):
    try:
        # validate and get info
        v = validate_email(email)
        return True
    except EmailNotValidError as e:
        # email is not valid, exception message is human-readable
        print(str(e))
        return False

def update_email_config(event=None):
    email_from = email_from_entry.get()
    emails_to = emails_to_entry.get().split(',')

    if not validate_email_address(email_from):
        tk.messagebox.showwarning("Validation Error", "The 'Email From' address is not valid.")
        logging.warning(f"Invalid 'Email From' address {email_from}.")
        return

    for email in emails_to:
        if not validate_email_address(email.strip()):
            tk.messagebox.showwarning("Validation Error", f"The 'Email To' address {email} is not valid.")
            return

    config['email']['from'] = email_from
    config['email']['to'] = [email.strip() for email in emails_to]
    save_config(config)

def update_selected_process(event=None):
    selected_process = process_list.curselection()
    if selected_process:
        index = selected_process[0]
        name = name_entry.get()
        exe_path = exe_path_entry.get()
        file_path = file_path_entry.get()
        time_delay = time_delay_entry.get()

        # Validate Time Delay
        try:
            float(time_delay)  # Try converting the time delay to a float
        except ValueError:
            tk.messagebox.showwarning("Validation Error", "Time Delay must be a number (integer or float).")
            return

        if not name or not exe_path:
            tk.messagebox.showwarning("Validation Error", "Name and Exe Path are required fields.")
            return

        config['processes'][index]['name'] = name
        config['processes'][index]['exe_path'] = exe_path
        config['processes'][index]['file_path'] = file_path
        config['processes'][index]['time_delay'] = time_delay

        save_config(config)
        update_process_list()

        # Re-select the process
        process_list.select_set(index)

    update_email_config()  # Always update email config

#### EMAIL #####
def save_credentials_to_file(credentials, filename):
    with open(shared_utils.get_path(filename), 'w') as f:
        json.dump(json.loads(credentials.to_json()), f)

def get_google_auth_token():
    # Initialize the flow
    flow = InstalledAppFlow.from_client_secrets_file(
        shared_utils.get_path('client_secrets.json'),
        scopes=['https://www.googleapis.com/auth/gmail.send']
    )

    # Run the flow
    credentials = flow.run_local_server(port=0)
    keyring.set_password("Owlette", "GmailRefreshToken", credentials.refresh_token)


###### UI ######

# Create the main window
root = tk.Tk()
root.title("Owlette Configuration")

# Set initial window size
root.geometry("800x440")

# Dark theme colors
dark_bg = "#2E2E2E"
dark_fg = "#FFFFFF"

# Apply dark theme to root window
root.configure(bg=dark_bg)

# Create Labels and Entry widgets for adding a new process
ttk.Label(root, text="Name:", background=dark_bg, foreground=dark_fg).grid(row=1, column=0, sticky='e', padx=5, pady=5)
name_entry = tk.Entry(root, bg=dark_bg, fg=dark_fg, insertbackground=dark_fg, width=20)
name_entry.grid(row=1, column=1, columnspan=1, sticky='ew', padx=5, pady=5)

ttk.Label(root, text="Exe Path:", background=dark_bg, foreground=dark_fg).grid(row=2, column=0, sticky='e', padx=5, pady=5)
exe_path_entry = tk.Entry(root, bg=dark_bg, fg=dark_fg, insertbackground=dark_fg, width=60)
exe_path_entry.grid(row=2, column=1, sticky='ew', padx=5, pady=5)

# Create Browse buttons
exe_browse_button = tk.Button(root, text="Browse", command=browse_exe, bg=dark_bg, fg=dark_fg)
exe_browse_button.grid(row=2, column=2, sticky='w', padx=5, pady=5)

ttk.Label(root, text="File Path / Cmd Line Args:", background=dark_bg, foreground=dark_fg).grid(row=3, column=0, sticky='e', padx=(10, 5), pady=5)
file_path_entry = tk.Entry(root, bg=dark_bg, fg=dark_fg, insertbackground=dark_fg)
file_path_entry.grid(row=3, column=1, sticky='ew', padx=(5, 5), pady=5)

# Create Browse buttons
file_browse_button = tk.Button(root, text="Browse", command=browse_file, bg=dark_bg, fg=dark_fg)
file_browse_button.grid(row=3, column=2, sticky='w', padx=(5, 10), pady=5)

# Create Add button
add_button = tk.Button(root, text="Add Process", command=add_process, bg=dark_bg, fg=dark_fg)
add_button.grid(row=5, column=1, sticky='e', padx=(5, 0), pady=(5, 10))


# Create Time delay label and field
ttk.Label(root, text="Start Time Delay (s):", background=dark_bg, foreground=dark_fg).grid(row=5, column=0, sticky='e', padx=5, pady=5)
time_delay_entry = tk.Entry(root, bg=dark_bg, fg=dark_fg, insertbackground=dark_fg, width=10)
time_delay_entry.grid(row=5, column=1, sticky='w', padx=5, pady=5)

# Create a label for the process details
ttk.Label(root, text="Process Details:", background=dark_bg, foreground=dark_fg).grid(row=0, column=0, sticky='w', padx=10, pady=10)

# Create a label for the process list
ttk.Label(root, text="Process List:", background=dark_bg, foreground=dark_fg).grid(row=0, column=3, sticky='w', padx=10, pady=10)

# Create a Listbox to display the list of processes
process_list = tk.Listbox(root, bg=dark_bg, fg=dark_fg, exportselection=0)
process_list.grid(row=1, column=3, rowspan=3, sticky='nsew', padx=(10,0), pady=10)
process_list.bind('<<ListboxSelect>>', on_select)

# Create a Scrollbar for the Listbox
scrollbar = tk.Scrollbar(root, orient="vertical", command=process_list.yview, bg=dark_bg)
scrollbar.grid(row=1, column=4, rowspan=4, sticky='ns', padx=(0, 10), pady=10)
process_list['yscrollcommand'] = scrollbar.set

# Up and down buttons
up_button = tk.Button(root, text="Up", command=move_up, bg=dark_bg, fg=dark_fg)
up_button.grid(row=5, column=3, sticky='w', padx=(10, 10), pady=(5, 10))

down_button = tk.Button(root, text="Down", command=move_down, bg=dark_bg, fg=dark_fg)
down_button.grid(row=5, column=3, sticky='w', padx=(40, 5), pady=(5, 10))

# Create remove button
remove_button = tk.Button(root, text="Del", command=remove_process, bg=dark_bg, fg=dark_fg)
remove_button.grid(row=5, column=3, sticky='e', padx=(20, 0), pady=(5, 10))

# Create Save Changes button
save_button = tk.Button(root, text="Save Changes", command=update_selected_process, bg=dark_bg, fg=dark_fg)
save_button.grid(row=9, column=3, sticky='e', padx=(0, 10), pady=(10, 10))

# Create Connect to Gmail button
save_button = tk.Button(root, text="Connect to Gmail", command=get_google_auth_token, bg=dark_bg, fg=dark_fg)
save_button.grid(row=9, column=1, sticky='w', padx=(5), pady=(10, 10))

# Create a label for the email section
ttk.Label(root, text="Email Alerts:", background=dark_bg, foreground=dark_fg).grid(row=6, column=0, sticky='w', padx=10, pady=10)

# Create Labels and Entry widgets for email configuration
ttk.Label(root, text="Email From:", background=dark_bg, foreground=dark_fg).grid(row=7, column=0, sticky='e', padx=5, pady=10)
email_from_entry = tk.Entry(root, bg=dark_bg, fg=dark_fg, insertbackground=dark_fg, width=60)
email_from_entry.grid(row=7, column=1, sticky='ew', padx=5, pady=10)

ttk.Label(root, text="Emails To (Comma Separated):", background=dark_bg, foreground=dark_fg).grid(row=8, column=0, sticky='e', padx=5, pady=10)
emails_to_entry = tk.Entry(root, bg=dark_bg, fg=dark_fg, insertbackground=dark_fg, width=60)
emails_to_entry.grid(row=8, column=1, sticky='ew', padx=5, pady=10)

# Make columns stretchable
root.grid_columnconfigure(0, weight=1)
root.grid_columnconfigure(1, weight=1)
root.grid_columnconfigure(2, weight=1)
root.grid_columnconfigure(3, weight=1)

#### BINDINGS #####

# Bind the Entry widgets to update the selected process when the Return key is pressed
name_entry.bind('<Return>', update_selected_process)
exe_path_entry.bind('<Return>', update_selected_process)
file_path_entry.bind('<Return>', update_selected_process)
email_from_entry.bind('<Return>', update_email_config)
emails_to_entry.bind('<Return>', update_email_config)
time_delay_entry.bind('<Return>', update_selected_process)

# Load existing config after defining email entry widgets
config = load_config(email_from_entry, emails_to_entry)

update_process_list()

root.mainloop()