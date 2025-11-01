"""
Firebase Client for Owlette 2.0

Handles all Firestore operations including:
- Machine presence/heartbeat
- Configuration sync with offline caching
- Command queue (bidirectional communication)
- System metrics reporting
- Offline resilience
"""

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1 import DocumentSnapshot
import threading
import time
import json
import os
import logging
import socket
from typing import Dict, Any, Callable, Optional
from datetime import datetime

# Import shared utilities
import shared_utils


class FirebaseClient:
    """
    Main Firebase client for Owlette agent.
    Handles all cloud communication with offline resilience.
    """

    def __init__(self, credentials_path: str, site_id: str, config_cache_path: str = "config/firebase_cache.json"):
        """
        Initialize Firebase client.

        Args:
            credentials_path: Path to firebase-credentials.json
            site_id: Site ID this machine belongs to
            config_cache_path: Path to store cached config for offline mode
        """
        self.credentials_path = credentials_path
        self.site_id = site_id
        self.machine_id = socket.gethostname()
        self.config_cache_path = config_cache_path

        # Firebase instances
        self.db: Optional[firestore.Client] = None
        self.connected = False

        # Threads
        self.heartbeat_thread: Optional[threading.Thread] = None
        self.metrics_thread: Optional[threading.Thread] = None
        self.command_listener_thread: Optional[threading.Thread] = None
        self.config_listener_thread: Optional[threading.Thread] = None
        self.running = False

        # Callbacks
        self.command_callback: Optional[Callable] = None
        self.config_update_callback: Optional[Callable] = None

        # Cached config for offline mode
        self.cached_config: Optional[Dict] = None

        # Logging
        self.logger = logging.getLogger("OwletteFirebase")

        # Initialize Firebase
        self._initialize_firebase()

    def _initialize_firebase(self):
        """Initialize Firebase connection."""
        try:
            if not os.path.exists(self.credentials_path):
                self.logger.error(f"Firebase credentials not found at {self.credentials_path}")
                self.logger.warning("Running in OFFLINE MODE - will use cached config only")
                self._load_cached_config()
                return

            # Initialize Firebase Admin SDK
            cred = credentials.Certificate(self.credentials_path)

            # Check if app already initialized
            try:
                firebase_admin.get_app()
                self.logger.info("Firebase already initialized")
            except ValueError:
                firebase_admin.initialize_app(cred)
                self.logger.info("Firebase initialized successfully")

            # Get Firestore client
            self.db = firestore.client()
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

        # Start heartbeat thread (30 second interval)
        self.heartbeat_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        self.heartbeat_thread.start()
        self.logger.info("Heartbeat thread started")

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
        else:
            self.logger.warning("Command listener NOT started (offline mode)")
            self.logger.warning("Config listener NOT started (offline mode)")

    def stop(self):
        """Stop all background threads."""
        self.running = False
        self.logger.info("Stopping Firebase client...")

        # Set machine as offline before stopping
        if self.connected:
            try:
                self._update_presence(False)
            except:
                pass

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
            # Reference to pending commands
            commands_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)\
                .collection('commands').document('pending')

            # Watch for changes
            def on_snapshot(doc_snapshots, changes, read_time):
                for doc in doc_snapshots:
                    if doc.exists:
                        commands = doc.to_dict()
                        if commands:
                            for cmd_id, cmd_data in commands.items():
                                self._process_command(cmd_id, cmd_data)

            # Listen to document changes
            doc_watch = commands_ref.on_snapshot(on_snapshot)

            # Keep thread alive
            while self.running:
                time.sleep(1)

            # Unsubscribe when stopping
            doc_watch.unsubscribe()

        except Exception as e:
            self.logger.error(f"Command listener error: {e}")
            self.connected = False

    def _config_listener_loop(self):
        """Listen for config changes from Firestore in real-time."""
        if not self.connected:
            return

        try:
            # Reference to config document
            config_ref = self.db.collection('config').document(self.site_id)\
                .collection('machines').document(self.machine_id)

            # Track if this is the first snapshot (to skip initial load)
            first_snapshot = True

            # Watch for changes
            def on_snapshot(doc_snapshots, changes, read_time):
                nonlocal first_snapshot

                # Skip the first snapshot (initial load)
                if first_snapshot:
                    first_snapshot = False
                    self.logger.info("Config listener initialized (skipping initial snapshot)")
                    return

                for doc in doc_snapshots:
                    if doc.exists:
                        new_config = doc.to_dict()
                        self.logger.info("Config change detected in Firestore")

                        # Cache the new config
                        self._save_cached_config(new_config)
                        self.cached_config = new_config

                        # Call the registered callback
                        if self.config_update_callback:
                            try:
                                self.config_update_callback(new_config)
                                self.logger.info("Config update applied successfully")
                            except Exception as e:
                                self.logger.error(f"Error in config update callback: {e}")
                        else:
                            self.logger.warning("No config update callback registered")

            # Listen to document changes
            doc_watch = config_ref.on_snapshot(on_snapshot)

            # Keep thread alive
            while self.running:
                time.sleep(1)

            # Unsubscribe when stopping
            doc_watch.unsubscribe()

        except Exception as e:
            self.logger.error(f"Config listener error: {e}")
            self.connected = False

    def _update_presence(self, online: bool):
        """Update machine presence/heartbeat in Firestore."""
        if not self.connected or not self.db:
            return

        presence_ref = self.db.collection('sites').document(self.site_id)\
            .collection('machines').document(self.machine_id)

        presence_ref.set({
            'online': online,
            'lastHeartbeat': firestore.SERVER_TIMESTAMP,
            'machineId': self.machine_id,
            'siteId': self.site_id
        }, merge=True)

    def _upload_metrics(self, metrics: Dict[str, Any]):
        """Upload system metrics to Firestore."""
        if not self.connected or not self.db:
            return

        metrics_ref = self.db.collection('sites').document(self.site_id)\
            .collection('machines').document(self.machine_id)

        # Use update instead of set with merge to properly replace the processes field
        # This ensures deleted processes are actually removed from Firestore
        try:
            metrics_ref.update({
                'metrics.cpu': metrics.get('cpu', {}),
                'metrics.memory': metrics.get('memory', {}),
                'metrics.disk': metrics.get('disk', {}),
                'metrics.gpu': metrics.get('gpu', {}),
                'metrics.timestamp': firestore.SERVER_TIMESTAMP,
                'metrics.processes': metrics.get('processes', {})  # This replaces entire processes object
            })
        except Exception as e:
            # If document doesn't exist, create it with set
            metrics_ref.set({
                'metrics': {
                    'cpu': metrics.get('cpu', {}),
                    'memory': metrics.get('memory', {}),
                    'disk': metrics.get('disk', {}),
                    'gpu': metrics.get('gpu', {}),
                    'timestamp': firestore.SERVER_TIMESTAMP,
                    'processes': metrics.get('processes', {})
                }
            })

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

                # Use appropriate completion method based on command type
                if cmd_type == 'cancel_installation':
                    # Mark as cancelled instead of completed
                    self._mark_command_cancelled(cmd_id, result, deployment_id)
                else:
                    # Normal completion for other commands
                    self._mark_command_completed(cmd_id, result, deployment_id)
            else:
                self.logger.warning(f"No command callback registered, ignoring command {cmd_id}")

        except Exception as e:
            self.logger.error(f"Error processing command {cmd_id}: {e}")
            self._mark_command_failed(cmd_id, str(e), cmd_data.get('deployment_id'))

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
                'updatedAt': firestore.SERVER_TIMESTAMP
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

    def _mark_command_completed(self, cmd_id: str, result: Any, deployment_id: Optional[str] = None):
        """Mark a command as completed in Firestore."""
        if not self.connected or not self.db:
            return

        try:
            # Remove from pending
            pending_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)\
                .collection('commands').document('pending')

            pending_ref.update({
                cmd_id: firestore.DELETE_FIELD
            })

            # Add to completed
            completed_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)\
                .collection('commands').document('completed')

            # Build the completed command data
            completed_data = {
                'result': result,
                'status': 'completed',
                'completedAt': firestore.SERVER_TIMESTAMP
            }

            # Include deployment_id if present (needed for web app to track deployment status)
            if deployment_id:
                completed_data['deployment_id'] = deployment_id

            completed_ref.set({
                cmd_id: completed_data
            }, merge=True)

            self.logger.info(f"Command {cmd_id} marked as completed")

        except Exception as e:
            self.logger.error(f"Failed to mark command {cmd_id} as completed: {e}")

    def _mark_command_failed(self, cmd_id: str, error: str, deployment_id: Optional[str] = None):
        """Mark a command as failed in Firestore."""
        if not self.connected or not self.db:
            return

        try:
            # Remove from pending
            pending_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)\
                .collection('commands').document('pending')

            pending_ref.update({
                cmd_id: firestore.DELETE_FIELD
            })

            # Add to completed with error
            completed_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)\
                .collection('commands').document('completed')

            # Build the failed command data
            failed_data = {
                'error': error,
                'status': 'failed',
                'completedAt': firestore.SERVER_TIMESTAMP
            }

            # Include deployment_id if present (needed for web app to track deployment status)
            if deployment_id:
                failed_data['deployment_id'] = deployment_id

            completed_ref.set({
                cmd_id: failed_data
            }, merge=True)

            self.logger.error(f"Command {cmd_id} marked as failed: {error}")

        except Exception as e:
            self.logger.error(f"Failed to mark command {cmd_id} as failed: {e}")

    def _mark_command_cancelled(self, cmd_id: str, result: str, deployment_id: Optional[str] = None):
        """Mark a command as cancelled in Firestore."""
        if not self.connected or not self.db:
            return

        try:
            # Remove from pending
            pending_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)\
                .collection('commands').document('pending')

            pending_ref.update({
                cmd_id: firestore.DELETE_FIELD
            })

            # Add to completed with cancelled status
            completed_ref = self.db.collection('sites').document(self.site_id)\
                .collection('machines').document(self.machine_id)\
                .collection('commands').document('completed')

            # Build the cancelled command data
            cancelled_data = {
                'result': result,
                'status': 'cancelled',
                'completedAt': firestore.SERVER_TIMESTAMP
            }

            # Include deployment_id if present (needed for web app to track deployment status)
            if deployment_id:
                cancelled_data['deployment_id'] = deployment_id

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
            self.logger.info("Config uploaded to Firestore successfully")

            # Also cache it locally
            self._save_cached_config(config)
            self.cached_config = config

        except Exception as e:
            self.logger.error(f"Failed to upload config to Firestore: {e}")

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
