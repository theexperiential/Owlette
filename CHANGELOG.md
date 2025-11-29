# Changelog

All notable changes to Owlette will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.49] - 2025-11-28

### Fixed

#### Agent Service
- **VBS Cleanup Race Condition** - Fixed potential race condition when cleaning up VBScript wrapper files
  - VBS files used for hidden process launches are now cleaned up in a background thread after 10s delay
  - Prevents "file in use" errors when wscript.exe hasn't finished reading the VBS file
  - See [agent/src/owlette_service.py](agent/src/owlette_service.py) `launch_process()`

#### Logging Improvements
- **Reduced Log Noise** - Decreased verbose logging in GUI and system tray components
  - GUI: Changed frequent config change detection logs from INFO to DEBUG level
  - Tray: Removed verbose [STATUS] logging from status checking code
  - Service logs now cleaner with only meaningful operational messages
  - See [agent/src/owlette_gui.py](agent/src/owlette_gui.py) and [agent/src/owlette_tray.py](agent/src/owlette_tray.py)

## [2.0.48] - 2025-11-26

### Fixed

#### Installer
- **Windows Defender False Positive** - Installer now adds Defender exclusion for Owlette directory
  - WinRing0 driver (used by LibreHardwareMonitor for CPU/GPU temps) was flagged as `VulnerableDriver:WinNT/Winring0`
  - Installer automatically runs `Add-MpPreference -ExclusionPath` during installation
  - Exclusion is removed during uninstall via `Remove-MpPreference`
  - CPU and GPU temperature monitoring preserved (no feature loss)
  - This is standard practice for legitimate software with AV false positives

#### Agent GUI
- **Join Site Performance** - Fixed extremely slow "Join Site" operation (2+ minutes → instant)
  - Removed redundant Firebase client initialization from GUI after OAuth completion
  - GUI no longer starts its own Firebase sync - the Windows service handles all syncing
  - See [agent/src/owlette_gui.py](agent/src/owlette_gui.py) `_reinitialize_firebase()`

- **Silent Browser Launch** - Fixed flashing command prompt windows during OAuth flow
  - Changed from `webbrowser.open()` to `os.startfile()` on Windows
  - `webbrowser.open()` spawns visible cmd.exe windows; `os.startfile()` does not
  - See [agent/src/configure_site.py](agent/src/configure_site.py) `open_browser_silent()`

## [2.0.47] - 2025-11-24

### Fixed

#### Agent Service
- **Token Encryption Key Stability** - Fixed token decryption failures after PC restart
  - Changed encryption key derivation from `uuid.getnode()` (MAC address) to Windows `MachineGuid`
  - MAC address can return different values after reboot due to network adapter enumeration changes
  - `MachineGuid` is stable across reboots and accessible to both user accounts and SYSTEM service
  - Resolves "Agent not authenticated - no refresh token found" errors after restart
  - See [agent/src/secure_storage.py](agent/src/secure_storage.py) for implementation

## [2.0.46] - 2025-11-19

### Added

#### Web Dashboard - Admin Panel
- **Email Testing Page** - New admin-only page for testing email notifications
  - Located at `/admin/test-email` in the admin panel
  - Test email delivery and configuration
  - Verify email templates and formatting
  - Debug SMTP and email service settings
  - Admin-only access for security
  - See [docs/admin-system.md](docs/admin-system.md#email-testing) for detailed usage

#### Web Dashboard - UI Improvements
- **Update Panel Layout** - Improved spacing and organization for machine update dialog
  - Increased padding for better readability (p-3 → p-4)
  - Better spacing between elements (gap-3 → gap-4)
  - Reorganized updating status display to prevent overlap
  - Enhanced Clear button styling and alignment
  - More consistent badge sizing across all status indicators

### Changed

#### Documentation
- **Admin System Documentation** - Updated [docs/admin-system.md](docs/admin-system.md) with email testing section
  - Added comprehensive email testing guide
  - Included troubleshooting steps for common email issues
  - Added security considerations and best practices
  - Updated version to 2.0.46

## [2.0.44] - 2025-11-13

### Added

#### Agent GUI
- **Config and Logs Buttons** - Added quick access buttons in footer
  - "Config" button opens config.json in default text editor
  - "Logs" button opens logs folder in Windows Explorer
  - Both buttons positioned to the left of version label in footer
  - Provides easy access to troubleshooting tools without navigating file system

- **Custom Messagebox Implementation** - New `custom_messagebox.py` wrapper
  - Improved text wrapping at 92% width (vs 50% default) for better readability
  - Compact layout with reduced button heights (24px) and narrower buttons
  - Matches Owlette dark slate theme colors automatically
  - Fixes layout issues with default CTkMessagebox component

#### Agent Service
- **Firebase Reconnection Auto-Detection** - Service now detects when Firebase is re-enabled
  - Periodic check every minute for Firebase state changes
  - Automatically restarts Firebase client when re-enabled via GUI
  - Detects site_id changes and reinitializes for new site
  - New `_initialize_or_restart_firebase_client()` method for cleaner reinitialization
  - Eliminates need for manual service restart when rejoining sites

### Changed

#### Agent GUI
- **Unified Site Management Button** - Consolidated Join/Leave Site into single dynamic button
  - Button text and action changes based on connection state
  - "Join Site" when disconnected or disabled
  - "Leave Site" when connected
  - Cleaner, more intuitive interface
  - Window width reduced from 290px to 270px for tighter collapsed state

- **Improved Status Feedback** - Better UX during join/leave operations
  - Status updates immediately before blocking operations ("Connecting...", "Disabling...")
  - GUI force-updates before service restart to show progress
  - Prevents user confusion during operations that may take several seconds

- **Console Window Suppression** - Added `CREATE_NO_WINDOW` flag to subprocess calls
  - Prevents black console windows from flashing during service start/stop
  - Affects NSSM commands for service management
  - Cleaner user experience without technical popups

#### Agent Service
- **Increased Deployment Timeout** - Extended from 20 to 40 minutes (1200→2400 seconds)
  - Accommodates larger installer downloads on slower connections
  - Prevents premature timeout failures for complex installations
  - More reliable remote deployment success rate

#### Registry Utils
- **Force Close Applications on Uninstall** - Added `/FORCECLOSEAPPLICATIONS` flag
  - Inno Setup uninstalls now automatically close running applications
  - Prevents "application is running" errors during uninstall
  - Reduces manual intervention needed for successful uninstalls

### Fixed

#### Agent Service
- **Firebase Client Reference Errors** - Fixed incorrect global variable usage
  - Changed `firebase_client` to `self.firebase_client` in uninstall handler
  - Fixed software inventory sync calls after uninstall operations
  - Prevents AttributeError when triggering inventory refresh

- **Firebase Client Not Restarting** - Fixed issue where Firebase wouldn't reconnect after re-enabling
  - Added detection in config update callback for Firebase enable/disable transitions
  - Service now automatically reinitializes Firebase client when site is rejoined
  - Handles both local config changes (GUI) and Firestore config updates
  - Resolves issue where agents stayed offline after rejoining sites

## [2.0.29] - 2025-11-12

### Fixed

#### Configuration System
- **Config Version for New Installs** - Fixed new installations getting incorrect config version
  - Changed hardcoded `"version": "2.0.3"` to use `CONFIG_VERSION` constant in configure_site.py
  - Added `"environment": "production"` to default config template in generate_config_file()
  - New installs now correctly get `"version": "1.5.0"` with proper environment setting
  - Prevents version mismatch that blocked auto-upgrade system

## [2.0.28] - 2025-11-12

### Added

#### Configuration System
- **Environment Configuration** - New `environment` setting in config.json (v1.5.0)
  - Defaults to `"production"` (owlette.app)
  - Can be set to `"development"` (dev.owlette.app) for testing
  - Environment setting determines which URL "Join Site" opens
  - Auto-saved during OAuth callback to confirm environment
  - New helper functions: `get_environment()`, `get_api_base_url()`, `get_setup_url()`, `get_project_id()`

### Fixed

#### Agent Service
- **Tray Icon Launch Failure** - Fixed "Windows cannot find 'pythonw'" error on agent restart
  - Added `get_python_exe_path()` helper to locate bundled Python interpreter at `C:\Owlette\python\pythonw.exe`
  - Updated `launch_python_script_as_user()` to use full Python path instead of assuming PATH
  - Resolves issue where system tray icon wouldn't start after service restart

#### Agent GUI
- **Incorrect Server URL** - Fixed "Join Site" defaulting to dev.owlette.app instead of production
  - Now correctly defaults to `https://owlette.app/setup` for production
  - Uses new environment-based helper functions for URL determination
  - Honors `environment` setting in config.json

#### OAuth Configuration
- **Port Conflict on Retry** - Fixed "Port 8765 already in use" error when retrying site join
  - Enabled `allow_reuse_address` on OAuth callback server
  - Prevents WinError 10048 when configuration is attempted multiple times
  - Server port now releases immediately after use

## [2.0.27] - 2025-11-11

### Fixed

#### Agent Service
- **Software Inventory Sync Error** - Fixed `NameError: name 'firebase_client' is not defined`
  - Changed `firebase_client` to `self.firebase_client` in post-installation inventory sync
  - Resolves warning: "Failed to sync software inventory after installation"

#### Web Dashboard
- **Real-Time Deployment Status Updates** - Fixed deployment status staying on "downloading" until manual refresh
  - Modified `processedCommands` logic to allow intermediate state updates
  - Commands only marked as "processed" when reaching terminal states (completed/failed/cancelled)
  - Status now transitions in real-time: downloading → installing → completed
  - Users no longer need to refresh page to see deployment completion

## [2.0.26] - 2025-11-11

### Added

#### Agent Enhancements
- **Process Launch via Task Scheduler** - Complete rewrite of process launching using Windows Task Scheduler (schtasks)
  - **Service Restart Resilience**: Processes now survive service restarts (no longer killed by NSSM job objects)
  - **Implementation**: Creates one-time scheduled task, runs it, finds PID, then deletes task
  - **User Context**: Launches processes under logged-in user account (not SYSTEM)
  - **Working Directory Support**: Respects process working directory settings
  - **Auto Cleanup**: Temporary tasks are automatically removed after launch
- **Enhanced Event Logging** - Improved visibility and reliability of event logging to Firestore
  - **Agent Lifecycle Events**: Logs agent_started and agent_stopped events with version info
  - **Process Crash Detection**: Automatically logs process crashes (distinguishes from manual kills)
  - **GUI Kill Tracking**: Manual process terminations from GUI are logged to Firestore
  - **Better Log Visibility**: Event logs now use INFO level instead of DEBUG for production monitoring
  - **UUID Document IDs**: Uses explicit UUIDs for Firestore log documents (REST client compatibility)

### Changed

#### Agent Service
- **Event Log Messages** - Improved event log format with clearer action indicators (e.g., "[EVENT LOGGED]", "[EVENT LOG FAILED]")
- **Process Kill Events** - Dashboard process kills now log as "process_killed" instead of "command_executed" for better clarity

### Fixed

#### Agent Service
- **Agent Stopped Logging** - Fixed regression where agent_stopped events were not logged during service restarts
  - **Root cause**: NSSM kills the process within ~4 seconds of receiving stop signal, preventing finally blocks from executing
  - **Solution**: Implemented restart flag mechanism for graceful shutdown logging
  - **How it works**:
    1. Tray menu "Restart" writes `restart.flag` file
    2. Tray waits 2 seconds for service to detect flag
    3. Service main loop checks for flag on every iteration
    4. Service logs agent_stopped event to Firestore when flag detected
    5. Tray proceeds with restart commands after delay
  - **Benefits**: Reliable event logging without race conditions or process timing dependencies
  - **Backward compatible**: Existing SvcStop() logging still works for normal Windows service shutdown
- **Process Crash False Positives** - Crash events no longer logged for manually killed processes
  - Checks process status before logging crash event
  - Prevents duplicate/misleading logs in event viewer

## [2.0.15] - 2025-11-11

### Added

#### Web Dashboard Enhancements
- **Event Logs Page** - New dedicated logs page for monitoring process events and system activities
  - Real-time event tracking: process starts, kills, crashes, and command executions
  - Compact list view with color-coded severity badges (info: blue, warning: yellow, error: red)
  - Advanced filtering by action type, machine, and log level
  - Pagination support (50 logs per page) with next/previous navigation
  - Accessible via navigation menu dropdown
  - Responsive design matching dashboard and deployments page layouts

#### Agent Enhancements
- **Hidden Process Launch** - Launch console applications without visible windows
  - **Hidden mode for console apps**: Uses VBScript wrapper with window style 0 for truly invisible launches
  - **Supported applications**: Node.js servers, Python scripts, Java applications, and other console-based processes
  - **Normal mode**: Standard visible window launch for all application types
  - **VBScript implementation**: Creates temporary VBScript files that launch processes with `WshShell.Run(..., 0, False)`
  - **Backward compatible**: Legacy "Show"/"Hide" settings automatically mapped to Normal/Hidden
  - **Limitation**: Hidden mode works reliably for console applications only; GUI applications will still show windows
- **Event Logging to Firestore** - Automatic logging of critical process events to Firestore
  - Process start events (successful and failed)
  - Process termination events (kills and crashes)
  - Command execution tracking
  - Non-blocking implementation to prevent service interruption
  - Detailed event metadata (timestamp, machine ID, process name, details)

#### Firestore Security Rules
- **Logs Collection Rules** - Secure read/write permissions for event logs
  - Users can read logs for their assigned sites
  - Agents can create logs for their machines
  - Users can delete old logs for cleanup

### Changed

#### Web Dashboard
- **Consistent Page Layouts** - Logs page follows same layout patterns as Dashboard and Deployments pages
- **Simplified Visibility Options** - Reduced visibility dropdown to Normal and Hidden only (removed Minimized/Maximized which were not reliably supported)

## [Unreleased] - 2025-02-01

### Added

#### Agent Enhancements
- **Service Lifecycle Logging** - Added call stack tracing to service stop events, service start/stop banners, and main loop markers for easier restart tracking
- **Advanced Logging System** - Configurable log levels (DEBUG, INFO, WARNING, ERROR, CRITICAL) via config
- **Firebase Log Shipping** - Centralized log monitoring by shipping errors to Firestore (optional)
- **Automatic Log Cleanup** - Delete log files older than configurable days (default: 90 days)
- **Enhanced Log Rotation** - Increased to 10 MB per file with 5 backups (60 MB total retention)
- **CPU Model Detection** - Display CPU model name (e.g., "Intel Core i9-9900X") alongside usage percentage
- **Universal White Tray Icons** - Redesigned HAL 9000-style icons with pure white ring, grey background, smaller center dot for better visibility in all themes
- **Status Monitoring** - Background thread monitors service and Firebase health every 60 seconds
- **Status Notifications** - Windows toast notifications when service state changes
- **Improved Tray Menu** - Shows live service and Firebase connection status with cleaner labels
- **Attribution Footer** - "Made with ♥ in California by TEC" footer in GUI with clickable link
- **Emergency Offline Handler** - atexit handler ensures machines marked offline even during abrupt shutdowns

#### Web Dashboard Enhancements
- **User Profile Management** - Collect and display first/last name during registration
- **User Avatars** - Circular avatar with initials in dashboard header
- **Account Settings Dialog** - Update profile information (name) from dashboard
- **Personalized Welcome** - "Welcome back, [FirstName]!" greeting in dashboard
- **CPU Model Display** - Show CPU model name in machine metrics (card and table views)
- **Redesigned Auth Pages** - Login and register pages feature Owlette logo and "Always Watching" tagline
- **Custom Scrollbars** - Styled scrollbars matching dark theme (Firefox + Webkit browsers)
- **Attribution Footer** - Global footer on all pages linking to https://tec.design
- **Improved Dark Theme** - Enhanced consistency across all components
- **Updated Metadata** - "Always Watching" branding in page titles and descriptions

### Changed

#### Agent
- **Config Version** - Bumped to v1.4.0 for logging configuration
- **Service Restart Timing** - Increased wait times (5s after stop, 3s after start) to prevent race conditions
- **Default Log Level** - Now configurable via `logging.level` in config.json (defaults to INFO)
- **Firebase Heartbeat** - Disabled separate 30s heartbeat thread (now included in 60s metrics) for 33% fewer Firestore writes
- **Atomic Metrics Upload** - Combined online/heartbeat with metrics data to prevent "undefined" flicker in web dashboard
- **Config Backup Restoration** - Installer now restores config.json on upgrades to preserve processes and "Leave Site" state
- **Icon Directory Structure** - Simplified from light/dark theme directories to single unified icons/ folder

#### Web
- **Page Layouts** - Added bottom padding to accommodate fixed footer
- **Auth Flow** - Google OAuth and email registration now collect display names
- **User Menu** - Replaced simple sign-out button with dropdown menu showing avatar and profile options

### Fixed

#### Agent
- **Self-Update AttributeError** - Fixed `self.stop()` → `self.SvcStop()` in self-update shutdown mechanism preventing AttributeError exceptions
- **Tray Icon Visibility** - Fixed icon not updating when service status changes
- **Service Status Detection** - Improved reliability of service running checks
- **"Leave Site" Workflow** - Fixed machine document recreation by stopping service BEFORE Firestore deletion
- **Config Race Conditions** - Eliminated TOCTOU issues with get_system_metrics_with_config() passing config directly
- **Config Feedback Loops** - Added MD5 hash tracking to prevent processing self-originated config changes
- **Service Stop Reliability** - Tray exit action now uses NSSM with subprocess instead of ShellExecuteW
- **GUI Icon Path** - Corrected icon path from ../../icons to ../icons for new directory structure
- **Metrics Snapshot Flicker** - Fixed brief "metrics: undefined" in web app with atomic Firestore updates

#### Web
- **Footer Overlap** - Fixed content being hidden behind footer on long pages
- **Avatar Display** - Proper fallback initials for users without display names

### Legal
- **GPL Section 7 Terms** - Added attribution requirements to LICENSE per GPL v3 Section 7(b)

---

## [2.0.0] - 2025-01-31

### 🎉 Major Release - Cloud-Connected Architecture

Version 2.0.0 represents a complete architectural transformation of Owlette from a standalone Windows process manager to a modern, cloud-connected system with remote management capabilities.

### Added

#### Web Dashboard
- **Next.js 16 Web Application** - Modern web dashboard for remote monitoring and control
- **Real-Time Monitoring** - Live machine status, metrics, and process health
- **Multi-Site Management** - Organize and manage machines across multiple locations
- **Firebase Authentication** - Email/Password and Google OAuth support
- **Responsive Design** - Works on desktop, tablet, and mobile devices
- **Dark Mode UI** - Modern Tailwind CSS-based interface matching agent GUI

#### Cloud Integration
- **Firebase/Firestore Backend** - Real-time bidirectional synchronization
- **Offline Mode** - Agent continues functioning when disconnected
- **Instant Config Sync** - Changes sync between GUI, service, and web in ~1-2 seconds
- **Live Metrics Reporting** - CPU, memory, disk, and GPU metrics uploaded every 60 seconds
- **Cloud Command Queue** - Remote control via Firebase commands

#### Remote Deployment
- **Silent Software Installation** - Deploy applications across multiple machines remotely
- **Deployment Templates** - Save and reuse installer configurations
- **Multi-Machine Targeting** - Install on one or many machines simultaneously
- **Real-Time Progress Tracking** - Watch installations as they happen
- **Deployment Cancellation** - Stop in-progress installations remotely
- **Installation Verification** - Confirm successful deployments with path verification

#### Process Management Enhancements
- **PID Recovery** - Reconnect to existing processes after service restart (no duplicates)
- **Web-Based Configuration** - Edit process settings from dashboard
- **Remote Process Control** - Start/stop processes from anywhere
- **Instant Autolaunch Toggle** - Enable/disable processes with immediate sync

#### Agent Improvements
- **Improved Responsiveness** - Background threading for Firestore operations
- **Better Validation** - Enhanced field validation with user-friendly error handling
- **Auto-Refresh Prevention** - Smart dirty checking prevents overwriting user input
- **Restart Menu** - Quick service restart from system tray
- **Enhanced Logging** - Production-ready logging with reduced verbosity

### Changed

#### Architecture
- **Monorepo Structure** - Unified repository with `agent/` and `web/` directories
- **Firebase as Primary Backend** - Gmail/Slack marked as legacy features
- **Modern Tech Stack** - Next.js 16, React 19, TypeScript, Tailwind CSS
- **Configuration Schema** - Updated to v1.3.0 with Firebase settings

#### Installation
- **Simplified Setup** - `install.bat` handles Python installation and Firebase prompts
- **Web Dashboard Setup** - New installation steps for Next.js dashboard
- **Firebase-First** - Firebase now required for full functionality

#### Documentation
- **Complete README Overhaul** - Updated to reflect v2.0 architecture
- **New Guides Added** - Firebase setup, deployment, architecture decisions
- **Legacy Features Documented** - Gmail/Slack moved to optional section

### Deprecated

- **Gmail Notifications** - Marked as legacy; web dashboard is preferred method
- **Slack Notifications** - Marked as legacy; web dashboard is preferred method

### Fixed

- **Config Overwriting** - Fixed race condition where Firestore updates overwrote local changes
- **GUI Field Reversion** - Fixed issue where typed values reverted before save
- **Command Window Flashing** - Removed metrics upload that caused visible CMD windows
- **Duplicate Process Launch** - PID recovery prevents launching duplicates on restart
- **Validation Early Returns** - Fixed validation preventing saves on Enter/FocusOut

### Security

- **Credentials Management** - Firebase credentials properly gitignored
- **Config Template** - Sensitive data removed from config.json, template provided
- **Input Validation** - Enhanced validation for deployment URLs and paths

---

## [0.5.0] - 2024-XX-XX (Pre-v2.0 Development)

### Added
- Initial Firebase integration experiments
- Early web portal prototypes
- Config version tracking

---

## [0.4.2b] - 2024-XX-XX (Legacy)

### Legacy Version - Standalone Architecture

The original Owlette was a standalone Windows service with local configuration and optional email/Slack notifications.

#### Features
- Windows service process monitoring
- Auto-restart on crash/freeze
- System tray icon and GUI configuration
- Gmail API notifications
- Slack API notifications
- Local JSON configuration
- Process priority and visibility control
- Configurable restart attempts

---

## Migration Guide: v0.4.2b → v2.0.0

### Breaking Changes

1. **Firebase Required** - v2.0 requires Firebase/Firestore setup (was optional in v0.4.2b)
2. **Configuration Changes** - New config schema with Firebase settings
3. **Web Dashboard** - New component requiring separate installation
4. **Python Version** - Minimum Python 3.9 (was 3.7)

### Migration Steps

1. **Backup existing configuration:**
   ```bash
   copy agent\config\config.json agent\config\config.backup.json
   ```

2. **Set up Firebase:**
   - Follow [docs/firebase-setup.md](docs/firebase-setup.md)
   - Create Firebase project
   - Download credentials to `agent/config/firebase-credentials.json`

3. **Update agent:**
   ```bash
   cd agent
   git pull
   install.bat  # Run as administrator
   ```

4. **Install web dashboard (optional but recommended):**
   ```bash
   cd web
   npm install
   cp .env.example .env.local
   # Edit .env.local with Firebase config
   npm run dev
   ```

5. **Configure site ID:**
   - Edit `agent/config/config.json`
   - Set `firebase.site_id` to your preferred ID (e.g., "default_site")

6. **Test functionality:**
   - Agent should appear in web dashboard
   - Process changes should sync between GUI and web
   - Metrics should update every 60 seconds

### Feature Mapping

| v0.4.2b Feature | v2.0.0 Equivalent |
|-----------------|-------------------|
| Gmail notifications | Web dashboard alerts |
| Slack notifications | Web dashboard alerts |
| Local GUI only | GUI + Web dashboard |
| Manual configuration | GUI or Web-based config |
| Single machine focus | Multi-machine management |
| N/A | Remote deployment |
| N/A | Multi-site organization |

---

## Unreleased

### Planned Features
- Email/Slack integration via web dashboard (Phase 2)
- Advanced analytics and reporting
- Process performance graphs
- Automated health checks
- Custom alerting rules
- Role-based access control
- Mobile app (iOS/Android)

---

[2.0.0]: https://github.com/theexperiential/Owlette/releases/tag/v2.0.0
[0.5.0]: https://github.com/theexperiential/Owlette/releases/tag/v0.5.0
[0.4.2b]: https://github.com/theexperiential/Owlette/releases/tag/v0.4.2b
