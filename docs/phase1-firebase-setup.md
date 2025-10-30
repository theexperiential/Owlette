# Phase 1: Firebase Foundation Setup

## Overview
This phase adds Firebase Firestore integration to the Owlette Python service, enabling cloud communication while maintaining offline capability.

---

## Step 1: Firebase Project Setup

### 1.1 Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" or "Create a project"
3. Name it "Owlette" (or your preferred name)
4. Disable Google Analytics (not needed for this project)
5. Click "Create Project"

### 1.2 Set Up Firestore Database

1. In the Firebase Console, click on "Firestore Database" in the left sidebar
2. Click "Create database"
3. **Start in Production mode** (we'll configure security rules next)
4. Choose a location close to you (e.g., `us-central1`, `us-east1`, etc.)
5. Click "Enable"

### 1.3 Generate Service Account Credentials

1. In Firebase Console, click the gear icon (⚙️) → "Project settings"
2. Go to the "Service accounts" tab
3. Click "Generate new private key"
4. A dialog will appear warning you to keep this key secret - click "Generate key"
5. Save the downloaded JSON file as `firebase-credentials.json` in your `agent/config/` directory
6. **IMPORTANT**: This file is already in `.gitignore` to prevent committing credentials to git

### 1.4 Configure Firestore Security Rules

**How to find Security Rules:**
1. In Firebase Console, click "Firestore Database" in the left sidebar
2. Click the "Rules" tab at the top (next to "Data", "Indexes", "Usage")
3. You should see a text editor with your current rules

**Replace the default rules with:**

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow service accounts (machines) to read/write their own data
    match /sites/{siteId}/machines/{machineId}/{document=**} {
      allow read, write: if request.auth != null;
    }

    // Allow service accounts to read config
    match /config/{siteId}/machines/{machineId} {
      allow read, write: if request.auth != null;
    }

    // For now, allow authenticated access (we'll tighten this in Phase 2)
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

4. Click "Publish" to save the rules

---

## Step 2: Update .gitignore

Add the following to your `.gitignore` file to prevent committing sensitive credentials:

```
# Firebase credentials
firebase-credentials.json
```

---

## Step 3: Add Firebase Dependencies

Add the following to `requirements.txt`:

```
firebase-admin==6.4.0
google-cloud-firestore==2.14.0
```

Install dependencies:
```bash
pip install firebase-admin google-cloud-firestore
```

---

## Firestore Data Structure

We'll use the following structure in Firestore:

```
sites/
  {siteId}/
    name: string
    createdAt: timestamp
    machines/
      {machineId}/
        presence/
          online: boolean
          lastHeartbeat: timestamp
        status/
          cpu: number
          memory: number
          disk: number
          gpu: number
          processes: map
        commands/
          pending/
            {commandId}/
              type: string
              params: map
              timestamp: timestamp
          completed/
            {commandId}/
              result: string
              completedAt: timestamp

config/
  {siteId}/
    machines/
      {machineId}/
        version: string
        processes: array
```

---

---

## Step 4: Firebase Client Module

We've created `firebase_client.py` - the core module that handles all Firestore communication.

### Features Implemented:

**1. Connection Management**
- Auto-initialization with service account credentials
- Offline mode fallback (uses cached config if Firebase unavailable)
- Auto-reconnection on network issues

**2. Machine Presence/Heartbeat**
- Updates Firestore every 30 seconds
- Marks machine as online/offline
- Uses server timestamps for accuracy

**3. System Metrics Reporting**
- Uploads CPU, memory, disk, GPU stats every 60 seconds
- Includes process status information
- Stores in Firestore for real-time dashboard display

**4. Command Queue (Bidirectional Communication)**
- Listens for commands from web portal in real-time
- Supports command types: restart_process, kill_process, update_config, install_software
- Acknowledgment system: moves commands from pending → completed
- Error handling: marks failed commands with error message

**5. Configuration Sync**
- Downloads config from Firestore on startup
- Caches config locally for offline operation
- Upload local config to Firestore (for migration)
- Callback system for config updates

**6. Offline Resilience**
- Runs completely offline if Firebase unavailable
- Uses last cached config
- Automatically syncs when connection restored

### Usage Example:

```python
from firebase_client import FirebaseClient

# Initialize
client = FirebaseClient(
    credentials_path="firebase-credentials.json",
    site_id="nyc_office_001"
)

# Register command handler
def handle_command(cmd_id, cmd_data):
    if cmd_data['type'] == 'restart_process':
        # Restart the process...
        return "Process restarted successfully"

client.register_command_callback(handle_command)

# Start background threads
client.start()

# Upload local config (first time migration)
config = load_local_config()  # Your existing config.json
client.upload_config(config)

# Get config (from Firestore or cache if offline)
config = client.get_config()
```

---

---

## Step 5: Service Integration

We've successfully integrated the Firebase client into the Owlette Windows service!

### Changes Made:

**1. Configuration (agent/config/config.json)**
- Updated version to 2.0.0
- Added `firebase` section:
  ```json
  "firebase": {
    "enabled": true,
    "site_id": "default_site"
  }
  ```

**2. Service Integration (agent/src/owlette_service.py)**
- Imported Firebase client with fallback if not available
- Initialize Firebase in `__init__()` method
- Start Firebase and register command callback in `main()` method
- Upload local config to Firestore on first run
- Stop Firebase gracefully in `SvcStop()` method

**3. Command Handler**
Added `handle_firebase_command()` method to process commands from web portal:
- `restart_process`: Kill and restart a process by name
- `kill_process`: Terminate a process by name
- `update_config`: Update local configuration from Firestore

### How It Works:

```
Service Startup Flow:
1. Service starts → Initialize Firebase client
2. Get user token for launching processes
3. Register command callback (handle_firebase_command)
4. Start Firebase background threads:
   - Heartbeat every 30 seconds
   - Metrics upload every 60 seconds
   - Command listener (real-time)
5. Upload local config to Firestore
6. Enter main loop (monitor processes every 10 seconds)

Service Stop Flow:
1. User stops service
2. Firebase client stops (marks machine offline)
3. Service terminates
```

---

## Testing Phase 1

Now it's time to test the integration! Here's what to test:

### Test 1: Basic Operation
1. Make sure you have `firebase-credentials.json` in the `agent/config/` directory
2. Update `agent/config/config.json` with your `site_id`
3. Restart the Owlette service or run from `agent/src/`:
   ```bash
   cd agent/src
   python owlette_service.py
   ```
4. Check `agent/logs/service.log` for Firebase connection messages

**Expected Log Messages:**
```
Firebase client initialized for site: your_site_id
Firebase client started successfully
Local config uploaded to Firebase
Heartbeat thread started
Metrics thread started
Command listener thread started
```

### Test 2: Firestore Data Verification
Open Firebase Console → Firestore Database → Check for:

```
sites/
  your_site_id/
    machines/
      YOUR_HOSTNAME/
        presence/
          status: {online: true, lastHeartbeat: timestamp}
        status/
          current: {cpu: 45, memory: 60, disk: 30, gpu: 0}

config/
  your_site_id/
    machines/
      YOUR_HOSTNAME/
        version: "2.0.0"
        processes: [...]
```

### Test 3: Offline Mode
1. Disable your internet connection
2. Check `logs/service.log` - should see "Running in OFFLINE MODE"
3. Verify service continues managing processes
4. Re-enable internet
5. Verify Firebase reconnects automatically

**Expected Behavior:**
- Service continues operating from cached config
- No errors or crashes
- Automatic reconnection when internet restored

### Test 4: Command Execution (Manual Test)
In Firebase Console, manually add a command:

```
sites/your_site_id/machines/YOUR_HOSTNAME/commands/pending:

{
  "test_cmd_001": {
    "type": "restart_process",
    "process_name": "YourProcessName",
    "timestamp": 1699999999
  }
}
```

**Expected Behavior:**
- Command executed within seconds
- Process restarts
- Command moved from `pending` to `completed`
- Result message appears in `completed` document

---

## Next Steps

Once Phase 1 testing is complete, we'll move to:
- **Phase 2**: Build the web portal (Next.js dashboard)
- **Phase 3**: Configuration management from web
- **Phase 4**: Machine onboarding system
- **Phase 5**: Software distribution (TouchDesigner)

---

## Troubleshooting

### Can't find "Rules" tab in Firestore
- Make sure you've created the Firestore database first (Step 1.2)
- Look for tabs at the top: Data | Rules | Indexes | Usage
- If you only see "Cloud Firestore" in sidebar but no database, click "Create database"

### Service account key not downloading
- Check your browser's download folder
- Try a different browser (Chrome recommended)
- Ensure pop-ups are not blocked

### "Permission denied" errors
- Make sure you've published the security rules (Step 1.4)
- Verify the service account key is in the correct location
- Check that the key file is valid JSON
