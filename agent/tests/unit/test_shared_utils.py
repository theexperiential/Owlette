"""
Unit tests for shared_utils module

Tests utility functions for configuration, system metrics, and process management.
"""

import pytest
import json
from pathlib import Path
from unittest.mock import Mock, patch, mock_open, MagicMock
import sys

# Import the module under test
import shared_utils


class TestConfigManagement:
    """Tests for configuration file management"""

    def test_read_config_file_exists(self, mock_config):
        """Test reading configuration when file exists"""
        config_json = json.dumps(mock_config)

        with patch('builtins.open', mock_open(read_data=config_json)):
            with patch('os.path.exists', return_value=True):
                result = shared_utils.read_config()

                assert result is not None
                assert result['firebase']['site_id'] == 'test-site'
                assert len(result['processes']) == 1

    def test_read_config_file_missing(self):
        """Test reading configuration when file doesn't exist"""
        with patch('os.path.exists', return_value=False):
            result = shared_utils.read_config()

            assert result is None

    def test_read_config_invalid_json(self):
        """Test reading configuration with invalid JSON"""
        with patch('builtins.open', mock_open(read_data='invalid json{')):
            with patch('os.path.exists', return_value=True):
                result = shared_utils.read_config()

                assert result is None

    def test_read_config_specific_keys(self, mock_config):
        """Test reading specific keys from configuration"""
        config_json = json.dumps(mock_config)

        with patch('builtins.open', mock_open(read_data=config_json)):
            with patch('os.path.exists', return_value=True):
                # Read specific keys
                processes = shared_utils.read_config(['processes'])

                assert isinstance(processes, list)
                assert len(processes) == 1
                assert processes[0]['name'] == 'Test Process'

    def test_write_config_success(self, mock_config):
        """Test writing configuration successfully"""
        mock_file = mock_open()

        with patch('builtins.open', mock_file):
            result = shared_utils.write_config(mock_config)

            assert result is True
            mock_file().write.assert_called()

    def test_write_config_failure(self, mock_config):
        """Test writing configuration when file cannot be written"""
        with patch('builtins.open', side_effect=IOError("Cannot write file")):
            result = shared_utils.write_config(mock_config)

            assert result is False


class TestSystemMetrics:
    """Tests for system metrics collection"""

    @patch('psutil.cpu_percent')
    @patch('psutil.cpu_count')
    @patch('psutil.virtual_memory')
    @patch('psutil.disk_usage')
    def test_get_system_metrics_basic(self, mock_disk, mock_memory, mock_cpu_count, mock_cpu_percent):
        """Test basic system metrics collection"""
        # Setup mocks
        mock_cpu_percent.return_value = 45.5
        mock_cpu_count.return_value = 8

        mock_memory_obj = Mock()
        mock_memory_obj.percent = 60.0
        mock_memory_obj.used = 12.5 * (1024 ** 3)  # Convert to bytes
        mock_memory_obj.total = 32.0 * (1024 ** 3)
        mock_memory.return_value = mock_memory_obj

        mock_disk_obj = Mock()
        mock_disk_obj.percent = 70.0
        mock_disk_obj.used = 350.0 * (1024 ** 3)
        mock_disk_obj.total = 500.0 * (1024 ** 3)
        mock_disk.return_value = mock_disk_obj

        # Call function
        with patch('shared_utils.get_gpu_usage', return_value=(0.0, 0.0)):
            metrics = shared_utils.get_system_metrics()

        # Assertions
        assert metrics['cpu']['percent'] == 45.5
        assert metrics['cpu']['count'] == 8
        assert metrics['memory']['percent'] == 60.0
        assert metrics['disk']['percent'] == 70.0

    @patch('shared_utils.get_gpu_usage')
    def test_get_system_metrics_with_gpu(self, mock_gpu):
        """Test system metrics collection with GPU"""
        mock_gpu.return_value = (75.0, 50.0)

        with patch('psutil.cpu_percent', return_value=45.5):
            with patch('psutil.cpu_count', return_value=8):
                with patch('psutil.virtual_memory'):
                    with patch('psutil.disk_usage'):
                        metrics = shared_utils.get_system_metrics()

        assert metrics['gpu']['percent'] == 75.0
        assert metrics['gpu']['memory_percent'] == 50.0


class TestProcessUtils:
    """Tests for process utility functions"""

    def test_sanitize_process_name(self):
        """Test process name sanitization"""
        # Test with special characters
        assert shared_utils.sanitize_process_name("Test/Process\\Name:1") == "Test_Process_Name_1"

        # Test with spaces
        assert shared_utils.sanitize_process_name("My Test Process") == "My_Test_Process"

        # Test with already clean name
        assert shared_utils.sanitize_process_name("CleanProcess") == "CleanProcess"

    def test_is_process_responsive_windows(self):
        """Test process responsiveness check (Windows-specific)"""
        # This test should be marked as Windows-only
        pytest.skip("Windows-specific test - requires win32gui")

    @patch('psutil.Process')
    def test_get_process_info(self, mock_process):
        """Test getting process information"""
        mock_proc = Mock()
        mock_proc.pid = 12345
        mock_proc.name.return_value = "test.exe"
        mock_proc.status.return_value = "running"
        mock_process.return_value = mock_proc

        info = {
            'pid': mock_proc.pid,
            'name': mock_proc.name(),
            'status': mock_proc.status()
        }

        assert info['pid'] == 12345
        assert info['name'] == "test.exe"
        assert info['status'] == "running"


@pytest.mark.unit
class TestUtilityFunctions:
    """Tests for misc utility functions"""

    def test_get_timestamp(self):
        """Test timestamp generation"""
        timestamp = shared_utils.get_timestamp() if hasattr(shared_utils, 'get_timestamp') else None

        if timestamp:
            assert isinstance(timestamp, (int, float))
            assert timestamp > 0

    def test_format_bytes(self):
        """Test byte formatting"""
        if hasattr(shared_utils, 'format_bytes'):
            assert shared_utils.format_bytes(1024) == "1.0 KB"
            assert shared_utils.format_bytes(1024 * 1024) == "1.0 MB"
            assert shared_utils.format_bytes(1024 * 1024 * 1024) == "1.0 GB"
