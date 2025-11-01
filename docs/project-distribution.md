# Project File Distribution Setup Instructions

This guide explains how to use the project file distribution feature to sync project files (ZIPs, TouchDesigner .toe files, media assets) across all your machines.

## Overview

The project distribution feature allows you to:
- Distribute ZIP archives containing project files across multiple machines
- Automatically extract files to a specified location
- Verify critical files exist after extraction
- Track distribution progress in real-time per machine
- Use **zero Owlette infrastructure** by hosting files yourself

**Cost Structure:**
- Owlette infrastructure: **~$0.0001 per distribution** (Firestore operations only)
- File hosting: User's choice (Dropbox, Google Drive, Backblaze, etc.)
- No bandwidth costs for Owlette - machines download directly from your URL

## Prerequisites

- Owlette agent already installed and running as a Windows service
- Administrator access to the machine
- Internet connectivity for downloading project files
- File hosting service (Dropbox, Google Drive, personal server, etc.)

## How It Works

### Architecture

```
User's File Host         Owlette Cloud          Agent Machines
(Dropbox/Drive/etc.)     (Firestore)           (Windows)
─────────────────────────────────────────────────────────────

1. Upload project.zip
   to Dropbox

2. Get download URL

3. Create distribution ────────>
   in web dashboard            Store metadata
                               (no file upload!)

4. Send commands to ────────>
   target machines             Commands queued

5.                                              Detect command
                                                <────────────

6.                                              Download ZIP
   <─────────────────────────                  from Dropbox URL
   Direct download
   (not through Owlette!)                       Report progress:
                                                downloading 45%
                                                ────────────>

7.                                              Extract ZIP to
                                                ~/Documents/
                                                OwletteProjects

                                                Report progress:
                                                extracting 80%
                                                ────────────>

8.                                              Verify files
                                                exist

                                                Report complete
                                                ────────────>

9. View status in
   dashboard                   <────────────
                               Real-time updates
```

### Command Flow

1. **Web Portal** → Creates distribution in Firestore at `sites/{site}/project_distributions/{id}`
2. **Web Portal** → Sends command to `sites/{site}/machines/{machine}/commands/pending`
3. **Agent** → Detects new command via Firestore listener
4. **Agent** → Downloads ZIP from user's URL to `%TEMP%\owlette_projects\`
5. **Agent** → Extracts ZIP to specified path (or `~/Documents/OwletteProjects`)
6. **Agent** → Optionally verifies specific files exist
7. **Agent** → Reports completion to `sites/{site}/machines/{machine}/commands/completed`
8. **Web Portal** → Updates distribution status in real-time

## Setup Steps

### 1. Verify Agent Files

Ensure these files exist in your agent directory:
- `agent/src/project_utils.py` - Download, extraction, and verification utilities
- `agent/src/owlette_service.py` - Should contain `distribute_project` command handler

**Quick verification:**
```bash
cd c:\Users\admin\Documents\Git\Owlette\agent\src
dir project_utils.py
```

### 2. Restart the Owlette Service

**IMPORTANT:** The service must be restarted to load the new code.

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

### 3. Verify Service is Running

Check the service logs:
```bash
type c:\Users\admin\Documents\Git\Owlette\agent\logs\service.log
```

Look for:
```
INFO: Owlette service started successfully
```

## Using Project Distribution

### 1. Prepare Your Project

**Create a ZIP archive:**
```
MyProject.zip
├── MyProject.toe          # TouchDesigner project
├── Assets/
│   ├── video1.mp4
│   ├── texture.png
│   └── config.json
└── Media/
    └── audio.wav
```

**Upload to hosting service:**
- **Dropbox**: Upload → Share → Copy link → Change `?dl=0` to `?dl=1` for direct download
- **Google Drive**: Upload → Get link → Use tools like https://sites.google.com/site/gdocs2direct/
- **Backblaze B2**: Upload → Make public → Copy URL
- **Your own server**: Any direct download URL

### 2. Access the Web Portal

Navigate to: `http://localhost:3000` (or your deployed URL)

### 3. Navigate to Project Distribution

Click the chevron (▼) next to the Owlette logo → **"Distribute Projects"**

### 4. Create a Distribution

Click **"New Distribution"** and fill out the form:

**Required Fields:**
- **Distribution Name**: Descriptive name (e.g., "Summer Show 2024")
- **Project URL**: Direct download link to your ZIP file

**Optional Fields:**
- **Extract To**: Custom extraction path
  - Leave empty for default: `~/Documents/OwletteProjects`
  - Or specify: `C:\TouchDesigner\Projects`
- **Verify Critical Files**: Comma-separated list of files to verify after extraction
  - Example: `MyProject.toe, Assets/video1.mp4`
  - Leave empty to skip verification

**Example Configuration:**
```
Distribution Name: Summer Show 2024
Project URL: https://www.dropbox.com/s/abc123/SummerShow.zip?dl=1
Extract To: C:\TouchDesigner\Projects
Verify Critical Files: SummerShow.toe, Assets/
```

### 5. Select Target Machines

- Check machines to distribute to
- Use "Online Only" for currently connected machines
- Use "Select All" to target all machines

### 6. Optional: Save as Template

- Check "Save as template" to reuse this configuration
- Templates appear in the dropdown for future distributions

### 7. Distribute

Click **"Distribute to N Machines"** to start the distribution.

### 8. Monitor Progress

The dashboard shows real-time status for each machine:
- **Downloading** (with progress %)
- **Extracting** (with progress %)
- **Completed** or **Failed**

## Distribution Process Details

### Download Phase

The agent downloads the ZIP file with progress tracking:

```python
# Downloads to: %TEMP%\owlette_projects\MyProject.zip
# Progress reported: downloading 0% → 100%
# Uses streaming to handle large files (multi-GB)
```

**Temp location:** `C:\Users\<User>\AppData\Local\Temp\owlette_projects\`

### Extraction Phase

The agent extracts files with progress tracking:

```python
# Extracts to specified path or default
# Default: ~/Documents/OwletteProjects
# Progress reported: extracting 0% → 100%
# Preserves ZIP directory structure
```

**Example extraction:**
```
Input ZIP:
  MyProject/
    project.toe
    Assets/
      video.mp4

Extracted to: C:\Users\Admin\Documents\OwletteProjects\
  MyProject/
    project.toe
    Assets/
      video.mp4
```

### Verification Phase (Optional)

If verify files are specified, the agent checks they exist:

```python
# Verifies each file/folder in comma-separated list
# Reports: "Verified 2 file(s)" or "Warning: 1 file(s) missing"
```

**Verification paths are relative to extract location:**
- Verify: `MyProject.toe` → Checks: `<extract_path>/MyProject.toe`
- Verify: `Assets/` → Checks: `<extract_path>/Assets/` directory exists

### Cleanup Phase

The agent automatically removes the temporary ZIP file:

```python
# Deletes: %TEMP%\owlette_projects\MyProject.zip
# Keeps: Extracted files at destination
```

## Examples

### Example 1: TouchDesigner Project

**Scenario:** Distribute TouchDesigner project with media assets to 10 machines.

**Setup:**
1. Create ZIP:
   ```
   ArtInstallation.zip (2.5 GB)
   ├── ArtInstallation.toe
   ├── Assets/
   │   ├── videos/ (1.8 GB)
   │   └── textures/ (500 MB)
   └── config.json
   ```

2. Upload to Dropbox and get direct download URL

3. Create distribution:
   ```
   Name: Art Installation - January 2025
   URL: https://dropbox.com/s/xyz/ArtInstallation.zip?dl=1
   Extract To: C:\TouchDesigner\Projects
   Verify: ArtInstallation.toe, Assets/videos/, config.json
   ```

4. Select all online machines → Distribute

5. **Result**: All machines download 2.5 GB from Dropbox, extract to `C:\TouchDesigner\Projects\ArtInstallation\`, verify files exist

**Cost**: ~$0.001 for Firestore operations (1 distribution × 10 machines)

### Example 2: Digital Signage Content Update

**Scenario:** Update content files for digital signage displays.

**Setup:**
1. Create ZIP:
   ```
   SignageContent_Feb2025.zip (500 MB)
   ├── videos/
   │   ├── promo1.mp4
   │   └── promo2.mp4
   └── images/
       └── background.png
   ```

2. Upload to Google Drive and get direct download link

3. Create distribution:
   ```
   Name: February Signage Content
   URL: https://drive.google.com/uc?export=download&id=abc123
   Extract To: (leave empty for default)
   Verify: videos/promo1.mp4, videos/promo2.mp4
   ```

4. Save as template for monthly updates

5. Select signage machines → Distribute

**Result**: Machines extract to `~/Documents/OwletteProjects/SignageContent_Feb2025/`

### Example 3: Configuration Sync

**Scenario:** Sync updated configuration files across machines.

**Setup:**
1. Create ZIP:
   ```
   configs.zip (100 KB)
   ├── app.config
   ├── settings.json
   └── rules.xml
   ```

2. Upload to your web server: `https://yourserver.com/configs.zip`

3. Create distribution:
   ```
   Name: Config Update v1.2.3
   URL: https://yourserver.com/configs.zip
   Extract To: C:\MyApp\config
   Verify: app.config, settings.json
   ```

**Result**: Small, fast distribution for configuration updates

## File Hosting Options

### Dropbox

**Pros:**
- Free tier: 2GB storage
- Easy sharing
- Reliable CDN

**How to get direct download link:**
1. Upload file to Dropbox
2. Right-click → Share → Copy link
3. Change `?dl=0` to `?dl=1` in URL
4. Example: `https://www.dropbox.com/s/abc123/project.zip?dl=1`

**Cost:** Free for <2GB, $11.99/month for 2TB

### Google Drive

**Pros:**
- Free tier: 15GB storage
- Google account required
- Large file support

**How to get direct download link:**
1. Upload file to Drive
2. Get shareable link
3. Use converter tool or format: `https://drive.google.com/uc?export=download&id=FILE_ID`

**Cost:** Free for <15GB, $1.99/month for 100GB

### Backblaze B2

**Pros:**
- **Cheapest option**: $0.005/GB storage
- **Free egress** for first 3× your storage
- S3-compatible API
- Best for large files

**How to use:**
1. Create B2 bucket
2. Upload file
3. Make bucket public or use signed URL
4. Use bucket URL: `https://f002.backblazeb2.com/file/bucket-name/file.zip`

**Cost:** $0.50/month for 100GB storage + free egress

### Your Own Server

**Pros:**
- Full control
- No third-party dependencies
- Can use existing infrastructure

**Requirements:**
- Web server (Apache, nginx, etc.)
- Direct download URLs (not HTML pages)

**Example:** `https://myserver.com/projects/summer2024.zip`

## Cost Comparison

**100GB TouchDesigner project distributed to 10 machines:**

| Hosting Option | Storage Cost | Bandwidth Cost | Total/Month |
|----------------|--------------|----------------|-------------|
| **Dropbox** | $11.99 (2TB) | Included | **$11.99** |
| **Google Drive** | $9.99 (2TB) | Included | **$9.99** |
| **Backblaze B2** | $0.50 (100GB) | Free (3× rule) | **$0.50** ⭐ |
| **Your Server** | Variable | Variable | Variable |

**Owlette cost (all options):** ~$0.001 per distribution (Firestore only)

## Troubleshooting

### Distribution Fails with "Download failed"

**Problem:** Unable to download project file from URL.

**Common causes:**
- Invalid or broken URL
- URL points to HTML page instead of direct download
- Network connectivity issues
- Firewall blocking outbound connections
- File host is down

**Solution:**
1. Test URL in browser - should download file directly
2. Verify machines have internet access
3. Check firewall rules allow outbound HTTPS
4. For Dropbox: Ensure `?dl=1` at end of URL
5. For Google Drive: Use direct download format

### Extraction Fails

**Problem:** ZIP downloaded but extraction failed.

**Common causes:**
- Corrupted ZIP file
- Invalid ZIP format
- Insufficient disk space
- Permission denied on extract path

**Solution:**
1. Verify ZIP file is valid (test locally)
2. Check available disk space
3. Verify extract path permissions
4. Try default extract path (leave field empty)

### Files Missing After Extraction

**Problem:** Extraction succeeded but files not found.

**Common causes:**
- Incorrect verify file paths
- ZIP has unexpected directory structure
- Case sensitivity in file names

**Solution:**
1. Check actual ZIP structure
2. Verify paths are relative to extract location
3. Account for root folder in ZIP:
   - ZIP contains `MyProject/project.toe`
   - Verify: `MyProject/project.toe` (not just `project.toe`)

### Download Too Slow

**Problem:** Large file taking too long to download.

**Causes:**
- Slow internet connection
- File host bandwidth limits
- Large file size (multi-GB)

**Solution:**
- Use CDN-backed hosting (Dropbox, Drive)
- Consider splitting into multiple smaller ZIPs
- Schedule distributions during off-peak hours
- Upgrade file hosting plan for better bandwidth

### Verify Files Reports Missing

**Problem:** Distribution completes but verification fails.

**Solution:**
1. Check extracted files manually on one machine
2. Verify the file paths in distribution match actual structure
3. Ensure paths are relative (not absolute)
4. Check for typos in verify files field

## Security Considerations

### URL Validation

The system validates URL format but **does not whitelist domains**. Only distribute projects from trusted sources.

### ZIP File Safety

Currently, the system **does not scan ZIP contents** for malware. Best practices:
- Only use ZIPs from trusted sources
- Use HTTPS URLs when possible
- Pre-test ZIPs before mass distribution

### Temp File Location

Project ZIPs are downloaded to:
```
%TEMP%\owlette_projects\
```

Files are automatically cleaned up after extraction, but failed distributions may leave files behind.

### Extract Path Permissions

The Owlette service runs as **SYSTEM** which allows:
- Writing to any directory
- Overwriting existing files
- Full administrative access

**Be careful with extract paths** - service has full write permissions.

## Advanced Configuration

### Customizing Default Extract Path

Edit `agent/src/project_utils.py`:

```python
def get_default_project_directory() -> str:
    """Get the default directory for project extraction."""
    # Change this to your preferred default path
    user_home = os.path.expanduser("~")
    default_dir = os.path.join(user_home, "Documents", "OwletteProjects")
    os.makedirs(default_dir, exist_ok=True)
    return default_dir
```

### Creating Distribution Templates

Templates save configuration for reuse:

1. Fill out distribution form
2. Check "Save as template"
3. Distribute to machines
4. Template saved in Firestore

**Load template:**
1. Open distribution dialog
2. Select template from dropdown
3. Optionally edit fields
4. Distribute

**Edit template:**
1. Load template
2. Click edit icon
3. Modify fields
4. Distribute to save changes

**Delete template:**
1. Load template
2. Click delete icon
3. Confirm deletion

### Programmatic Distribution

You can create distributions programmatically via Firestore:

```typescript
import { setDoc, doc } from 'firebase/firestore';

const distributionId = `project-dist-${Date.now()}`;
await setDoc(doc(db, 'sites', siteId, 'project_distributions', distributionId), {
  name: 'My Distribution',
  project_name: 'MyProject.zip',  // Auto-extracted from URL
  project_url: 'https://example.com/MyProject.zip',
  extract_path: 'C:\\Projects',  // Optional
  verify_files: ['project.toe', 'Assets/'],  // Optional
  targets: [{
    machineId: 'MACHINE-001',
    status: 'pending'
  }],
  createdAt: Date.now(),
  status: 'pending'
});

// Send command to machine
await setDoc(doc(db, 'sites', siteId, 'machines', 'MACHINE-001', 'commands', 'pending'), {
  [`distribute_${distributionId}_${Date.now()}`]: {
    type: 'distribute_project',
    project_url: 'https://example.com/MyProject.zip',
    project_name: 'MyProject.zip',
    extract_path: 'C:\\Projects',
    verify_files: ['project.toe', 'Assets/'],
    distribution_id: distributionId,
    timestamp: Date.now(),
    status: 'pending'
  }
}, { merge: true });
```

## Firestore Structure

Project distributions are tracked at:

```
sites/{site_id}/
  project_distributions/{distribution_id}
    - name: "Summer Show 2024"
    - project_name: "SummerShow.zip"  (auto-extracted from URL)
    - project_url: "https://dropbox.com/..."
    - extract_path: "C:\\TouchDesigner\\Projects" (optional)
    - verify_files: ["project.toe", "Assets/"]  (optional)
    - targets: [{machineId, status, progress}]
    - status: "pending" | "in_progress" | "completed" | "failed" | "partial"
    - createdAt: timestamp

  project_templates/{template_id}
    - name: "TD Project Template"
    - project_name: "template.zip"
    - project_url: "https://..."
    - extract_path: "C:\\..."
    - verify_files: ["project.toe"]

  machines/{machine_id}/commands/
    pending: {
      distribute_xxxxx: {
        type: "distribute_project"
        project_url: "https://..."
        project_name: "MyProject.zip"
        extract_path: "C:\\..."
        verify_files: ["project.toe", "Assets/"]
        distribution_id: "project-dist-xxxxx"
        timestamp: 1234567890
        status: "pending"
      }
    }
    completed: {
      distribute_xxxxx: {
        result: "Project extracted successfully to C:\\..."
        status: "completed" | "failed" | "downloading" | "extracting"
        progress: 0-100  (during download/extract)
        completedAt: timestamp
      }
    }
```

## Command Reference

### View Logs
```bash
type c:\Users\admin\Documents\Git\Owlette\agent\logs\service.log | findstr distribute
```

### Check Temp Files
```bash
dir %TEMP%\owlette_projects
```

### Check Extracted Files
```bash
dir "%USERPROFILE%\Documents\OwletteProjects"
```

### Restart Service
```bash
cd c:\Users\admin\Documents\Git\Owlette\agent\src
python owlette_service.py restart
```

## Support

For issues or questions:
- Check agent logs: `c:\Users\admin\Documents\Git\Owlette\agent\logs\service.log`
- Review Firestore console for distribution status
- Verify network connectivity and firewall rules
- Test download URLs in browser first
- Check disk space on target machines

## Best Practices

1. **Test First**: Always test distributions on one machine before deploying to many
2. **Use Templates**: Save common configurations as templates for efficiency
3. **Verify Critical Files**: Use verify files to catch extraction issues early
4. **Monitor Progress**: Watch the dashboard during large distributions
5. **Use HTTPS**: Always use secure URLs for project downloads
6. **Check File Size**: Be mindful of bandwidth and storage constraints
7. **Cleanup**: Old distributions remain in Firestore - delete when no longer needed
8. **Host Wisely**: Choose file hosting based on file size and frequency (Backblaze B2 for large/frequent)

## Future Enhancements

Potential future features:
- **Upload to Owlette Cloud**: Built-in file hosting with Backblaze B2
- **Git Integration**: Pull projects from GitHub/GitLab repositories
- **Incremental Sync**: Only download changed files (rsync-style)
- **Automatic Versioning**: Track project versions over time
- **Rollback**: Revert to previous project version
- **Compression Options**: Choose compression level vs speed
