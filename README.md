# Owlette

Owlette is a Python-based Windows process watcher service designed for maximum flexibility and editability. It manages and monitors various processes and system metrics, automatically restarting applications if they crash or are accidentally closed. It also sends email notifications when certain events occur.

## Features

- Starts specified processes upon system startup
- Automatically restarts applications if they crash or are accidentally closed
- Monitors system metrics like CPU usage, memory usage, and disk space
- Sends email notifications using Gmail API
- Tray icon for easy access to features and settings

## Installation

### Prerequisites

- Python 3.9 or higher
- pip (Python package installer)
- Google Cloud Platform (GCP) account for Gmail API

1. Clone the repository:

    ```bash
    git clone https://github.com/theexperiential/Owlette.git
    ```

2. Navigate to the project directory:

    ```bash
    cd Owlette
    ```

### Installation Methods

#### Automatic Installation

Run the `install.bat` file to automatically install the required packages and set up the service.

#### Manual Installation

Install the required Python packages:

    ```bash
    pip install -r requirements.txt
    ```

### Google Cloud Platform (GCP) Configuration

1. Go to the [Google Cloud Console](https://console.developers.google.com/).
2. Create a new project.
3. Navigate to "APIs & Services" > "Dashboard".
4. Enable the Gmail API.
5. Create OAuth client IDs and download the client secrets JSON file.
6. Place the downloaded JSON file in the project directory and rename it to `client_secrets.json`.

## Usage

1. Run the `owlette_gui.py` script to configure the service:

    ```bash
    python owlette_gui.py
    ```

2. Follow the on-screen instructions to authenticate with Gmail and configure the processes you want to manage.

3. To install the Windows service, run the following command as an administrator:

    ```bash
    python owlette_service.py install
    ```

4. To start the Windows service, run:

    ```bash
    python owlette_service.py start
    ```

5. To stop the Windows service, run:

    ```bash
    python owlette_service.py stop
    ```

6. The tray icon will automatically run with the service. But if you wish to run the GUI configuration, just double-click on `owlette_gui.py` or run:

    ```bash
    python owlette_gui.py
    ```

7. To restart the system tray icon, restart the process or run:

    ```bash
    python owlette_tray.py
    ```
    
## Troubleshooting

Logs are stored in `_service.log` for the service and `_email.log` for the email notifications. Check these logs for debugging information.

## Contributing

Feel free to contribute by submitting pull requests.

## License

This project is licensed under the MIT License.



