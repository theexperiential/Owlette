"""
Installer utilities for downloading and executing software installers.
"""

import os
import logging
import subprocess
import tempfile
import requests
import psutil
import hashlib
from typing import Optional, Callable, Dict


def download_file(url: str, dest_path: str, progress_callback: Optional[Callable[[int], None]] = None) -> bool:
    """
    Download a file from a URL with progress tracking.

    Args:
        url: URL to download from
        dest_path: Destination file path
        progress_callback: Optional callback function that receives progress percentage (0-100)

    Returns:
        True if download succeeded, False otherwise
    """
    try:
        logging.info(f"Starting download from {url}")

        # Stream the download to avoid loading entire file into memory
        response = requests.get(url, stream=True, timeout=30)
        response.raise_for_status()

        total_size = int(response.headers.get('content-length', 0))
        downloaded_size = 0

        # Create destination directory if it doesn't exist
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)

        with open(dest_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded_size += len(chunk)

                    # Report progress
                    if total_size > 0 and progress_callback:
                        progress = int((downloaded_size / total_size) * 100)
                        progress_callback(progress)

        logging.info(f"Download completed: {dest_path} ({downloaded_size} bytes)")
        return True

    except requests.exceptions.RequestException as e:
        logging.error(f"Download failed: {e}")
        return False
    except Exception as e:
        logging.error(f"Unexpected error during download: {e}")
        return False


def execute_installer(
    installer_path: str,
    flags: str = "",
    installer_name: str = "",
    active_processes: Optional[Dict[str, subprocess.Popen]] = None,
    timeout_seconds: int = 1200
) -> tuple[bool, int, str]:
    """
    Execute an installer with silent flags.

    Args:
        installer_path: Path to the installer executable
        flags: Silent installation flags (e.g., "/VERYSILENT /DIR=C:\\Program")
        installer_name: Name of the installer (for tracking cancellable processes)
        active_processes: Dictionary to track active installations (for cancellation)
        timeout_seconds: Maximum time to wait for installation (default: 600 seconds / 10 minutes)

    Returns:
        Tuple of (success, exit_code, error_message)
        - success: True if exit code was 0, False otherwise
        - exit_code: The installer's exit code
        - error_message: Error message if failed, empty string otherwise
    """
    try:
        if not os.path.exists(installer_path):
            error_msg = f"Installer not found: {installer_path}"
            logging.error(error_msg)
            return False, -1, error_msg

        # Build command
        command = f'"{installer_path}"'
        if flags:
            command += f" {flags}"

        logging.info(f"Executing installer: {command}")

        # Use Popen instead of run so we can track and cancel the process
        process = subprocess.Popen(
            command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # Track process for potential cancellation
        if active_processes is not None and installer_name:
            active_processes[installer_name] = process
            logging.info(f"Tracking installer process: {installer_name} (PID: {process.pid})")

        # Wait for installation to complete (configurable timeout)
        try:
            stdout, stderr = process.communicate(timeout=timeout_seconds)
            exit_code = process.returncode
        except subprocess.TimeoutExpired:
            process.kill()
            if active_processes and installer_name in active_processes:
                del active_processes[installer_name]
            error_msg = f"Installer execution timeout (exceeded {timeout_seconds} seconds)"
            logging.error(error_msg)
            return False, -1, error_msg

        # Remove from active processes once complete
        if active_processes and installer_name in active_processes:
            del active_processes[installer_name]

        logging.info(f"Installer exit code: {exit_code}")

        if exit_code == 0:
            return True, exit_code, ""
        else:
            error_msg = f"Installer failed with exit code {exit_code}"
            if stderr:
                error_msg += f": {stderr}"
            logging.error(error_msg)
            return False, exit_code, error_msg

    except Exception as e:
        # Clean up tracking if error occurs
        if active_processes and installer_name in active_processes:
            del active_processes[installer_name]
        error_msg = f"Unexpected error executing installer: {e}"
        logging.error(error_msg)
        return False, -1, error_msg


def verify_checksum(file_path: str, expected_sha256: str) -> bool:
    """
    Verify the SHA256 checksum of a downloaded file.

    Args:
        file_path: Path to the file to verify
        expected_sha256: Expected SHA256 hash (case-insensitive)

    Returns:
        True if checksum matches, False otherwise
    """
    try:
        sha256_hash = hashlib.sha256()

        # Read file in chunks to handle large files efficiently
        with open(file_path, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                sha256_hash.update(chunk)

        actual_hash = sha256_hash.hexdigest().lower()
        expected_hash = expected_sha256.lower()

        if actual_hash == expected_hash:
            logging.info(f"Checksum verification passed: {actual_hash}")
            return True
        else:
            logging.error(f"Checksum verification FAILED!")
            logging.error(f"Expected: {expected_hash}")
            logging.error(f"Actual:   {actual_hash}")
            return False

    except Exception as e:
        logging.error(f"Error verifying checksum: {e}")
        return False


def verify_installation(path: str) -> bool:
    """
    Verify that an installation succeeded by checking if a file exists.

    Args:
        path: Path to the installed executable or file

    Returns:
        True if file exists, False otherwise
    """
    exists = os.path.exists(path)
    if exists:
        logging.info(f"Installation verified: {path} exists")
    else:
        logging.warning(f"Installation verification failed: {path} not found")
    return exists


def get_temp_installer_path(installer_name: str) -> str:
    """
    Generate a temporary path for downloading an installer.

    Args:
        installer_name: Name of the installer (e.g., "TouchDesigner.exe")

    Returns:
        Full path to temporary installer location
    """
    temp_dir = tempfile.gettempdir()
    owlette_temp = os.path.join(temp_dir, "owlette_installers")
    os.makedirs(owlette_temp, exist_ok=True)
    return os.path.join(owlette_temp, installer_name)


def cleanup_installer(installer_path: str) -> bool:
    """
    Remove a temporary installer file after installation.

    Args:
        installer_path: Path to the installer file

    Returns:
        True if cleanup succeeded, False otherwise
    """
    try:
        if os.path.exists(installer_path):
            os.remove(installer_path)
            logging.info(f"Cleaned up installer: {installer_path}")
            return True
        return False
    except Exception as e:
        logging.warning(f"Failed to cleanup installer {installer_path}: {e}")
        return False


def cancel_installation(installer_name: str, active_processes: Dict[str, subprocess.Popen]) -> tuple[bool, str]:
    """
    Cancel an active installation by killing the installer process.

    Args:
        installer_name: Name of the installer being cancelled
        active_processes: Dictionary mapping installer names to Popen processes

    Returns:
        Tuple of (success, message)
    """
    try:
        if installer_name not in active_processes:
            return False, f"No active installation found for {installer_name}"

        process = active_processes[installer_name]

        # Kill the installer process
        logging.info(f"Cancelling installation: {installer_name} (PID: {process.pid})")

        # Try graceful termination first
        try:
            parent = psutil.Process(process.pid)
            # Kill all child processes too
            children = parent.children(recursive=True)
            for child in children:
                logging.info(f"Terminating child process: {child.pid}")
                child.terminate()
            parent.terminate()

            # Wait up to 3 seconds for termination
            gone, alive = psutil.wait_procs([parent] + children, timeout=3)

            # Force kill if still alive
            for p in alive:
                logging.warning(f"Force killing process: {p.pid}")
                p.kill()

        except psutil.NoSuchProcess:
            # Process already terminated
            pass

        # Remove from active processes
        del active_processes[installer_name]

        # Cleanup installer file
        installer_path = get_temp_installer_path(installer_name)
        cleanup_installer(installer_path)

        logging.info(f"Installation cancelled successfully: {installer_name}")
        return True, f"Installation cancelled: {installer_name}"

    except Exception as e:
        error_msg = f"Error cancelling installation: {str(e)}"
        logging.error(error_msg)
        return False, error_msg
