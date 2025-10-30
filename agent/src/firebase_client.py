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
        else:
            self.logger.warning("Command listener NOT started (offline mode)")

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
                    metrics = get_system_metrics()
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

    def _update_presence(self, online: bool):
        """Update machine presence/heartbeat in Firestore."""
        if not self.connected or not self.db:
            return

        presence_ref = self.db.collection('sites').document(self.site_id)\
            .collection('machines').document(self.machine_id)\
            .collection('presence').document('status')

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

        status_ref = self.db.collection('sites').document(self.site_id)\
            .collection('machines').document(self.machine_id)\
            .collection('status').document('current')

        status_ref.set({
            'cpu': metrics.get('cpu', 0),
            'memory': metrics.get('memory', 0),
            'disk': metrics.get('disk', 0),
            'gpu': metrics.get('gpu', 0),
            'timestamp': firestore.SERVER_TIMESTAMP,
            'processes': metrics.get('processes', {})
        }, merge=True)

    def _process_command(self, cmd_id: str, cmd_data: Dict[str, Any]):
        """Process a command received from Firestore."""
        try:
            self.logger.info(f"Processing command: {cmd_id} - Type: {cmd_data.get('type')}")

            # Call the registered callback
            if self.command_callback:
                result = self.command_callback(cmd_id, cmd_data)
                self._mark_command_completed(cmd_id, result)
            else:
                self.logger.warning(f"No command callback registered, ignoring command {cmd_id}")

        except Exception as e:
            self.logger.error(f"Error processing command {cmd_id}: {e}")
            self._mark_command_failed(cmd_id, str(e))

    def _mark_command_completed(self, cmd_id: str, result: Any):
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

            completed_ref.set({
                cmd_id: {
                    'result': result,
                    'status': 'completed',
                    'completedAt': firestore.SERVER_TIMESTAMP
                }
            }, merge=True)

            self.logger.info(f"Command {cmd_id} marked as completed")

        except Exception as e:
            self.logger.error(f"Failed to mark command {cmd_id} as completed: {e}")

    def _mark_command_failed(self, cmd_id: str, error: str):
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

            completed_ref.set({
                cmd_id: {
                    'error': error,
                    'status': 'failed',
                    'completedAt': firestore.SERVER_TIMESTAMP
                }
            }, merge=True)

            self.logger.error(f"Command {cmd_id} marked as failed: {error}")

        except Exception as e:
            self.logger.error(f"Failed to mark command {cmd_id} as failed: {e}")

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

    def _try_reconnect(self):
        """Try to reconnect to Firestore."""
        try:
            self.logger.info("Attempting to reconnect to Firestore...")
            self._initialize_firebase()
            if self.connected:
                self.logger.info("Reconnected to Firestore successfully")
                # Restart command listener if needed
                if not self.command_listener_thread or not self.command_listener_thread.is_alive():
                    self.command_listener_thread = threading.Thread(target=self._command_listener_loop, daemon=True)
                    self.command_listener_thread.start()
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
