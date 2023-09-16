# 🦉 Owlette

Owlette is a Python-based Windows process watcher service designed for maximum flexibility and editability. 🛠️ It manages and monitors various processes and system metrics, automatically restarting applications if they crash or are accidentally closed. 🔄 It also sends email notifications when certain events occur. 📧

## 📚 Table of Contents

1. [🌟 Features](#-features)
2. [🛠️ Installation](#-installation)
3. [🚀 Usage](#-usage)
4. [🎛️ UI Features](#-ui-features)
5. [🛠️ Configuration](#-configuration)
6. [🗑️ Uninstallation](#uninstallation)
7. [🐞 Troubleshooting](#-troubleshooting)
8. [🤝 Contributing](#-contributing)
9. [📜 License](#-license)

<a id="features"></a>
## 🌟 Features

- 🚀 Starts specified processes upon system startup
- 🔄 Automatically restarts applications if they crash or are accidentally closed
- 📊 Monitors system metrics like CPU usage, memory usage, and disk space
- 📧 Sends email notifications using Gmail API
- 🍽️ Tray icon for easy access to features and settings

<a id="installation"></a>
## 🛠️ Installation

### 📋 Prerequisites

- 🐍 Python 3.9 or higher
- 📦 pip (Python package installer)
- ☁️ Google Cloud Platform (GCP) account for Gmail API

1️⃣ Clone the repository:

    
    git clone https://github.com/theexperiential/Owlette.git
    

2️⃣ Navigate to the project directory:

    
    cd Owlette
    

### 📦 Installation Methods

#### 🤖 Automatic Installation/Updater

Run the `install.bat` file as an administrator to automatically install the required packages and set up the service. It also works as an updater, anytime this repo is updated.

#### 🖐️ Manual Installation

Install the required Python packages:

    
    pip install -r requirements.txt
    

### ☁️ Google Cloud Platform (GCP) Configuration

1️⃣ Go to the [Google Cloud Console](https://console.developers.google.com/).
2️⃣ Create a new project.
3️⃣ Navigate to "APIs & Services" > "Dashboard".
4️⃣ Enable the Gmail API.
5️⃣ Create OAuth client IDs and download the client secrets JSON file.
6️⃣ Place the downloaded JSON file in the project directory and rename it to `client_secrets.json`.

<a id="usage"></a>
## 🚀 Usage

1️⃣ Run the `owlette_gui.py` script to configure the service:

    
    python owlette_gui.py
    

2️⃣ Follow the on-screen instructions to authenticate with Gmail and configure the processes you want to manage.

3️⃣ To install the Windows service, run the following command as an administrator:

    
    python owlette_service.py install
    

4️⃣ To start the Windows service, run:

    
    python owlette_service.py start
    

5️⃣ To stop the Windows service, run:

    
    python owlette_service.py stop
    

6️⃣ The tray icon will automatically run with the service. But if you wish to run the GUI configuration, just double-click on `owlette_gui.py` or run:

    
    python owlette_gui.py
    

7️⃣ To restart the system tray icon, restart the process or run:

    
    python owlette_tray.py
    

<a id="ui-features"></a>
## 🎛️ UI Features

### System Tray Icon

#### Right-Click Menu

- **Open Config**: Brings up the Owlette Configuration window where you can manage and monitor processes. 
- **Start on Login**: Allows you to toggle whether the service starts upon system login.
- **Exit**: Closes the Owlette service and any open Configuration windows.

<a id="configuration"></a>
## 🛠️ Configuration

### 📑 Overview

The Configuration UI is built using Python's Tkinter library and is designed to manage processes and email alerts. It features a dark theme and provides various functionalities like adding, removing, and reordering processes, as well as configuring email settings.

### 🧩 UI Components

#### 🔄 Process Details

- **Name**: Text field to enter the name of the process.
- **Exe Path**: Text field to specify the executable path. Includes a "Browse" button.
- **File Path / Cmd Line Args**: Text field for additional file paths or command-line arguments. Includes a "Browse" button.
- **Start Time Delay (s)**: Text field to specify a time delay before the process starts.
- **Add Process**: Button to add a new process based on the details provided.

#### 📋 Process List

- **Listbox**: Displays the list of configured processes.
- **Up**: Button to move the selected process up in the list.
- **Down**: Button to move the selected process down in the list.
- **Del**: Button to remove the selected process from the list.
- **Save Changes**: Button to save any modifications to the selected process.

#### 📧 Email Alerts

- **Email From**: Text field to specify the sender's email address.
- **Emails To (Comma Separated)**: Text field to specify the recipient email addresses, separated by commas.
- **Connect to Gmail**: Button to initiate Gmail OAuth flow for sending emails.

### 🌟 Features

- **Dark Theme**: The UI uses a dark color scheme for better visibility.
- **Validation**: Includes validation for duplicate process names, invalid paths, and invalid email addresses.
- **Keyboard Shortcuts**: The Return key can be used to update process and email configurations.

### ⚙️ Additional Functionalities

- **Google OAuth**: Includes a function to get Google OAuth tokens for Gmail.
- **JSON Configuration**: Utilizes a JSON file (`config.json`) to load and save configurations.

<a id="uninstallation"></a>
## 🗑️ Uninstallation 

To uninstall the Owlette service and python dependencies, you may run the `uninstall.bat` file as an administrator. Alternatively, to just remove the service, you may run the following command as an administrator:

    
    python owlette_service.py remove
    

This will remove the Owlette service from your system.

<a id="troubleshooting"></a>
## 🐞 Troubleshooting

### 📝 Logs 
Logs are stored in `_service.log` for the service, `_email.log` for the email notifications, and `_tray.log` for the tray icon. Check these logs for debugging information.

### 🔄 Restarting the service
If you exit Owlette from the tray icon or stop the service and wish to restart it, you can go to Services (`services.msc` from the run menu), and find the "Owlette Service" and click on "Start the service", or run the following command as an administrator:

    
    python owlette_service.py start
    

<a id="contributing"></a>
## 🤝 Contributing

Feel free to contribute by submitting pull requests.

<a id="license"></a>
## 📜 License

This project is licensed under the GNU General Public License v3.0.
