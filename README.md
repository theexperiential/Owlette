# 🦉 Owlette

Owlette is a Python-based Windows process watcher service designed for maximum flexibility and editability. 🛠️ It manages and monitors various processes and system metrics, automatically restarting applications if they crash or are accidentally closed. 🔄 It also sends email notifications when certain events occur. 📧

## 🌟 Features

- 🚀 Starts specified processes upon system startup
- 🔄 Automatically restarts applications if they crash or are accidentally closed
- 📊 Monitors system metrics like CPU usage, memory usage, and disk space
- 📧 Sends email notifications using Gmail API
- 🍽️ Tray icon for easy access to features and settings

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

Run the `install.bat` file as an Administrator to automatically install the required packages and set up the service. It also works as an updater, anytime this repo is updated.

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
    
    

## 🗑️ Uninstallation 

To uninstall the Owlette service, run the following command as an administrator:

    
    python owlette_service.py remove
    

This will remove the Owlette service from your system.

## 🐞 Troubleshooting

Logs are stored in `_service.log` for the service and `_email.log` for the email notifications. Check these logs for debugging information.

## 🤝 Contributing

Feel free to contribute by submitting pull requests.

## 📜 License

This project is licensed under the GNU General Public License v3.0.
