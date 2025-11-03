"""
Secure Token Storage for Owlette Agent

This module provides secure storage for OAuth tokens using the system keyring.
On Windows, this uses Windows Credential Manager (DPAPI).

Security Features:
- Tokens encrypted using system keyring (Windows Credential Manager on Windows)
- Tokens tied to machine and user account
- Cannot be decrypted on different machine or by different user
- Automatic cleanup of expired tokens

Usage:
    storage = SecureStorage()
    storage.save_refresh_token("abc123...")
    token = storage.get_refresh_token()
    storage.clear_tokens()  # Remove all stored tokens
"""

import keyring
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Keyring namespace for Owlette tokens
KEYRING_SERVICE = "Owlette"
REFRESH_TOKEN_KEY = "AgentRefreshToken"
SITE_ID_KEY = "AgentSiteId"
ACCESS_TOKEN_KEY = "AgentAccessToken"  # Cache current access token
TOKEN_EXPIRY_KEY = "AgentTokenExpiry"  # Timestamp when access token expires


class SecureStorage:
    """
    Secure storage for agent authentication tokens.

    Uses system keyring (Windows Credential Manager on Windows) to securely
    store tokens with encryption tied to the machine and user account.
    """

    def __init__(self, service_name: str = KEYRING_SERVICE):
        """
        Initialize secure storage.

        Args:
            service_name: Keyring service name (default: "Owlette")
        """
        self.service_name = service_name
        logger.debug(f"SecureStorage initialized with service: {service_name}")

    def save_refresh_token(self, token: str) -> bool:
        """
        Save refresh token to secure storage.

        Args:
            token: Refresh token from OAuth exchange

        Returns:
            True if saved successfully, False otherwise
        """
        try:
            keyring.set_password(self.service_name, REFRESH_TOKEN_KEY, token)
            logger.info("Refresh token saved to secure storage")
            return True
        except Exception as e:
            logger.error(f"Failed to save refresh token: {e}")
            return False

    def get_refresh_token(self) -> Optional[str]:
        """
        Retrieve refresh token from secure storage.

        Returns:
            Refresh token if found, None otherwise
        """
        try:
            token = keyring.get_password(self.service_name, REFRESH_TOKEN_KEY)
            if token:
                logger.debug("Refresh token retrieved from secure storage")
            else:
                logger.debug("No refresh token found in secure storage")
            return token
        except Exception as e:
            logger.error(f"Failed to retrieve refresh token: {e}")
            return None

    def save_access_token(self, token: str, expiry_timestamp: float) -> bool:
        """
        Save access token and expiry to secure storage (cache).

        Args:
            token: Access token (Firebase custom token)
            expiry_timestamp: Unix timestamp when token expires

        Returns:
            True if saved successfully, False otherwise
        """
        try:
            keyring.set_password(self.service_name, ACCESS_TOKEN_KEY, token)
            keyring.set_password(self.service_name, TOKEN_EXPIRY_KEY, str(expiry_timestamp))
            logger.debug("Access token cached in secure storage")
            return True
        except Exception as e:
            logger.error(f"Failed to cache access token: {e}")
            return False

    def get_access_token(self) -> tuple[Optional[str], Optional[float]]:
        """
        Retrieve cached access token and expiry from secure storage.

        Returns:
            Tuple of (access_token, expiry_timestamp). Both None if not found.
        """
        try:
            token = keyring.get_password(self.service_name, ACCESS_TOKEN_KEY)
            expiry_str = keyring.get_password(self.service_name, TOKEN_EXPIRY_KEY)

            if token and expiry_str:
                try:
                    expiry = float(expiry_str)
                    logger.debug("Access token retrieved from cache")
                    return (token, expiry)
                except ValueError:
                    logger.warning("Invalid expiry timestamp in cache")
                    return (None, None)
            else:
                logger.debug("No cached access token found")
                return (None, None)
        except Exception as e:
            logger.error(f"Failed to retrieve access token: {e}")
            return (None, None)

    def save_site_id(self, site_id: str) -> bool:
        """
        Save site ID to secure storage.

        Args:
            site_id: Site ID from OAuth exchange

        Returns:
            True if saved successfully, False otherwise
        """
        try:
            keyring.set_password(self.service_name, SITE_ID_KEY, site_id)
            logger.info(f"Site ID saved to secure storage: {site_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to save site ID: {e}")
            return False

    def get_site_id(self) -> Optional[str]:
        """
        Retrieve site ID from secure storage.

        Returns:
            Site ID if found, None otherwise
        """
        try:
            site_id = keyring.get_password(self.service_name, SITE_ID_KEY)
            if site_id:
                logger.debug(f"Site ID retrieved from secure storage: {site_id}")
            else:
                logger.debug("No site ID found in secure storage")
            return site_id
        except Exception as e:
            logger.error(f"Failed to retrieve site ID: {e}")
            return None

    def clear_tokens(self) -> bool:
        """
        Clear all stored tokens from secure storage.

        This should be called when:
        - User wants to reconfigure the agent
        - Tokens are revoked by admin
        - Machine is being decommissioned

        Returns:
            True if cleared successfully, False otherwise
        """
        try:
            # Delete all stored credentials
            for key in [REFRESH_TOKEN_KEY, SITE_ID_KEY, ACCESS_TOKEN_KEY, TOKEN_EXPIRY_KEY]:
                try:
                    keyring.delete_password(self.service_name, key)
                except keyring.errors.PasswordDeleteError:
                    # Key doesn't exist, ignore
                    pass

            logger.info("All tokens cleared from secure storage")
            return True
        except Exception as e:
            logger.error(f"Failed to clear tokens: {e}")
            return False

    def has_refresh_token(self) -> bool:
        """
        Check if a refresh token exists in storage.

        Returns:
            True if refresh token exists, False otherwise
        """
        token = self.get_refresh_token()
        return token is not None and len(token) > 0

    def is_configured(self) -> bool:
        """
        Check if agent is configured with valid credentials.

        Returns:
            True if both refresh token and site ID are stored, False otherwise
        """
        has_token = self.has_refresh_token()
        has_site = self.get_site_id() is not None
        return has_token and has_site


# Singleton instance for easy access
_storage_instance = None


def get_storage() -> SecureStorage:
    """
    Get singleton SecureStorage instance.

    Returns:
        SecureStorage instance
    """
    global _storage_instance
    if _storage_instance is None:
        _storage_instance = SecureStorage()
    return _storage_instance
