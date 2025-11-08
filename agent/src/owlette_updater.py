#!/usr/bin/env python3
"""
Owlette Bootstrap Updater
==========================

This script runs OUTSIDE the Owlette service to perform self-updates.
It handles the service replacement process that cannot be done while the service is running.

Flow:
1. Stop Owlette service
2. Download new installer
3. Run installer silently
4. Installer will start new service automatically
5. Clean up and exit

Usage:
    python owlette_updater.py <installer_url> [--log-path <path>]
"""

import sys
import os
import time
import subprocess
import argparse
import logging
from pathlib import Path
from typing import Optional
import urllib.request
import urllib.error

# Constants
NSSM_PATH = r"C:\Owlette\tools\nssm.exe"
SERVICE_NAME = "OwletteService"
DEFAULT_LOG_DIR = r"C:\ProgramData\Owlette\logs"
DEFAULT_LOG_FILE = "owlette_updater.log"
TEMP_INSTALLER_NAME = "Owlette-Update.exe"
DOWNLOAD_TIMEOUT = 300  # 5 minutes
INSTALL_TIMEOUT = 300    # 5 minutes
SERVICE_STOP_WAIT = 5    # seconds
SERVICE_START_WAIT = 10  # seconds


def setup_logging(log_path: Optional[str] = None) -> logging.Logger:
    """Configure logging for the updater"""
    if log_path is None:
        os.makedirs(DEFAULT_LOG_DIR, exist_ok=True)
        log_path = os.path.join(DEFAULT_LOG_DIR, DEFAULT_LOG_FILE)

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_path, encoding='utf-8'),
            logging.StreamHandler(sys.stdout)
        ]
    )

    logger = logging.getLogger('OwletteUpdater')
    logger.info("="*60)
    logger.info("Owlette Bootstrap Updater Started")
    logger.info("="*60)

    return logger


def check_admin_privileges() -> bool:
    """Check if running with admin privileges"""
    try:
        import ctypes
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False


def stop_service(logger: logging.Logger) -> bool:
    """Stop the Owlette service using NSSM"""
    logger.info(f"Stopping {SERVICE_NAME}...")

    if not os.path.exists(NSSM_PATH):
        logger.error(f"NSSM not found at {NSSM_PATH}")
        logger.error("Cannot stop service without NSSM")
        return False

    try:
        # Check if service exists and is running
        status_result = subprocess.run(
            [NSSM_PATH, 'status', SERVICE_NAME],
            capture_output=True,
            text=True,
            timeout=10
        )

        if status_result.returncode != 0:
            logger.warning(f"Service status check failed: {status_result.stderr}")
            logger.info("Service may not be installed or already stopped")
            return True

        service_status = status_result.stdout.strip()
        logger.info(f"Service status: {service_status}")

        if service_status == "SERVICE_STOPPED":
            logger.info("Service is already stopped")
            return True

        # Stop the service
        stop_result = subprocess.run(
            [NSSM_PATH, 'stop', SERVICE_NAME],
            capture_output=True,
            text=True,
            timeout=30
        )

        if stop_result.returncode != 0:
            logger.error(f"Failed to stop service: {stop_result.stderr}")
            return False

        logger.info(f"Service stop command sent. Waiting {SERVICE_STOP_WAIT} seconds...")
        time.sleep(SERVICE_STOP_WAIT)

        # Verify service stopped
        verify_result = subprocess.run(
            [NSSM_PATH, 'status', SERVICE_NAME],
            capture_output=True,
            text=True,
            timeout=10
        )

        if verify_result.returncode == 0:
            status = verify_result.stdout.strip()
            if status == "SERVICE_STOPPED":
                logger.info("Service stopped successfully")
                return True
            else:
                logger.warning(f"Service status after stop: {status}")
                logger.info("Proceeding anyway...")
                return True
        else:
            logger.info("Service appears to be stopped")
            return True

    except subprocess.TimeoutExpired:
        logger.error("Timeout while stopping service")
        return False
    except Exception as e:
        logger.error(f"Error stopping service: {e}")
        return False


def download_installer(url: str, logger: logging.Logger) -> Optional[str]:
    """Download installer from URL to temp location (or use local file if path provided)"""
    temp_dir = os.environ.get('TEMP', r'C:\Windows\Temp')
    temp_path = os.path.join(temp_dir, TEMP_INSTALLER_NAME)

    # Check if "URL" is actually a local file path (backwards compatibility)
    if os.path.isfile(url) or url.startswith('file:///'):
        # Handle file:// URLs
        if url.startswith('file:///'):
            local_path = url.replace('file:///', '').replace('/', os.sep)
        else:
            local_path = url

        logger.info(f"Local installer path provided: {local_path}")

        if os.path.exists(local_path):
            logger.info(f"Using existing installer at: {local_path}")
            # If it's already in the temp location, just return it
            if os.path.abspath(local_path) == os.path.abspath(temp_path):
                logger.info("Installer is already in temp location")
                return local_path
            else:
                # Copy to standard temp location for consistency
                logger.info(f"Copying installer to: {temp_path}")
                try:
                    import shutil
                    shutil.copy2(local_path, temp_path)
                    file_size = os.path.getsize(temp_path)
                    logger.info(f"Copy complete. File size: {file_size:,} bytes")
                    return temp_path
                except Exception as e:
                    logger.error(f"Failed to copy installer: {e}")
                    # Fall back to using original path
                    return local_path
        else:
            logger.error(f"Local installer path does not exist: {local_path}")
            return None

    # Normal URL download
    logger.info(f"Downloading installer from: {url}")
    logger.info(f"Destination: {temp_path}")

    try:
        # Remove existing file if present
        if os.path.exists(temp_path):
            logger.info("Removing existing installer file")
            os.remove(temp_path)

        # Download with progress
        def download_progress(block_num, block_size, total_size):
            if total_size > 0:
                percent = (block_num * block_size / total_size) * 100
                if block_num % 100 == 0:  # Log every 100 blocks
                    logger.info(f"Download progress: {percent:.1f}%")

        logger.info("Starting download...")
        urllib.request.urlretrieve(url, temp_path, reporthook=download_progress)

        # Verify file exists and has size
        if os.path.exists(temp_path):
            file_size = os.path.getsize(temp_path)
            logger.info(f"Download complete. File size: {file_size:,} bytes")

            if file_size < 1000:  # Less than 1KB is suspicious
                logger.error(f"Downloaded file is too small ({file_size} bytes)")
                return None

            return temp_path
        else:
            logger.error("Downloaded file does not exist")
            return None

    except urllib.error.URLError as e:
        logger.error(f"Network error downloading installer: {e}")
        return None
    except Exception as e:
        logger.error(f"Error downloading installer: {e}")
        return None


def run_installer(installer_path: str, logger: logging.Logger) -> bool:
    """Run the installer silently"""
    logger.info(f"Running installer: {installer_path}")

    # Build command with silent flags
    # /ALLUSERS ensures no installation mode prompt (even when run as SYSTEM)
    command = [
        installer_path,
        '/VERYSILENT',
        '/NORESTART',
        '/SUPPRESSMSGBOXES',
        '/ALLUSERS'
    ]

    logger.info(f"Command: {' '.join(command)}")

    try:
        logger.info("Starting installer process...")
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=INSTALL_TIMEOUT
        )

        logger.info(f"Installer exit code: {result.returncode}")

        if result.stdout:
            logger.info(f"Installer stdout: {result.stdout}")
        if result.stderr:
            logger.warning(f"Installer stderr: {result.stderr}")

        if result.returncode == 0:
            logger.info("Installer completed successfully")
            return True
        else:
            logger.error(f"Installer failed with exit code {result.returncode}")
            return False

    except subprocess.TimeoutExpired:
        logger.error(f"Installer timed out after {INSTALL_TIMEOUT} seconds")
        return False
    except Exception as e:
        logger.error(f"Error running installer: {e}")
        return False


def cleanup_installer(installer_path: str, logger: logging.Logger) -> None:
    """Remove temporary installer file"""
    try:
        if os.path.exists(installer_path):
            logger.info(f"Cleaning up installer: {installer_path}")
            os.remove(installer_path)
            logger.info("Cleanup complete")
    except Exception as e:
        logger.warning(f"Failed to cleanup installer: {e}")


def attempt_service_restart(logger: logging.Logger) -> bool:
    """Attempt to restart the service if installer didn't"""
    logger.info("Attempting to restart service...")

    if not os.path.exists(NSSM_PATH):
        logger.error(f"NSSM not found at {NSSM_PATH}")
        return False

    try:
        # Check current status
        status_result = subprocess.run(
            [NSSM_PATH, 'status', SERVICE_NAME],
            capture_output=True,
            text=True,
            timeout=10
        )

        if status_result.returncode == 0:
            status = status_result.stdout.strip()
            logger.info(f"Service status: {status}")

            if status == "SERVICE_RUNNING":
                logger.info("Service is already running")
                return True

        # Try to start service
        logger.info("Starting service...")
        start_result = subprocess.run(
            [NSSM_PATH, 'start', SERVICE_NAME],
            capture_output=True,
            text=True,
            timeout=30
        )

        if start_result.returncode == 0:
            logger.info(f"Service start command sent. Waiting {SERVICE_START_WAIT} seconds...")
            time.sleep(SERVICE_START_WAIT)

            # Verify service started
            verify_result = subprocess.run(
                [NSSM_PATH, 'status', SERVICE_NAME],
                capture_output=True,
                text=True,
                timeout=10
            )

            if verify_result.returncode == 0:
                status = verify_result.stdout.strip()
                if status == "SERVICE_RUNNING":
                    logger.info("Service started successfully")
                    return True
                else:
                    logger.warning(f"Service status after start: {status}")

        logger.error(f"Failed to start service: {start_result.stderr}")
        return False

    except Exception as e:
        logger.error(f"Error restarting service: {e}")
        return False


def main():
    """Main updater logic"""
    parser = argparse.ArgumentParser(description='Owlette Bootstrap Updater')
    parser.add_argument('installer_url', help='URL of the installer to download')
    parser.add_argument('--log-path', help='Custom log file path', default=None)
    parser.add_argument('--no-restart', action='store_true', help='Do not restart service after install')

    args = parser.parse_args()

    logger = setup_logging(args.log_path)

    # Check admin privileges
    if not check_admin_privileges():
        logger.warning("Not running with administrator privileges")
        logger.warning("Update may fail if elevation is required")

    logger.info(f"Installer URL: {args.installer_url}")

    # Step 1: Stop service
    logger.info("\n" + "="*60)
    logger.info("STEP 1: Stopping Owlette Service")
    logger.info("="*60)

    if not stop_service(logger):
        logger.error("Failed to stop service. Aborting update.")
        logger.info("Manual intervention required")
        return 1

    # Step 2: Download installer
    logger.info("\n" + "="*60)
    logger.info("STEP 2: Downloading Installer")
    logger.info("="*60)

    installer_path = download_installer(args.installer_url, logger)
    if not installer_path:
        logger.error("Failed to download installer. Attempting to restart old service...")
        if not args.no_restart:
            attempt_service_restart(logger)
        return 1

    # Step 3: Run installer
    logger.info("\n" + "="*60)
    logger.info("STEP 3: Running Installer")
    logger.info("="*60)

    install_success = run_installer(installer_path, logger)

    # Step 4: Cleanup
    logger.info("\n" + "="*60)
    logger.info("STEP 4: Cleanup")
    logger.info("="*60)

    cleanup_installer(installer_path, logger)

    # Step 5: Verify service is running
    if install_success:
        logger.info("\n" + "="*60)
        logger.info("STEP 5: Verifying Service")
        logger.info("="*60)

        logger.info(f"Waiting {SERVICE_START_WAIT} seconds for service to start...")
        time.sleep(SERVICE_START_WAIT)

        # Check service status
        if os.path.exists(NSSM_PATH):
            try:
                status_result = subprocess.run(
                    [NSSM_PATH, 'status', SERVICE_NAME],
                    capture_output=True,
                    text=True,
                    timeout=10
                )

                if status_result.returncode == 0:
                    status = status_result.stdout.strip()
                    logger.info(f"Service status: {status}")

                    if status != "SERVICE_RUNNING" and not args.no_restart:
                        logger.warning("Service is not running. Attempting restart...")
                        attempt_service_restart(logger)

            except Exception as e:
                logger.error(f"Error checking service status: {e}")
    else:
        logger.error("Installation failed. Attempting to restart old service...")
        if not args.no_restart:
            attempt_service_restart(logger)
        return 1

    # Done
    logger.info("\n" + "="*60)
    logger.info("UPDATE COMPLETE")
    logger.info("="*60)
    logger.info("Owlette has been updated successfully")
    logger.info("Check service status in Windows Services or dashboard")

    return 0


if __name__ == '__main__':
    try:
        exit_code = main()
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print("\nUpdate cancelled by user")
        sys.exit(1)
    except Exception as e:
        logging.error(f"Unexpected error: {e}", exc_info=True)
        sys.exit(1)
