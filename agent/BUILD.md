# Building the Owlette Installer

This guide explains how to build the Owlette installer executable for distribution.

## Prerequisites

- **Windows** (required for building Windows installer)
- **Python 3.9+** installed
- **Inno Setup 6** installed at `C:\Program Files (x86)\Inno Setup 6\`
- **Git Bash** or similar Unix-like shell (for build scripts)

## Build Methods

### Method 1: Full Build from Scratch (Recommended for releases)

This method creates a fresh embedded Python environment and builds everything from scratch.

**When to use:**
- Building a release version
- After Python dependency changes
- After major code changes
- First time building

**Command:**
```bash
cd agent
./build_embedded_installer.bat
```

**What it does:**
1. Creates `build/` directory structure
2. Downloads and extracts embedded Python 3.11
3. Installs all Python dependencies from `requirements.txt`
4. Copies agent source code to `build/installer_package/agent/`
5. Copies tools (NSSM) and scripts
6. Compiles Inno Setup installer from `owlette_installer.iss`

**Output:**
- `build/installer_output/Owlette-Installer-v2.0.0.exe` (~50MB)

**Duration:** ~5-10 minutes (depends on internet speed for Python download)

### Method 2: Quick Rebuild (Fast iteration during development)

This method updates only the Python source files and recompiles the Inno Setup installer, skipping the Python environment setup.

**When to use:**
- During active development
- Testing Python code changes
- After editing `.py` files in `src/`
- When you haven't changed dependencies

**Command:**
```bash
cd agent

# Update a single file and rebuild
cp src/configure_site.py build/installer_package/agent/src/configure_site.py
"/c/Program Files (x86)/Inno Setup 6/ISCC.exe" owlette_installer.iss

# Or update multiple files
cp src/auth_manager.py build/installer_package/agent/src/auth_manager.py
cp src/secure_storage.py build/installer_package/agent/src/secure_storage.py
"/c/Program Files (x86)/Inno Setup 6/ISCC.exe" owlette_installer.iss
```

**What it does:**
1. Copies updated Python files to existing build directory
2. Recompiles Inno Setup installer (packages existing files)

**Output:**
- `build/installer_output/Owlette-Installer-v2.0.0.exe` (updated)

**Duration:** ~2 minutes (just Inno Setup compilation)

**Important:**
- Requires a previous full build (Method 1) to exist in `build/`
- Only updates Python source files, not dependencies or Python runtime
- If you get errors, do a full rebuild with Method 1

## Build Output Structure

After a full build, you'll have:

```
agent/
├── build/
│   ├── installer_package/           # Staging directory for installer
│   │   ├── python/                   # Embedded Python 3.11 runtime
│   │   ├── agent/
│   │   │   ├── src/                  # Agent Python source code
│   │   │   ├── config/               # Config templates
│   │   │   └── icons/                # Application icons
│   │   ├── tools/
│   │   │   └── nssm.exe              # Windows service manager
│   │   └── scripts/                  # Installation scripts
│   │
│   └── installer_output/
│       └── Owlette-Installer-v2.0.0.exe  # Final installer executable
│
├── owlette_installer.iss             # Inno Setup script
└── build_embedded_installer.bat      # Full build script
```

## Testing the Installer

### Test with Development Environment

```bash
cd build/installer_output

# Install with dev environment
./Owlette-Installer-v2.0.0.exe /SERVER=dev
```

This will:
1. Open browser to `https://dev.owlette.app/setup`
2. Complete OAuth flow
3. Install service connected to dev environment
4. Machine appears in dev dashboard

### Test with Production Environment

```bash
# Install with production environment
./Owlette-Installer-v2.0.0.exe /SERVER=prod
```

This will:
1. Open browser to `https://owlette.app/setup`
2. Complete OAuth flow
3. Install service connected to production environment
4. Machine appears in production dashboard

### Verify Installation

After installation completes:

```powershell
# Check service status
Get-Service OwletteService

# Check logs (should show successful authentication)
Get-Content C:\Owlette\agent\logs\service.log -Tail 50

# Verify OAuth tokens exist
Test-Path C:\ProgramData\Owlette\.tokens.enc  # Should be True

# Check config has Firebase settings
Get-Content C:\Owlette\agent\config\config.json | Select-String "enabled|project_id|api_base"
```

**Expected results:**
- Service status: Running
- Logs show: "Agent authenticated - OAuth tokens found"
- Logs show: "Initial heartbeat sent - machine is now online"
- No 401 Unauthorized errors
- Machine appears online in web dashboard

## Common Issues

### Issue: "Permission denied" when copying files

**Solution:** Make sure no Owlette service or installer is running:
```bash
taskkill /F /IM Owlette-Installer-v2.0.0.exe
nssm stop OwletteService
```

### Issue: "File is being used by another process" during Inno Setup compilation

**Solution:** Close any running installers or processes locking the output directory:
```bash
taskkill /F /IM ISCC.exe
```

### Issue: Python dependencies missing in installer

**Solution:** Do a full rebuild (Method 1) to reinstall dependencies:
```bash
rm -rf build/
./build_embedded_installer.bat
```

### Issue: Changes not reflected in installed service

**Solution:** Make sure you copied the updated files to `build/installer_package/` before recompiling:
```bash
# Verify file was updated
ls -l build/installer_package/agent/src/your_file.py

# If wrong version, copy again
cp src/your_file.py build/installer_package/agent/src/your_file.py
```

## Version Updates

To update the installer version number:

1. Edit `owlette_installer.iss`:
```pascal
#define MyAppVersion "2.1.0"
```

2. Edit `src/auth_manager.py`:
```python
AGENT_VERSION = "2.1.0"
```

3. Do a full rebuild (Method 1)

4. Output will be named: `Owlette-Installer-v2.1.0.exe`

## CI/CD Integration

For automated builds, use Method 1 in your CI/CD pipeline:

```yaml
# Example GitHub Actions workflow
- name: Build Installer
  run: |
    cd agent
    ./build_embedded_installer.bat

- name: Upload Installer
  uses: actions/upload-artifact@v3
  with:
    name: owlette-installer
    path: agent/build/installer_output/Owlette-Installer-v*.exe
```

## Cleaning Build Artifacts

To start fresh:

```bash
cd agent
rm -rf build/
```

This deletes all build artifacts. Next build will be a full rebuild (Method 1).

## Additional Resources

- [Inno Setup Documentation](https://jrsoftware.org/ishelp/)
- [NSSM Documentation](https://nssm.cc/usage)
- [Installer Usage Guide](INSTALLER-USAGE.md) - For end users
- [OAuth Authentication Flow](../docs/oauth-flow.md) - How authentication works
