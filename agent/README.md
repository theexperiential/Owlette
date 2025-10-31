# Owlette Agent - Windows Service

The Owlette Agent is a Python-based Windows service that monitors and manages processes, with cloud integration via Firebase.

## Features

- **Process Monitoring**: Automatically restart crashed or frozen applications
- **Firebase Integration**: Real-time cloud communication and remote control
- **Offline Resilient**: Continues operating from cached config when offline
- **System Metrics**: Reports CPU, memory, disk, and GPU usage to cloud
- **Remote Commands**: Restart/kill processes from web portal
- **Notification Support**: Gmail and Slack notifications (legacy)

---

## Quick Start

### Prerequisites

- Windows 10/11 or Windows Server
- Python 3.9+ (installer will auto-install if missing)
- Firebase project (OPTIONAL - only needed for cloud features)

### Installation

1. **Run the installer** (as Administrator):
   ```cmd
   install.bat
   ```

   The installer will:
   - Auto-install Python 3.9 if needed
   - Install all dependencies
   - Create config folder and default configuration
   - Ask if you want Firebase (OPTIONAL - Owlette works great without it!)
   - Install and start the Windows service

2. **Configure processes** (optional):
   - Edit `config/config.json` to add processes to monitor
   - Or use the GUI: `python src/owlette_gui.py`
   - Or manage from web portal (coming in Phase 2)

3. **Add Firebase later** (optional):
   - Re-run `install.bat` and choose "Yes" for Firebase
   - Or manually:
     - Download service account key from [Firebase Console](https://console.firebase.google.com/)
     - Save as `config/firebase-credentials.json`
     - Edit `config/config.json`: set `firebase.enabled` to `true`
     - Restart service: `net stop OwletteService && net start OwletteService`

---

## Configuration

### config/config.json

```json
{
  "version": "2.0.0",
  "processes": [
    {
      "id": "unique-id-here",
      "name": "My Application",
      "exe_path": "C:\\Path\\To\\Application.exe",
      "file_path": "C:\\Path\\To\\file.toe",
      "cwd": "C:\\Working\\Directory",
      "time_delay": 0,
      "time_to_init": 10,
      "relaunch_attempts": 3,
      "autolaunch": true,
      "visibility": "Show",
      "priority": "Normal"
    }
  ],
  "firebase": {
    "enabled": true,
    "site_id": "your-site-id"
  },
  "gmail": {
    "enabled": false,
    "to": ["email@example.com"]
  },
  "slack": {
    "enabled": false
  }
}
```

### Process Settings

| Setting | Description | Values |
|---------|-------------|--------|
| `name` | Display name for the process | Any string |
| `exe_path` | Full path to executable | `C:\Path\To\app.exe` |
| `file_path` | File to open or command-line args | `C:\file.ext` or `--args` |
| `cwd` | Working directory | `C:\Working\Dir` |
| `time_delay` | Delay before launch (seconds) | `0`, `5`, `10`, etc. |
| `time_to_init` | Time to initialize before checking responsiveness | `10`, `30`, `60`, etc. |
| `relaunch_attempts` | Max restart attempts before system reboot | `3`, `5`, `10`, etc. |
| `autolaunch` | Auto-start on service start | `true` or `false` |
| `visibility` | Window visibility | `"Show"` or `"Hide"` |
| `priority` | Process priority | `"Low"`, `"Normal"`, `"High"`, `"Realtime"` |

### Firebase Settings

| Setting | Description |
|---------|-------------|
| `enabled` | Enable Firebase cloud features |
| `site_id` | Unique identifier for this site/location |

**To get Firebase credentials:**
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project → Settings (⚙️) → Service Accounts
3. Click "Generate new private key"
4. Save the JSON file as `config/firebase-credentials.json`

See [docs/firebase-setup.md](../docs/firebase-setup.md) for detailed Firebase setup.

---

## Manual Installation Steps

If `install.bat` doesn't work, follow these manual steps:

1. **Install Python 3.9+**
   ```cmd
   # Download from python.org and install
   ```

2. **Install dependencies**
   ```cmd
   cd agent
   pip install -r requirements.txt
   ```

3. **Create folders**
   ```cmd
   mkdir config
   mkdir logs
   mkdir tmp
   ```

4. **Create config file**
   ```cmd
   copy config.template.json config\config.json
   ```

5. **Add Firebase credentials** (optional but recommended)
   - Download from Firebase Console
   - Save as `config/firebase-credentials.json`

6. **Install service**
   ```cmd
   cd src
   python owlette_service.py install
   sc config OwletteService start= delayed-auto
   python owlette_service.py start
   ```

---

## Development

### Running Without Installing Service

For development/testing:

```cmd
cd agent/src
python owlette_service.py debug
```

**Note:** Requires administrator privileges to access Windows service APIs.

### Building Executable

```cmd
cd agent
build.bat
```

This creates standalone executables in `dist/` using PyInstaller.

### Creating Installer

After building:
- The Inno Setup script `owlette_setup.iss` creates a Windows installer
- Output: `installer/owlette_setup.exe`

---

## Service Management

### Start/Stop/Restart

```cmd
net start OwletteService
net stop OwletteService
net start OwletteService  # Restart
```

### Check Status

```cmd
sc query OwletteService
```

### View Logs

Check `logs/service.log` for service activity:
```cmd
type logs\service.log
```

### Uninstall

```cmd
uninstall.bat
```

Or manually:
```cmd
cd src
python owlette_service.py stop
python owlette_service.py remove
```

---

## Troubleshooting

### Service won't start

1. **Check logs**: `logs/service.log`
2. **Verify Python**: `python --version` should be 3.9+
3. **Check permissions**: Service needs admin rights
4. **Firebase credentials**: If enabled, ensure `config/firebase-credentials.json` exists

### Processes won't launch

1. **Check paths**: Ensure `exe_path` and `file_path` are correct
2. **Check permissions**: Service runs as SYSTEM but launches as logged-in user
3. **Check logs**: Look for errors in `logs/service.log`
4. **Increase `time_to_init`**: Some apps need more time to start

### Firebase not connecting

1. **Check credentials**: Ensure `config/firebase-credentials.json` is valid
2. **Check internet**: Service needs internet for Firebase
3. **Check config**: Ensure `firebase.enabled` is `true`
4. **Check logs**: Look for Firebase errors in `logs/service.log`
5. **Offline mode**: Service will continue with cached config if Firebase unavailable

### "Access Denied" errors

- Service commands require administrator privileges
- Right-click Command Prompt → "Run as administrator"

---

## File Structure

```
agent/
├── src/                       # Python source code
│   ├── owlette_service.py     # Main Windows service
│   ├── firebase_client.py     # Firebase integration
│   ├── shared_utils.py        # Shared utilities
│   ├── owlette_gui.py         # Configuration GUI
│   ├── owlette_tray.py        # System tray icon
│   └── ...
├── config/                    # Configuration (gitignored)
│   ├── config.json            # Main config
│   └── firebase-credentials.json  # Firebase key
├── logs/                      # Log files (gitignored)
│   └── service.log
├── tmp/                       # Temporary files (gitignored)
├── build.bat                  # Build script
├── install.bat                # Installation script
├── uninstall.bat              # Uninstallation script
├── requirements.txt           # Python dependencies
├── config.template.json       # Config template
└── README.md                  # This file
```

---

## Version History

### v2.0.0 (Phase 1)
- ✨ Firebase/Firestore integration
- ✨ Real-time cloud communication
- ✨ Remote command execution
- ✨ System metrics reporting
- ✨ Offline resilience
- 🔧 Repository restructure

### v0.4.2b (Legacy)
- Gmail and Slack notifications
- Process monitoring and auto-restart
- System tray interface
- Configuration GUI

---

## Support

- **Documentation**: See [docs/](../docs/) folder
- **Issues**: https://github.com/theexperiential/Owlette/issues
- **Firebase Setup**: [docs/firebase-setup.md](../docs/firebase-setup.md)

---

## License

See [LICENSE](../LICENSE) in the root directory.
