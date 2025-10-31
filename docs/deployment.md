# Remote Software Deployment Setup Instructions

This guide explains how to enable the remote software deployment feature in your Owlette agent.

## Overview

The deployment feature allows you to remotely install software (like TouchDesigner) across all your machines from the web portal. The system:
- Downloads installers from URLs
- Executes them with silent installation flags
- Tracks installation progress per machine
- Verifies installation success via exit codes

## Prerequisites

- Owlette agent already installed and running as a Windows service
- Administrator access to the machine
- Internet connectivity for downloading installers

## Setup Steps

### 1. Update Python Dependencies

The deployment feature requires the `requests` library for downloading installers.

**Option A: Automatic (if using virtual environment)**
```bash
cd c:\Users\admin\Documents\Git\Owlette\agent
.venv\Scripts\activate
pip install -r requirements.txt
```

**Option B: Manual installation**
```bash
pip install requests==2.31.0
```

### 2. Verify New Files Exist

Ensure these files are present in your agent directory:
- `agent/src/installer_utils.py` - Download and installation helpers
- `agent/src/owlette_service.py` - Should contain the `install_software` command handler (line ~723)

**Quick verification:**
```bash
cd c:\Users\admin\Documents\Git\Owlette\agent\src
dir installer_utils.py
```

### 3. Restart the Owlette Service

**IMPORTANT:** The service must be restarted to load the new code and dependencies.

**As Administrator**, run:
```bash
cd c:\Users\admin\Documents\Git\Owlette\agent\src
python owlette_service.py stop
python owlette_service.py start
```

Or use Windows Services:
1. Open Services (Win + R → `services.msc`)
2. Find "OwletteService"
3. Right-click → Restart

### 4. Verify Service is Running

Check the service status:
```bash
python owlette_service.py status
```

Or check the logs:
```bash
type c:\Users\admin\Documents\Git\Owlette\agent\logs\service.log
```

Look for a message like:
```
INFO: Owlette service started successfully
```

## Testing the Deployment Feature

### 1. Access the Web Portal

Navigate to your Owlette web portal at: `http://localhost:3000` (or your deployed URL)

### 2. Navigate to Deployments

Click the chevron (▼) next to the Owlette logo → "Deploy Software"

### 3. Create a Test Deployment

**Recommended test installer (small and quick):**
```
Name: Notepad++ Test
Installer URL: https://github.com/notepad-plus-plus/notepad-plus-plus/releases/download/v8.6.2/npp.8.6.2.Installer.exe
Silent Flags: /S
Verify Path: C:\Program Files\Notepad++\notepad++.exe
```

**TouchDesigner deployment:**
```
Name: TouchDesigner 2023
Installer URL: [Your TouchDesigner installer URL]
Silent Flags: /VERYSILENT /DIR="C:\TouchDesigner"
Verify Path: C:\TouchDesigner\bin\TouchDesigner.exe
```

### 4. Monitor Installation

- The deployment page will show real-time status updates
- Check agent logs for detailed installation progress:
  ```bash
  type c:\Users\admin\Documents\Git\Owlette\agent\logs\service.log | findstr install
  ```

## How It Works

### Command Flow

1. **Web Portal** → Creates deployment in Firestore at `sites/{site}/deployments/{id}`
2. **Web Portal** → Sends command to `sites/{site}/machines/{machine}/commands/pending`
3. **Agent** → Detects new command via Firestore listener
4. **Agent** → Downloads installer to `%TEMP%\owlette_installers\`
5. **Agent** → Executes installer with silent flags
6. **Agent** → Reports completion to `sites/{site}/machines/{machine}/commands/completed`
7. **Web Portal** → Updates deployment status in real-time

### Installation Process

The agent performs these steps:

1. **Download** (`installer_utils.download_file`)
   - Streams installer from URL to temp directory
   - Reports download progress (0-100%)

2. **Execute** (`installer_utils.execute_installer`)
   - Runs installer with provided silent flags
   - Waits for installation to complete (10 min timeout)
   - Captures exit code (0 = success)

3. **Verify** (`installer_utils.verify_installation`) - Optional
   - Checks if file exists at verify_path
   - Confirms installation succeeded

4. **Cleanup** (`installer_utils.cleanup_installer`)
   - Removes temporary installer file

## Troubleshooting

### Installation Fails with "Module not found: requests"

**Problem:** The `requests` library isn't installed.

**Solution:**
```bash
cd c:\Users\admin\Documents\Git\Owlette\agent
pip install requests==2.31.0
python owlette_service.py restart
```

### Installation Fails with Exit Code != 0

**Problem:** The installer failed or requires user interaction.

**Common causes:**
- Silent flags are incorrect for this installer
- Installer requires UAC elevation (should work as service runs as SYSTEM)
- Missing dependencies (e.g., .NET Framework, Visual C++ Runtime)
- Insufficient disk space

**Solution:**
- Verify silent flags match the installer type (Inno Setup, NSIS, MSI, etc.)
- Check installer documentation for correct silent flags
- Manually test the installer with the same flags

### Installation Timeout (Exceeds 10 minutes)

**Problem:** Installation is taking too long.

**Solution:**
- This timeout is configurable in `installer_utils.py` line 67
- Large installers may need increased timeout
- Edit timeout value: `timeout=600` → `timeout=1800` (30 min)

### Download Fails

**Problem:** Unable to download installer from URL.

**Common causes:**
- Invalid or inaccessible URL
- Network connectivity issues
- Firewall blocking outbound connections
- URL requires authentication

**Solution:**
- Test URL in browser first
- Ensure agent machine has internet access
- Check firewall rules
- Use direct download links (not browser download pages)

### Installation Succeeds but Software Doesn't Work

**Problem:** Exit code 0 but software not functional.

**Possible causes:**
- Installer requires restart
- Software requires additional configuration
- License activation needed
- Missing runtime dependencies

**Solution:**
- Check if verify_path is correct
- Manually check installation directory
- Review installer log files
- Consider reboot requirement

## Security Considerations

### URL Validation

The system validates URL format but **does not whitelist domains**. Only deploy software from trusted sources.

### Installer Verification

Currently, the system **does not verify checksums** of downloaded installers. Consider:
- Only using HTTPS URLs
- Downloading from official sources
- Pre-testing installers before mass deployment

### Temp File Location

Installers are downloaded to:
```
%TEMP%\owlette_installers\
```

Files are automatically cleaned up after installation, but failed installations may leave files behind.

### Service Permissions

The Owlette service runs as **SYSTEM** which has full administrative privileges. This allows:
- Silent installation without UAC prompts
- Installation to Program Files
- System-wide software deployment

## Advanced Configuration

### Customizing Installation Timeout

Edit `agent/src/installer_utils.py` line 67:
```python
timeout=600  # 10 minutes → Change to desired value in seconds
```

### Adding Checksum Verification

To add checksum verification, modify `download_file()` in `installer_utils.py`:
```python
import hashlib

def verify_checksum(file_path: str, expected_sha256: str) -> bool:
    sha256 = hashlib.sha256()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            sha256.update(chunk)
    return sha256.hexdigest() == expected_sha256
```

### Creating Deployment Templates

The web portal supports saving deployment configurations as templates:
1. Fill out deployment form
2. Check "Save as template"
3. Deploy to machines
4. Template is saved for future use

Access templates via the dropdown in the deployment dialog.

## Support

For issues or questions:
- Check agent logs: `c:\Users\admin\Documents\Git\Owlette\agent\logs\service.log`
- Review Firestore console for command status
- Verify network connectivity and firewall rules
- Test installers manually with the same silent flags

## Command Reference

### Restart Service
```bash
cd c:\Users\admin\Documents\Git\Owlette\agent\src
python owlette_service.py restart
```

### View Logs
```bash
type c:\Users\admin\Documents\Git\Owlette\agent\logs\service.log
```

### Check Service Status
```bash
python owlette_service.py status
```

### Update Dependencies
```bash
cd c:\Users\admin\Documents\Git\Owlette\agent
pip install -r requirements.txt --upgrade
```

## Firestore Structure

Deployments are tracked at:
```
sites/{site_id}/
  deployments/{deployment_id}
    - name: "TouchDesigner 2023"
    - installer_name: "TouchDesigner.exe"
    - installer_url: "https://..."
    - silent_flags: "/VERYSILENT /DIR=..."
    - targets: [{machineId, status, progress}]
    - status: "pending" | "in_progress" | "completed" | "failed"
    - createdAt: timestamp

  installer_templates/{template_id}
    - name: "TouchDesigner Template"
    - installer_name: "TouchDesigner.exe"
    - installer_url: "https://..."
    - silent_flags: "/VERYSILENT /DIR=..."
    - verify_path: "C:\\TouchDesigner\\bin\\..."

  machines/{machine_id}/commands/
    pending: {
      install_xxxxx: {
        type: "install_software"
        installer_url: "https://..."
        installer_name: "TouchDesigner.exe"
        silent_flags: "/VERYSILENT /DIR=..."
        verify_path: "C:\\..."
        deployment_id: "deploy_xxxxx"
        timestamp: 1234567890
        status: "pending"
      }
    }
    completed: {
      install_xxxxx: {
        result: "Installation completed successfully"
        status: "completed"
        completedAt: timestamp
      }
    }
```
