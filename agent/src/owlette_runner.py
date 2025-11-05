"""
Owlette Service Runner - NSSM Compatible
Runs the service main loop without Windows Service framework
"""
import sys
import os
import datetime
import logging
import time
import signal

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shared_utils

# Global reference to service instance for signal handler
_service_instance = None

def signal_handler(signum, frame):
    """Handle Ctrl+C and other termination signals from NSSM"""
    global _service_instance
    logging.info(f"Received signal {signum} - initiating graceful shutdown...")
    if _service_instance and hasattr(_service_instance, 'is_alive'):
        _service_instance.is_alive = False
        logging.info("is_alive set to False - main loop will exit")
    else:
        logging.warning("service_instance not available for graceful shutdown")
        sys.exit(0)

# Initialize Firebase and Auth imports
FIREBASE_AVAILABLE = False
FIREBASE_IMPORT_ERROR = None
try:
    from firebase_client import FirebaseClient
    from auth_manager import AuthManager
    FIREBASE_AVAILABLE = True
except ImportError as e:
    FIREBASE_IMPORT_ERROR = str(e)

if __name__ == '__main__':
    # Initialize logging
    shared_utils.initialize_logging("service")

    logging.info("="*70)
    logging.info("OWLETTE SERVICE STARTING (NSSM MODE)")
    logging.info("="*70)

    # Import the OwletteService class just to access its main() method
    from owlette_service import OwletteService

    # Create a minimal mock service object with just what main() needs
    class MockService:
        def __init__(self):
            # Initialize results file if it doesn't exist
            import os
            if not os.path.exists(shared_utils.RESULT_FILE_PATH):
                from owlette_service import Util
                Util.initialize_results_file()
                logging.info("Initialized new app_states.json file")

            # Upgrade config to latest version
            logging.info(f"Config path: {shared_utils.CONFIG_PATH}")
            shared_utils.upgrade_config()

            # Initialize all attributes from OwletteService.__init__
            self.is_alive = True
            self.tray_icon_pid = None
            self.relaunch_attempts = {}
            self.first_start = True
            self.last_started = {}
            self.config = shared_utils.load_config()
            self.processes = []
            self.app_states = {}
            self.results = {}
            self.current_time = datetime.datetime.now()
            self.active_installations = {}

            # Initialize Firebase client
            self.firebase_client = None
            logging.info(f"Firebase check - Available: {FIREBASE_AVAILABLE}")

            if not FIREBASE_AVAILABLE and FIREBASE_IMPORT_ERROR:
                logging.warning(f"Firebase client not available - Import error: {FIREBASE_IMPORT_ERROR}")
                logging.warning("Running in local-only mode")

            if FIREBASE_AVAILABLE:
                firebase_enabled = shared_utils.read_config(['firebase', 'enabled'])
                logging.info(f"Firebase config - enabled: {firebase_enabled}")

                if firebase_enabled:
                    try:
                        site_id = shared_utils.read_config(['firebase', 'site_id'])
                        project_id = shared_utils.read_config(['firebase', 'project_id'])
                        api_base = shared_utils.read_config(['firebase', 'api_base'])
                        cache_path = shared_utils.get_data_path('cache/firebase_cache.json')

                        logging.info(f"Firebase config - site_id: {site_id}, project_id: {project_id}")
                        logging.info(f"Firebase API base: {api_base}")

                        # Initialize AuthManager
                        auth_manager = AuthManager(api_base=api_base)

                        if not auth_manager.is_authenticated():
                            logging.error("Agent not authenticated - no refresh token found in Windows Credential Manager")
                            logging.error("Please run the installer to complete OAuth authentication")
                            self.firebase_client = None
                        else:
                            logging.info("Agent authenticated - OAuth tokens found")
                            self.firebase_client = FirebaseClient(
                                auth_manager=auth_manager,
                                project_id=project_id,
                                site_id=site_id,
                                config_cache_path=cache_path
                            )
                            logging.info(f"Firebase client initialized for site: {site_id}")
                    except Exception as e:
                        logging.error(f"Failed to initialize Firebase client: {e}")
                        logging.exception("Firebase initialization error details:")
                        self.firebase_client = None

            logging.info("Service initialization complete")

    try:
        # Register signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, signal_handler)   # Ctrl+C
        signal.signal(signal.SIGTERM, signal_handler)  # Termination request
        signal.signal(signal.SIGBREAK, signal_handler) # Ctrl+Break (Windows)
        logging.info("Signal handlers registered for graceful shutdown")

        # Create mock service with required attributes
        mock_service = MockService()

        # Borrow the main() method from OwletteService
        # We need to bind it to our mock service instance
        _service_instance = object.__new__(OwletteService)
        _service_instance.__dict__.update(mock_service.__dict__)

        logging.info("Starting main service loop...")
        _service_instance.main()

        # Cleanup before exiting
        logging.info("Main loop exited - performing cleanup...")
        if _service_instance.firebase_client:
            try:
                _service_instance.firebase_client.stop()
                logging.info("Firebase client stopped")
            except Exception as e:
                logging.error(f"Error stopping Firebase client: {e}")

        # Exit cleanly with code 0 when service stops normally
        # This tells NSSM not to restart (configured as AppExit 0 Exit)
        logging.info("Service stopped cleanly")
        sys.exit(0)

    except KeyboardInterrupt:
        logging.info("Service stopped by user (Ctrl+C)")
        sys.exit(0)
    except Exception as e:
        logging.error(f"Service crashed: {e}", exc_info=True)
        sys.exit(1)
