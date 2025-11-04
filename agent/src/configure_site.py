"""
Owlette Site Configuration - OAuth Flow
Runs during installer to configure Firebase site_id via browser-based OAuth authentication.

This script:
1. Starts an HTTP server on localhost:8765
2. Opens the user's browser to dev.owlette.app/setup (or owlette.app/setup if --url specified)
3. Waits for callback with site_id and registration code
4. Exchanges registration code for OAuth tokens (access + refresh)
5. Stores tokens securely in Windows Credential Manager (not config.json)
6. Writes minimal configuration to config.json (site_id, project_id, api_base)
7. Returns success/failure status

OAuth Flow:
- Registration code (from callback) → Access token + Refresh token (via API)
- Access token: Short-lived (1h), used for Firestore API calls
- Refresh token: Long-lived (30d), stored encrypted, used to get new access tokens

Usage:
    python configure_site.py [--url URL]

    --url URL    Override the setup URL (default: https://owlette.app/setup)
                 Examples:
                   python configure_site.py --url https://dev.owlette.app/setup
                   python configure_site.py --url https://owlette.app/setup
"""

import http.server
import socketserver
import webbrowser
import json
import os
import sys
import time
import argparse
from urllib.parse import urlparse, parse_qs
from pathlib import Path

# Configuration
CALLBACK_PORT = 8765
DEFAULT_URL = "https://owlette.app/setup"
TIMEOUT_SECONDS = 300  # 5 minutes

# Import shared_utils to get ProgramData path
import shared_utils

# Use ProgramData for config (proper Windows location)
CONFIG_PATH = Path(shared_utils.get_data_path('config/config.json'))

# Global state
received_config = None
server_error = None
web_app_url = None  # Set in main(), used in save_config()


class ConfigCallbackHandler(http.server.BaseHTTPRequestHandler):
    """Handles OAuth callback from owlette.app"""

    def do_GET(self):
        global received_config, server_error

        parsed = urlparse(self.path)

        if parsed.path == '/callback':
            params = parse_qs(parsed.query)
            site_id = params.get('site_id', [None])[0]
            registration_code = params.get('token', [None])[0]  # 'token' param contains registration code

            if site_id and registration_code:
                try:
                    # Exchange registration code for OAuth tokens and save configuration
                    self.save_config(site_id, registration_code)
                    received_config = {'site_id': site_id, 'registration_code': registration_code}

                    # Send success response
                    self.send_response(200)
                    self.send_header('Content-type', 'text/html')
                    self.end_headers()

                    success_html = """
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Owlette Configuration Complete</title>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <style>
                            * {
                                margin: 0;
                                padding: 0;
                                box-sizing: border-box;
                            }
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
                                background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
                                color: #e2e8f0;
                                min-height: 100vh;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                padding: 20px;
                            }
                            .container {
                                text-align: center;
                                max-width: 500px;
                            }
                            .logo {
                                font-size: 120px;
                                margin-bottom: 30px;
                                filter: drop-shadow(0 10px 20px rgba(0, 0, 0, 0.3));
                                animation: fadeIn 0.6s ease-out;
                            }
                            h1 {
                                color: #10b981;
                                font-size: 2.5rem;
                                font-weight: 700;
                                margin-bottom: 20px;
                                animation: fadeIn 0.8s ease-out;
                            }
                            .message {
                                color: #cbd5e1;
                                font-size: 1.1rem;
                                line-height: 1.6;
                                margin-bottom: 15px;
                                animation: fadeIn 1s ease-out;
                            }
                            .checkmark {
                                display: inline-block;
                                width: 80px;
                                height: 80px;
                                border-radius: 50%;
                                background: #10b981;
                                position: relative;
                                margin: 20px auto 30px;
                                animation: scaleIn 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
                            }
                            .checkmark::after {
                                content: '✓';
                                position: absolute;
                                top: 50%;
                                left: 50%;
                                transform: translate(-50%, -50%);
                                color: white;
                                font-size: 48px;
                                font-weight: bold;
                            }
                            @keyframes fadeIn {
                                from {
                                    opacity: 0;
                                    transform: translateY(20px);
                                }
                                to {
                                    opacity: 1;
                                    transform: translateY(0);
                                }
                            }
                            @keyframes scaleIn {
                                from {
                                    opacity: 0;
                                    transform: scale(0);
                                }
                                to {
                                    opacity: 1;
                                    transform: scale(1);
                                }
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="logo">🦉</div>
                            <div class="checkmark"></div>
                            <h1>Configuration Complete!</h1>
                            <p class="message">Your Owlette agent has been configured successfully.</p>
                            <p class="message">You can close this window and return to the installer.</p>
                        </div>
                    </body>
                    </html>
                    """
                    self.wfile.write(success_html.encode('utf-8'))

                except Exception as e:
                    server_error = str(e)
                    self.send_error(500, f"Configuration error: {e}")
            else:
                server_error = "Missing site_id or registration_code in callback"
                self.send_error(400, server_error)

        elif parsed.path == '/health':
            # Health check endpoint
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'OK')
        else:
            self.send_error(404)

    def save_config(self, site_id, registration_code):
        """
        Exchange registration code for OAuth tokens and save configuration.

        Args:
            site_id: Site ID from OAuth callback
            registration_code: Registration code to exchange for tokens
        """
        # Ensure config directory exists
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

        # Import auth_manager here to avoid import errors if not installed
        sys.path.insert(0, str(SCRIPT_DIR))
        from auth_manager import AuthManager, AuthenticationError

        # Determine API base URL from setup URL
        # If using dev.owlette.app, use dev API. Otherwise production API.
        global web_app_url
        # Use the global web_app_url set in main(), or fall back to env var + default
        url_to_check = web_app_url or os.environ.get("OWLETTE_SETUP_URL", DEFAULT_URL)
        if 'dev.owlette.app' in url_to_check:
            api_base = "https://dev.owlette.app/api"
            project_id = "owlette-dev-3838a"
        else:
            api_base = "https://owlette.app/api"
            project_id = "owlette-prod"  # Update this with actual prod project ID

        print(f"  API Base: {api_base}")
        print(f"  Project ID: {project_id}")
        print()
        print("Exchanging registration code for OAuth tokens...")

        # Write debug info to file for troubleshooting (APPEND, don't overwrite)
        debug_log = CONFIG_PATH.parent / "oauth_debug.log"
        with open(debug_log, 'a') as f:
            f.write(f"\nOAuth Exchange Debug\n")
            f.write(f"====================\n")
            f.write(f"API Base: {api_base}\n")
            f.write(f"Project ID: {project_id}\n")
            f.write(f"Site ID: {site_id}\n")
            f.write(f"Registration Code: {registration_code[:20]}...\n\n")

        # Initialize auth manager
        auth_manager = AuthManager(api_base=api_base)

        try:
            # Exchange registration code for access + refresh tokens
            success = auth_manager.exchange_registration_code(registration_code)

            if not success:
                raise Exception("Token exchange returned False")

            print("✓ OAuth tokens received and stored securely")
            print("  - Access token: Valid for 1 hour")
            print("  - Refresh token: Valid for 30 days (stored in Windows Credential Manager)")

        except AuthenticationError as e:
            raise Exception(f"OAuth authentication failed: {e}")
        except Exception as e:
            raise Exception(f"Failed to exchange registration code: {e}")

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
        config['firebase']['project_id'] = project_id
        config['firebase']['api_base'] = api_base

        # DO NOT store tokens in config.json - they are in Windows Credential Manager
        # Remove old token field if it exists (from previous versions)
        if 'token' in config['firebase']:
            del config['firebase']['token']

        # Write updated config
        with open(CONFIG_PATH, 'w') as f:
            json.dump(config, f, indent=2)

        print()
        print(f"✓ Configuration saved to {CONFIG_PATH}")
        print(f"  Site ID: {site_id}")
        print(f"  Project ID: {project_id}")
        print(f"  API Base: {api_base}")

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
    global received_config, server_error, web_app_url

    # Parse command-line arguments
    parser = argparse.ArgumentParser(description='Owlette Site Configuration')
    parser.add_argument('--url', type=str, default=DEFAULT_URL,
                       help='Setup URL (default: https://owlette.app/setup)')
    args = parser.parse_args()

    # Use provided URL or environment variable override (set global for save_config())
    web_app_url = os.environ.get("OWLETTE_SETUP_URL", args.url)

    # Write command line args to debug log FIRST
    debug_log = CONFIG_PATH.parent / "oauth_debug.log"
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(debug_log, 'w') as f:
        f.write(f"Command Line Debug\n")
        f.write(f"==================\n")
        f.write(f"DEFAULT_URL constant: {DEFAULT_URL}\n")
        f.write(f"--url argument received: {args.url}\n")
        f.write(f"OWLETTE_SETUP_URL env var: {os.environ.get('OWLETTE_SETUP_URL', 'NOT SET')}\n")
        f.write(f"Final web_app_url: {web_app_url}\n\n")

    print("=" * 60)
    print("Owlette Site Configuration")
    print("=" * 60)
    print(f"Setup URL: {web_app_url}")
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
            setup_url = f"{web_app_url}?callback_port={CALLBACK_PORT}"
            print(f"Opening browser to: {web_app_url}")
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
