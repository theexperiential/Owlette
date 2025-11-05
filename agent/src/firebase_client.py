"""
Firebase Client for Owlette 2.0

Handles all Firestore operations including:
- Machine presence/heartbeat
- Configuration sync with offline caching
- Command queue (bidirectional communication)
- System metrics reporting
- Offline resilience

OAuth Authentication:
This version uses custom token authentication via REST API instead of
service account credentials, eliminating the need for firebase-credentials.json.
"""

import threading
import time
import json
import os
import logging
import socket
import hashlib
from typing import Dict, Any, Callable, Optional
from datetime import datetime

# Import shared utilities
import shared_utils
import registry_utils

# Import new OAuth-based modules (replace firebase_admin)
from auth_manager import AuthManager, AuthenticationError, TokenRefreshError
from firestore_rest_client import FirestoreRestClient, SERVER_TIMESTAMP, DELETE_FIELD


class FirebaseClient:
    """
    Main Firebase client for Owlette agent.
    Handles all cloud communication with offline resilience.
    """

    def __init__(self, auth_manager: AuthManager, project_id: str, site_id: str, config_cache_path: str = "config/firebase_cache.json"):
        """
        Initialize Firebase client with OAuth authentication.

        Args:
            auth_manager: AuthManager instance for token management
            project_id: Firebase project ID (e.g., "owlette-dev-3838a")
            site_id: Site ID this machine belongs to
            config_cache_path: Path to store cached config for offline mode
        """
        self.auth_manager = auth_manager
        self.project_id = project_id
        self.site_id = site_id
        self.machine_id = socket.gethostname()
        self.config_cache_path = config_cache_path

        # Firestore REST client instance
        self.db: Optional[FirestoreRestClient] = None
        self.connected = False

        # Threads
        self.heartbeat_thread: Optional[threading.Thread] = None
        self.metrics_thread: Optional[threading.Thread] = None
        self.command_listener_thread: Optional[threading.Thread] = None
        self.config_listener_thread: Optional[threading.Thread] = None
        self.software_inventory_thread: Optional[threading.Thread] = None
        self.running = False

        # Callbacks
        self.command_callback: Optional[Callable] = None
        self.config_update_callback: Optional[Callable] = None

        # Cached config for offline mode
        self.cached_config: Optional[Dict] = None

        # Track last uploaded config to prevent processing our own writes
        self._last_uploaded_config_hash: Optional[str] = None

        # Track last synced software inventory hash to prevent unnecessary writes
        self._last_software_inventory_hash: Optional[str] = None

        # Logging
        self.logger = logging.getLogger("OwletteFirebase")

        # Initialize Firebase
        self._initialize_firebase()

    def _initialize_firebase(self):
        """Initialize Firebase connection using OAuth authentication."""
        try:
            # Check if authenticated
            if not self.auth_manager.is_authenticated():
                self.logger.error("Agent not authenticated - no refresh token found")
                self.logger.warning("Running in OFFLINE MODE - will use cached config only")
                self._load_cached_config()
                return

            # Initialize Firestore REST client
            self.db = FirestoreRestClient(
                project_id=self.project_id,
                auth_manager=self.auth_manager
            )
            self.connected = True
            self.logger.info(f"Connected to Firestore - Site: {self.site_id}, Machine: {self.machine_id}")

            # Load cached config if exists
            self._load_cached_config()

        except Exception as e:
            self.logger.error(f"Failed to initialize Firebase: {e}")
            self.logger.warning("Running in OFFLINE MODE - will use cached config only")
            self.connected = False
            self._load_cached_config()

    def start(self):
        """Start all background threads (heartbeat, metrics, command listener)."""
        if self.running:
            self.logger.warning("Firebase client already running")
            return

        self.running = True

        # Send immediate heartbeat and metrics to set machine online right away (don't wait 30-60 seconds)
        if self.connected:
            try:
                self._update_presence(True)
                self.logger.info("Initial heartbeat sent - machine is now online")

                # Also send immediate metrics so dashboard updates right away
                metrics = shared_utils.get_system_metrics()
                self._upload_metrics(metrics)
                self.logger.info("Initial metrics uploaded")
            except Exception as e:
                self.logger.error(f"Failed to send initial heartbeat/metrics: {e}")

        # DISABLED: Heartbeat now included in metrics upload (every 60s)
        # No need for separate 30s heartbeat thread - reduces snapshot events
        # self.heartbeat_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        # self.heartbeat_thread.start()
        # self.logger.info("Heartbeat thread started")
        self.logger.info("Heartbeat thread DISABLED - heartbeat data included in metrics")

        # Start metrics thread (60 second interval)
        self.metrics_thread = threading.Thread(target=self._metrics_loop, daemon=True)
        self.metrics_thread.start()
        self.logger.info("Metrics thread started")

        # Start command listener thread
        if self.connected:
            self.command_listener_thread = threading.Thread(target=self._command_listener_loop, daemon=True)
            self.command_listener_thread.start()
            self.logger.info("Command listener thread started")

            # Start config listener thread
            self.config_listener_thread = threading.Thread(target=self._config_listener_loop, daemon=True)
            self.config_listener_thread.start()
            self.logger.info("Config listener thread started")

            # Start software inventory thread (5 minute interval)
            self.software_inventory_thread = threading.Thread(target=self._software_inventory_loop, daemon=True)
            self.software_inventory_thread.start()
            self.logger.info("Software inventory thread started")
        else:
            self.logger.warning("Command listener NOT started (offline mode)")
            self.logger.warning("Config listener NOT started (offline mode)")
            self.logger.warning("Software inventory NOT started (offline mode)")

    def stop(self):
        """Stop all background threads and set machine offline."""
        self.logger.info("Stopping Firebase client and setting machine offline...")

        # Set machine as offline BEFORE stopping threads (critical for clean shutdown)
        if self.connected and self.db:
            try:
                # Force synchronous offline update with retries
                presence_ref = self.db.collection('sites').document(self.site_id)\
                    .collection('machines').document(self.machine_id)

                # Write offline status directly (bypass _update_presence for more control)
                import time
                max_attempts = 3
                for attempt in range(max_attempts):
                    try:
                        presence_ref.update({
                            'online': False,
                            'lastHeartbeat': SERVER_TIMESTAMP
                        })
                        self.logger.info(f"[OK] Machine marked OFFLINE in Firestore (attempt {attempt + 1}/{max_attempts})")
                        # Give network time to complete the write
                        time.sleep(1)
                        break
                    except Exception as e:
                        if attempt == max_attempts - 1:
                            raise
                        self.logger.warning(f"Offline update attempt {attempt + 1} failed, retrying...")
                        time.sleep(0.2)

            except Exception as e:
                self.logger.error(f"[ERROR] Failed to set machine offline after {max_attempts} attempts: {e}")

        # Now stop the background threads
        self.running = False
        self.logger.info("Background threads stopped")

    def _heartbeat_loop(self):
        """Heartbeat loop - updates presence every 30 seconds."""
        while self.running:
            try:
                if self.connected:
                    self._update_presence(True)
                    self.logger.debug("Heartbeat sent")
            except Exception as e:
                self.logger.error(f"Heartbeat failed: {e}")
                self.connected = False
                # Try to reconnect
                self._try_reconnect()

            time.sleep(30)  # 30 second interval

    def _metrics_loop(self):
        """Metrics loop - uploads system stats every 60 seconds."""
        while self.running:
            try:
                if self.connected:
                    # CRITICAL: Ensure token is valid before upload
                    # This triggers automatic refresh if token expires in < 5 minutes
                    try:
                        self.auth_manager.get_valid_token()
                    except Exception as e:
                        self.logger.error(f"Token validation/refresh failed: {e}")
                        self.connected = False
                        self._try_reconnect()
                        time.sleep(60)
                        continue

                    metrics = shared_utils.get_system_metrics()
                    self._upload_metrics(metrics)
                    self.logger.debug(f"Metrics uploaded: CPU={metrics.get('cpu')}%")
            except Exception as e:
                self.logger.error(f"Metrics upload failed: {e}")

            time.sleep(60)  # 60 second interval

    def _command_listener_loop(self):
        """Listen for commands from Firestore in real-time."""
        if not self.connected:
            return

        try:
            # Document path for pending commands
            commands_path = f"sites/{self.site_id}/machines/{self.machine_id}/commands/pending"

            # Callback for document changes
            def on_commands_changed(commands_data):
                """Handle commands document changes."""
                if commands_data:
                    for cmd_id, cmd_data in commands_data.items():
                        self._process_command(cmd_id, cmd_data)

            # Start listener (runs in separate thread, polls every 2 seconds)
            self.db.listen_to_document(commands_path, on_commands_changed)

            # Keep this thread alive
            while self.running:
                time.sleep(1)

        except Exception as e:
            self.logger.error(f"Command listener error: {e}")
            self.connected = False

    def _config_listener_loop(self):
        """Listen for config changes from Firestore in real-time."""
        if not self.connected:
            return

        try:
            # Document path for config
            config_path = f"config/{self.site_id}/machines/{self.machine_id}"

            # Track if this is the first snapshot (to skip initial load)
            first_snapshot = True

            # Callback for config changes
            def on_config_changed(config_data):
                """Handle config document changes."""
                nonlocal first_snapshot

                # Skip the first snapshot (initial load)
                if first_snapshot:
                    first_snapshot = False
                    self.logger.info("Config listener initialized (skipping initial snapshot)")
                    return

                if config_data:
                    # Calculate hash of incoming config
                    incoming_hash = hashlib.md5(json.dumps(config_data, sort_keys=True).encode()).hexdigest()

                    # Skip if this is our own write (prevents feedback loop)
                    if incoming_hash == self._last_uploaded_config_hash:
                        self.logger.debug(f"Skipping self-originated config change (hash: {incoming_hash[:8]}...)")
                        return

                    self.logger.info(f"Config change detected in Firestore (hash: {incoming_hash[:8]}...)")

                    # Cache the new config
                    self._save_cached_config(config_data)
                    self.cached_config = config_data

                    # Call the registered callback
                    if self.config_update_callback:
                        try:
                            self.config_update_callback(config_data)
                            self.logger.info("Config update applied successfully")
                        except Exception as e:
                            self.logger.error(f"Error in config update callback: {e}")
                    else:
                        self.logger.warning("No config update callback registered")

            # Start listener (runs in separate thread, polls every 2 seconds)
            self.db.listen_to_document(config_path, on_config_changed)

            # Keep this thread alive
            while self.running:
                time.sleep(1)

        except Exception as e:
            self.logger.error(f"Config listener error: {e}")
            self.connected = False

    def _handle_removal_detection(self, error: Exception):
        """
        Handle detection of machine removal from web dashboard.
        If Firestore operations fail with permission denied or not found,
        it likely means the machine was removed via the web dashboard.
        """
        error_str = str(error).lower()

        # Check for permission denied or not found errors
        if '403' in error_str or 'permission' in error_str or 'not found' in error_str or '404' in error_str:
            self.logger.warning("Machine may have been removed from site via web dashboard")
            self.logger.info("Disabling Firebase and clearing site_id in local config")

            try:
                # Load current config
                config = shared_utils.read_config()

                # Disable Firebase and clear site_id
                if 'firebase' not in config:
                    config['firebase'] = {}

                config['firebase']['enabled'] = False
                config['firebase']['site_id'] = ''

                # Save config
                shared_utils.save_config(config)

                self.logger.info("Local config updated - machine deregistered from site")

                # Stop this Firebase client
                self.stop()

                return True  # Handled
            except Exception as config_error:
                self.logger.error(f"Failed to update local config after removal detection: {config_error}")

        return False  # Not handled

    def _update_presence(self, online: bool):
        """Update machine presence/heartbeat in Firestore."""
        if not self.connected or not self.db:
            return

        try:
            presence_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)

            presence_ref.set({
                'online': online,
                'lastHeartbeat': SERVER_TIMESTAMP,
                'machineId': self.machine_id,
                'siteId': self.site_id
            }, merge=True)

            # Log for debugging
            if online:
                self.logger.debug("Heartbeat: Machine online")
            else:
                self.logger.info(f"[OK] Machine marked OFFLINE in Firestore (site: {self.site_id}, machine: {self.machine_id})")
        except Exception as e:
            # Check if this is due to machine removal from web dashboard
            if self._handle_removal_detection(e):
                return  # Machine was removed, stop processing
            else:
                self.logger.error(f"Error updating presence: {e}")

    def _upload_metrics(self, metrics: Dict[str, Any]):
        """Upload system metrics to Firestore."""
        if not self.connected or not self.db:
            return

        metrics_ref = self.db.collection('sites').document(self.site_id)\
            .collection('machines').document(self.machine_id)

        # Use set with merge=True for atomic updates (prevents partial snapshot flicker in web app)
        # CRITICAL: Include online/lastHeartbeat WITH metrics to prevent intermediate snapshots
        # If these are separate writes, web app sees metrics:undefined between updates
        try:
            processes_data = metrics.get('processes', {})
            self.logger.info(f"DEBUG: Uploading metrics with {len(processes_data)} processes: {list(processes_data.keys())}")

            metrics_ref.set({
                'online': True,
                'lastHeartbeat': SERVER_TIMESTAMP,
                'agent_version': shared_utils.APP_VERSION,  # Report agent version for update detection
                'machineId': self.machine_id,
                'siteId': self.site_id,
                'metrics': {
                    'cpu': metrics.get('cpu', {}),
                    'memory': metrics.get('memory', {}),
                    'disk': metrics.get('disk', {}),
                    'gpu': metrics.get('gpu', {}),
                    'timestamp': SERVER_TIMESTAMP,
                    'processes': processes_data  # This replaces entire processes object
                }
            }, merge=True)
        except Exception as e:
            # Check if this is due to machine removal from web dashboard
            if self._handle_removal_detection(e):
                return  # Machine was removed, stop processing

            # If document doesn't exist (but not removed), create it with set
            try:
                metrics_ref.set({
                    'online': True,
                    'lastHeartbeat': SERVER_TIMESTAMP,
                    'agent_version': shared_utils.APP_VERSION,  # Report agent version for update detection
                    'machineId': self.machine_id,
                    'siteId': self.site_id,
                    'metrics': {
                        'cpu': metrics.get('cpu', {}),
                        'memory': metrics.get('memory', {}),
                        'disk': metrics.get('disk', {}),
                        'gpu': metrics.get('gpu', {}),
                        'timestamp': SERVER_TIMESTAMP,
                        'processes': metrics.get('processes', {})
                    }
                })
            except Exception as set_error:
                # Check again for removal
                if self._handle_removal_detection(set_error):
                    return
                else:
                    self.logger.error(f"Error uploading metrics: {set_error}")

    def _process_command(self, cmd_id: str, cmd_data: Dict[str, Any]):
        """Process a command received from Firestore."""
        try:
            cmd_type = cmd_data.get('type')
            self.logger.info(f"Processing command: {cmd_id} - Type: {cmd_type}")

            # Extract deployment_id if present (needed for web app to track deployment status)
            deployment_id = cmd_data.get('deployment_id')

            # Call the registered callback
            if self.command_callback:
                result = self.command_callback(cmd_id, cmd_data)

                # Check if result indicates an error (command handlers return error strings starting with "Error:")
                is_error = isinstance(result, str) and result.startswith("Error:")

                # Use appropriate completion method based on command type and result
                if cmd_type == 'cancel_installation':
                    # Mark as cancelled instead of completed
                    self._mark_command_cancelled(cmd_id, result, deployment_id, cmd_type)
                elif is_error:
                    # Command returned an error message - mark as failed
                    self._mark_command_failed(cmd_id, result, deployment_id, cmd_type)
                else:
                    # Normal completion for other commands
                    self._mark_command_completed(cmd_id, result, deployment_id, cmd_type)
            else:
                self.logger.warning(f"No command callback registered, ignoring command {cmd_id}")

        except Exception as e:
            self.logger.error(f"Error processing command {cmd_id}: {e}")
            self._mark_command_failed(cmd_id, str(e), cmd_data.get('deployment_id'), cmd_data.get('type'))

    def update_command_progress(self, cmd_id: str, status: str, deployment_id: Optional[str] = None, progress: Optional[int] = None):
        """
        Update command progress in Firestore (for intermediate states like downloading/installing).

        Args:
            cmd_id: Command ID
            status: Current status (e.g., 'downloading', 'installing')
            deployment_id: Optional deployment ID to track
            progress: Optional progress percentage (0-100)
        """
        if not self.connected or not self.db:
            return

        try:
            # Update in completed collection (web app listens here for progress)
            completed_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)\
                .collection('commands').document('completed')

            # Build the progress data
            progress_data = {
                'status': status,
                'updatedAt': SERVER_TIMESTAMP
            }

            # Include deployment_id if present
            if deployment_id:
                progress_data['deployment_id'] = deployment_id

            # Include progress percentage if present
            if progress is not None:
                progress_data['progress'] = progress

            completed_ref.set({
                cmd_id: progress_data
            }, merge=True)

            self.logger.debug(f"Command {cmd_id} progress: {status}" + (f" ({progress}%)" if progress is not None else ""))

        except Exception as e:
            self.logger.error(f"Failed to update command {cmd_id} progress: {e}")

    def _mark_command_completed(self, cmd_id: str, result: Any, deployment_id: Optional[str] = None, cmd_type: Optional[str] = None):
        """Mark a command as completed in Firestore."""
        if not self.connected or not self.db:
            return

        try:
            # Remove from pending
            pending_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)\
                .collection('commands').document('pending')

            pending_ref.update({
                cmd_id: DELETE_FIELD
            })

            # Add to completed
            completed_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)\
                .collection('commands').document('completed')

            # Build the completed command data
            completed_data = {
                'result': result,
                'status': 'completed',
                'completedAt': SERVER_TIMESTAMP
            }

            # Include deployment_id if present (needed for web app to track deployment status)
            if deployment_id:
                completed_data['deployment_id'] = deployment_id

            # Include command type (needed for web app to identify command type)
            if cmd_type:
                completed_data['type'] = cmd_type

            completed_ref.set({
                cmd_id: completed_data
            }, merge=True)

            self.logger.info(f"Command {cmd_id} marked as completed")

        except Exception as e:
            self.logger.error(f"Failed to mark command {cmd_id} as completed: {e}")

    def _mark_command_failed(self, cmd_id: str, error: str, deployment_id: Optional[str] = None, cmd_type: Optional[str] = None):
        """Mark a command as failed in Firestore."""
        if not self.connected or not self.db:
            return

        try:
            # Remove from pending
            pending_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)\
                .collection('commands').document('pending')

            pending_ref.update({
                cmd_id: DELETE_FIELD
            })

            # Add to completed with error
            completed_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)\
                .collection('commands').document('completed')

            # Build the failed command data
            failed_data = {
                'error': error,
                'status': 'failed',
                'completedAt': SERVER_TIMESTAMP
            }

            # Include deployment_id if present (needed for web app to track deployment status)
            if deployment_id:
                failed_data['deployment_id'] = deployment_id

            # Include command type (needed for web app to identify command type)
            if cmd_type:
                failed_data['type'] = cmd_type

            completed_ref.set({
                cmd_id: failed_data
            }, merge=True)

            self.logger.error(f"Command {cmd_id} marked as failed: {error}")

        except Exception as e:
            self.logger.error(f"Failed to mark command {cmd_id} as failed: {e}")

    def _mark_command_cancelled(self, cmd_id: str, result: str, deployment_id: Optional[str] = None, cmd_type: Optional[str] = None):
        """Mark a command as cancelled in Firestore."""
        if not self.connected or not self.db:
            return

        try:
            # Remove from pending
            pending_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)\
                .collection('commands').document('pending')

            pending_ref.update({
                cmd_id: DELETE_FIELD
            })

            # Add to completed with cancelled status
            completed_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)\
                .collection('commands').document('completed')

            # Build the cancelled command data
            cancelled_data = {
                'result': result,
                'status': 'cancelled',
                'completedAt': SERVER_TIMESTAMP
            }

            # Include deployment_id if present (needed for web app to track deployment status)
            if deployment_id:
                cancelled_data['deployment_id'] = deployment_id

            # Include command type (needed for web app to identify command type)
            if cmd_type:
                cancelled_data['type'] = cmd_type

            completed_ref.set({
                cmd_id: cancelled_data
            }, merge=True)

            self.logger.info(f"Command {cmd_id} marked as cancelled")

        except Exception as e:
            self.logger.error(f"Failed to mark command {cmd_id} as cancelled: {e}")

    def get_config(self) -> Optional[Dict]:
        """
        Get machine configuration from Firestore (or cache if offline).

        Returns:
            Configuration dict or None if not available
        """
        # Try Firestore first
        if self.connected and self.db:
            try:
                config_ref = self.db.collection('config').document(self.site_id)\
                    .collection('machines').document(self.machine_id)

                doc = config_ref.get()
                if doc.exists:
                    config = doc.to_dict()
                    # Cache the config
                    self._save_cached_config(config)
                    self.cached_config = config
                    return config
            except Exception as e:
                self.logger.error(f"Failed to get config from Firestore: {e}")

        # Fall back to cached config
        if self.cached_config:
            self.logger.info("Using cached config (offline mode)")
            return self.cached_config

        return None

    def upload_config(self, config: Dict):
        """
        Upload local config to Firestore.
        Used for initial migration from local config.json.

        Args:
            config: Configuration dict to upload
        """
        if not self.connected or not self.db:
            self.logger.warning("Cannot upload config - not connected to Firestore")
            return

        try:
            config_ref = self.db.collection('config').document(self.site_id)\
                .collection('machines').document(self.machine_id)

            config_ref.set(config, merge=True)

            # Calculate and store hash to prevent processing our own write
            config_hash = hashlib.md5(json.dumps(config, sort_keys=True).encode()).hexdigest()
            self._last_uploaded_config_hash = config_hash

            self.logger.info(f"Config uploaded to Firestore successfully (hash: {config_hash[:8]}...)")

            # Also cache it locally
            self._save_cached_config(config)
            self.cached_config = config

        except Exception as e:
            self.logger.error(f"Failed to upload config to Firestore: {e}")

    def ship_logs(self, log_entries: list):
        """
        Ship log entries to Firestore for centralized monitoring.
        Non-blocking - failures are silently ignored to prevent logging from crashing the app.

        Args:
            log_entries: List of log entry dicts with keys: timestamp, level, message, logger, filename, line
        """
        if not self.connected or not self.db:
            return

        try:
            # Create a batch write for efficiency
            batch = self.db.batch()

            logs_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)\
                .collection('logs')

            for log_entry in log_entries:
                # Add server timestamp
                log_entry['server_timestamp'] = SERVER_TIMESTAMP
                log_entry['machine_id'] = self.machine_id
                log_entry['site_id'] = self.site_id

                # Create document with auto-generated ID
                doc_ref = logs_ref.document()
                batch.set(doc_ref, log_entry)

            # Commit batch (non-blocking)
            batch.commit()
            self.logger.debug(f"Shipped {len(log_entries)} log entries to Firebase")

        except Exception as e:
            # Silently fail - don't crash the app due to logging issues
            # Only log to local file if really necessary
            pass

    def _load_cached_config(self):
        """Load cached config from disk."""
        try:
            if os.path.exists(self.config_cache_path):
                with open(self.config_cache_path, 'r') as f:
                    self.cached_config = json.load(f)
                self.logger.info(f"Loaded cached config from {self.config_cache_path}")
        except Exception as e:
            self.logger.error(f"Failed to load cached config: {e}")

    def _save_cached_config(self, config: Dict):
        """Save config to disk cache."""
        try:
            os.makedirs(os.path.dirname(self.config_cache_path), exist_ok=True)
            with open(self.config_cache_path, 'w') as f:
                json.dump(config, f, indent=2)
            self.logger.debug("Config cached to disk")
        except Exception as e:
            self.logger.error(f"Failed to save cached config: {e}")

    def _check_internet_connectivity(self) -> bool:
        """
        Check if internet is available before attempting Firebase reconnection.
        Uses multiple methods for reliability.

        Returns:
            True if internet appears to be available, False otherwise
        """
        try:
            # Method 1: Try to connect to Google's DNS (8.8.8.8)
            import socket
            socket.create_connection(("8.8.8.8", 53), timeout=3)
            return True
        except OSError:
            pass

        try:
            # Method 2: Try to connect to Cloudflare DNS (1.1.1.1)
            import socket
            socket.create_connection(("1.1.1.1", 53), timeout=3)
            return True
        except OSError:
            pass

        # No connectivity detected
        return False

    def _try_reconnect(self):
        """
        Try to reconnect to Firestore with smart internet detection.
        Only attempts reconnection when internet is available.
        """
        try:
            # First check if internet is available
            if not self._check_internet_connectivity():
                self.logger.debug("No internet connectivity detected, skipping Firebase reconnection attempt")
                return

            self.logger.info("Internet connectivity detected, attempting to reconnect to Firestore...")
            self._initialize_firebase()

            if self.connected:
                self.logger.info("Reconnected to Firestore successfully")

                # Properly cleanup and restart command listener if needed
                if not self.command_listener_thread or not self.command_listener_thread.is_alive():
                    # Cleanup old thread object if it exists
                    if self.command_listener_thread:
                        try:
                            # Wait briefly for thread to fully terminate (it's daemon, so won't block long)
                            self.command_listener_thread.join(timeout=1)
                        except:
                            pass
                        self.command_listener_thread = None

                    # Create new thread
                    self.command_listener_thread = threading.Thread(target=self._command_listener_loop, daemon=True)
                    self.command_listener_thread.start()
                    self.logger.info("Command listener thread restarted")

                # Properly cleanup and restart config listener if needed
                if not self.config_listener_thread or not self.config_listener_thread.is_alive():
                    # Cleanup old thread object if it exists
                    if self.config_listener_thread:
                        try:
                            # Wait briefly for thread to fully terminate
                            self.config_listener_thread.join(timeout=1)
                        except:
                            pass
                        self.config_listener_thread = None

                    # Create new thread
                    self.config_listener_thread = threading.Thread(target=self._config_listener_loop, daemon=True)
                    self.config_listener_thread.start()
                    self.logger.info("Config listener thread restarted")
        except Exception as e:
            self.logger.error(f"Reconnection failed: {e}")

    def register_command_callback(self, callback: Callable):
        """
        Register a callback function to handle commands.

        Args:
            callback: Function that takes (cmd_id, cmd_data) and returns result
        """
        self.command_callback = callback
        self.logger.info("Command callback registered")

    def register_config_update_callback(self, callback: Callable):
        """
        Register a callback function to handle config updates.

        Args:
            callback: Function that takes (config) and handles the update
        """
        self.config_update_callback = callback
        self.logger.info("Config update callback registered")

    def is_connected(self) -> bool:
        """Check if connected to Firestore."""
        return self.connected

    def get_machine_id(self) -> str:
        """Get the machine ID (hostname)."""
        return self.machine_id

    def get_site_id(self) -> str:
        """Get the site ID."""
        return self.site_id

    def _software_inventory_loop(self):
        """Software inventory loop - syncs installed software every 5 minutes."""
        while self.running:
            try:
                if self.connected:
                    self._sync_software_inventory()
                    self.logger.debug("Software inventory synced to Firestore")
            except Exception as e:
                self.logger.error(f"Software inventory sync failed: {e}")

            # Sleep for 5 minutes (300 seconds)
            time.sleep(300)

    def _calculate_software_hash(self, software_list):
        """
        Calculate a hash of the software list to detect changes.

        Args:
            software_list: List of software dictionaries

        Returns:
            MD5 hash string of the software list
        """
        # Sort by name and version for consistent hashing
        sorted_software = sorted(software_list, key=lambda s: (s.get('name', ''), s.get('version', '')))

        # Create a simple string representation (name + version)
        software_str = '|'.join([
            f"{s.get('name', '')}:{s.get('version', '')}"
            for s in sorted_software
        ])

        return hashlib.md5(software_str.encode('utf-8')).hexdigest()

    def _sync_software_inventory(self, force=False):
        """
        Sync installed software to Firestore.

        Queries Windows registry for installed software and uploads to:
        sites/{site_id}/machines/{machine_id}/installed_software

        Args:
            force: If True, sync even if software hasn't changed (for on-demand refresh)
        """
        if not self.connected or not self.db:
            return

        try:
            # Get installed software from Windows registry
            installed_software = registry_utils.get_installed_software()

            if not installed_software:
                self.logger.debug("No installed software detected")
                return

            # Calculate hash of current software list
            current_hash = self._calculate_software_hash(installed_software)

            # Check if software changed since last sync
            if not force and current_hash == self._last_software_inventory_hash:
                self.logger.debug("Software inventory unchanged, skipping sync")
                return

            # Reference to installed_software subcollection
            software_collection_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)\
                .collection('installed_software')

            # Clear existing entries first (for clean sync)
            # Note: In production, you might want to do a diff-based update instead
            try:
                # Delete all existing documents
                existing_docs = software_collection_ref.stream()
                for doc in existing_docs:
                    doc.reference.delete()
            except Exception as e:
                self.logger.warning(f"Failed to clear existing software inventory: {e}")

            # Upload new software list
            # Try batch write first, fall back to individual writes if batch fails
            batch_write_failed = False

            try:
                batch = self.db.batch()
                batch_count = 0

                for software in installed_software:
                    # Create a unique document ID from software name + version
                    # Replace invalid characters for Firestore document IDs
                    doc_id = f"{software['name']}_{software['version']}".replace('/', '_').replace('\\', '_')
                    doc_id = doc_id[:1500]  # Firestore doc ID limit

                    doc_ref = software_collection_ref.document(doc_id)

                    # Add timestamp
                    software_data = {
                        **software,
                        'detected_at': SERVER_TIMESTAMP
                    }

                    batch.set(doc_ref, software_data)
                    batch_count += 1

                    # Firestore batches limited to 500 operations
                    if batch_count >= 500:
                        batch.commit()
                        batch = self.db.batch()
                        batch_count = 0

                # Commit remaining items
                if batch_count > 0:
                    batch.commit()

                self.logger.info(f"Synced {len(installed_software)} software packages to Firestore (batch write)")
                # Update hash after successful sync
                self._last_software_inventory_hash = current_hash

            except Exception as batch_error:
                # Batch write failed (often 403 due to REST API + custom token limitations)
                # This is expected with OAuth tokens, so log at INFO level
                self.logger.info(f"Batch write not available (using individual writes instead)")
                self.logger.debug(f"Batch write error: {batch_error}")
                batch_write_failed = True

            # Fallback to individual writes if batch failed
            if batch_write_failed:
                # Fallback: Write documents individually
                success_count = 0
                for software in installed_software:
                    try:
                        doc_id = f"{software['name']}_{software['version']}".replace('/', '_').replace('\\', '_')
                        doc_id = doc_id[:1500]

                        doc_ref = software_collection_ref.document(doc_id)
                        software_data = {
                            **software,
                            'detected_at': SERVER_TIMESTAMP
                        }
                        doc_ref.set(software_data)
                        success_count += 1
                    except Exception as write_error:
                        self.logger.warning(f"Failed to write {software.get('name', 'unknown')}: {write_error}")

                self.logger.info(f"Synced {success_count}/{len(installed_software)} software packages (individual writes)")
                # Update hash after successful sync
                if success_count > 0:
                    self._last_software_inventory_hash = current_hash

        except Exception as e:
            self.logger.error(f"Failed to sync software inventory: {e}")
            self.logger.exception("Software inventory sync error details:")


# Example usage / testing
if __name__ == "__main__":
    # Set up logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    # Initialize client
    client = FirebaseClient(
        credentials_path="firebase-credentials.json",
        site_id="test_site_001"
    )

    # Define command handler
    def handle_command(cmd_id, cmd_data):
        cmd_type = cmd_data.get('type')
        print(f"Received command: {cmd_type}")

        if cmd_type == 'restart_process':
            process_name = cmd_data.get('process_name')
            print(f"Restarting process: {process_name}")
            # ... restart logic here ...
            return f"Process {process_name} restarted"

        elif cmd_type == 'kill_process':
            process_name = cmd_data.get('process_name')
            print(f"Killing process: {process_name}")
            # ... kill logic here ...
            return f"Process {process_name} killed"

        return "Command executed"

    # Register callback
    client.register_command_callback(handle_command)

    # Start client
    client.start()

    # Upload test config
    test_config = {
        "version": "2.0.0",
        "processes": [
            {
                "name": "TouchDesigner",
                "exe_path": "C:\\TouchDesigner\\bin\\TouchDesigner.exe"
            }
        ]
    }
    client.upload_config(test_config)

    # Keep running
    try:
        print("Firebase client running... Press Ctrl+C to stop")
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping...")
        client.stop()
