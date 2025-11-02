"""
Owlette Site Configuration - OAuth Flow
Runs during installer to configure Firebase site_id via browser-based authentication.

This script:
1. Starts an HTTP server on localhost:8765
2. Opens the user's browser to dev.owlette.app/setup
3. Waits for callback with site_id and token
4. Writes configuration to config.json
5. Returns success/failure status
"""

import http.server
import socketserver
import webbrowser
import json
import os
import sys
import time
from urllib.parse import urlparse, parse_qs
from pathlib import Path

# Configuration
CALLBACK_PORT = 8765
WEB_APP_URL = os.environ.get("OWLETTE_SETUP_URL", "https://dev.owlette.app/setup")
TIMEOUT_SECONDS = 300  # 5 minutes

# Determine config path relative to script location
SCRIPT_DIR = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR.parent / "config" / "config.json"

# Global state
received_config = None
server_error = None


class ConfigCallbackHandler(http.server.BaseHTTPRequestHandler):
    """Handles OAuth callback from owlette.app"""

    def do_GET(self):
        global received_config, server_error

        parsed = urlparse(self.path)

        if parsed.path == '/callback':
            params = parse_qs(parsed.query)
            site_id = params.get('site_id', [None])[0]
            token = params.get('token', [None])[0]

            if site_id and token:
                try:
                    # Save configuration
                    self.save_config(site_id, token)
                    received_config = {'site_id': site_id, 'token': token}

                    # Send success response
                    self.send_response(200)
                    self.send_header('Content-type', 'text/html')
                    self.end_headers()

                    success_html = """
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Owlette Configuration Complete</title>
                        <style>
                            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                            h1 { color: #4CAF50; }
                            .checkmark { font-size: 100px; color: #4CAF50; }
                        </style>
                    </head>
                    <body>
                        <div class="checkmark">✓</div>
                        <h1>Configuration Complete!</h1>
                        <p>Your Owlette agent has been configured successfully.</p>
                        <p>You can close this window and return to the installer.</p>
                    </body>
                    </html>
                    """
                    self.wfile.write(success_html.encode('utf-8'))

                except Exception as e:
                    server_error = str(e)
                    self.send_error(500, f"Configuration error: {e}")
            else:
                server_error = "Missing site_id or token in callback"
                self.send_error(400, server_error)

        elif parsed.path == '/health':
            # Health check endpoint
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'OK')
        else:
            self.send_error(404)

    def save_config(self, site_id, token):
        """Write site_id and token to config.json"""
        # Ensure config directory exists
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

        # Read existing config or create default
        if CONFIG_PATH.exists():
            with open(CONFIG_PATH, 'r') as f:
                config = json.load(f)
        else:
            config = {
                "_comment": "Owlette Configuration - Edit this file to add processes to monitor",
                "version": "2.0.0",
                "processes": [],
                "logging": {
                    "level": "INFO",
                    "max_age_days": 90,
                    "firebase_shipping": {
                        "enabled": False,
                        "ship_errors_only": True
                    }
                },
                "firebase": {
                    "_comment": "Cloud features: remote control, web dashboard, metrics",
                    "enabled": False,
                    "site_id": ""
                }
            }

        # Update Firebase configuration
        if 'firebase' not in config:
            config['firebase'] = {}

        config['firebase']['enabled'] = True
        config['firebase']['site_id'] = site_id

        # Store token securely (for future API authentication)
        # Note: In production, consider using Windows Credential Manager
        config['firebase']['token'] = token

        # Write updated config
        with open(CONFIG_PATH, 'w') as f:
            json.dump(config, f, indent=2)

        print(f"✓ Configuration saved to {CONFIG_PATH}")
        print(f"  Site ID: {site_id}")

    def log_message(self, format, *args):
        """Suppress HTTP server logs during normal operation"""
        # Only log errors
        if format.startswith('code 4') or format.startswith('code 5'):
            print(f"HTTP Error: {format % args}", file=sys.stderr)


def wait_for_callback(httpd, timeout_seconds):
    """Wait for callback with timeout"""
    global received_config, server_error

    start_time = time.time()

    while received_config is None and server_error is None:
        # Check timeout
        elapsed = time.time() - start_time
        if elapsed > timeout_seconds:
            return False, "Timeout waiting for configuration"

        # Handle one request (non-blocking with timeout)
        httpd.timeout = 1  # 1 second socket timeout
        httpd.handle_request()

    if server_error:
        return False, server_error

    return True, "Configuration received successfully"


def main():
    """Start HTTP server and open browser for OAuth flow"""
    global received_config, server_error

    print("=" * 60)
    print("Owlette Site Configuration")
    print("=" * 60)
    print()

    # Check if already configured
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, 'r') as f:
                config = json.load(f)
                if config.get('firebase', {}).get('enabled') and config.get('firebase', {}).get('site_id'):
                    print(f"⚠ Already configured with site: {config['firebase']['site_id']}")
                    print()
                    response = input("Reconfigure? (y/N): ").strip().lower()
                    if response != 'y':
                        print("Keeping existing configuration.")
                        return 0
        except Exception as e:
            print(f"⚠ Warning: Could not read existing config: {e}")

    # Start HTTP server
    print(f"Starting configuration server on http://localhost:{CALLBACK_PORT}...")

    try:
        with socketserver.TCPServer(("localhost", CALLBACK_PORT), ConfigCallbackHandler) as httpd:
            print(f"✓ Server started successfully")
            print()

            # Open browser to owlette.app
            setup_url = f"{WEB_APP_URL}?callback_port={CALLBACK_PORT}"
            print(f"Opening browser to: {WEB_APP_URL}")
            print()
            print("Please complete the following steps in your browser:")
            print("1. Log in to your Owlette account")
            print("2. Select or create a site")
            print("3. Authorize this agent")
            print()

            if webbrowser.open(setup_url):
                print("✓ Browser opened successfully")
            else:
                print("⚠ Could not open browser automatically")
                print(f"  Please manually navigate to: {setup_url}")

            print()
            print(f"Waiting for configuration (timeout: {TIMEOUT_SECONDS}s)...")
            print("Press Ctrl+C to cancel")
            print()

            # Wait for callback
            success, message = wait_for_callback(httpd, TIMEOUT_SECONDS)

            print()
            if success:
                print("=" * 60)
                print("✓ Configuration Complete!")
                print("=" * 60)
                print()
                print(f"Site ID: {received_config['site_id']}")
                print(f"Config saved to: {CONFIG_PATH}")
                print()
                print("The Owlette service will now be installed and started.")
                return 0
            else:
                print("=" * 60)
                print("✗ Configuration Failed")
                print("=" * 60)
                print()
                print(f"Error: {message}")
                print()
                print("Please try running the installer again.")
                return 1

    except OSError as e:
        if "Address already in use" in str(e):
            print(f"✗ Error: Port {CALLBACK_PORT} is already in use")
            print("  Another instance may be running.")
            print("  Please close it and try again.")
        else:
            print(f"✗ Error starting server: {e}")
        return 1

    except KeyboardInterrupt:
        print()
        print("Configuration cancelled by user.")
        return 1

    except Exception as e:
        print(f"✗ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())
