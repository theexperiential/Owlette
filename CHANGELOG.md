# Changelog

All notable changes to Owlette will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
