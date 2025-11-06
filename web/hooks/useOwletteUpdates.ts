/**
 * useOwletteUpdates Hook
 *
 * Combines machine data with latest installer version to detect which machines need updates.
 * Provides update status, outdated machines list, and version comparison.
 *
 * Pattern: Combines existing hooks for specific functionality (DRY principle)
 */

'use client';

import { useMemo } from 'react';
import { Machine } from './useFirestore';
import { useInstallerVersion } from './useInstallerVersion';
import { isOutdated, compareVersions } from '@/lib/versionUtils';

export interface MachineUpdateStatus {
  machine: Machine;
  needsUpdate: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
}

export interface UseOwletteUpdatesReturn {
  outdatedMachines: Machine[];
  machineUpdateStatuses: MachineUpdateStatus[];
  latestVersion: string | null;
  totalMachinesNeedingUpdate: number;
  isLoading: boolean;
  error: string | null;
  getMachineUpdateStatus: (machine: Machine) => MachineUpdateStatus;
}

/**
 * Hook to detect which machines need Owlette agent updates
 *
 * @param machines - Array of machines from useFirestore
 * @returns Update detection interface
 *
 * @example
 * const { machines } = useMachines(siteId);
 * const {
 *   outdatedMachines,
 *   latestVersion,
 *   totalMachinesNeedingUpdate
 * } = useOwletteUpdates(machines);
 *
 * // Show update banner if machines need updates
 * {totalMachinesNeedingUpdate > 0 && (
 *   <UpdateBanner count={totalMachinesNeedingUpdate} version={latestVersion} />
 * )}
 */
export function useOwletteUpdates(machines: Machine[]): UseOwletteUpdatesReturn {
  // Get latest installer version
  const {
    version: latestVersion,
    isLoading: versionLoading,
    error: versionError
  } = useInstallerVersion();

  // Calculate machine update statuses
  const machineUpdateStatuses = useMemo<MachineUpdateStatus[]>(() => {
    if (!machines || machines.length === 0) {
      return [];
    }

    return machines.map(machine => {
      const currentVersion = machine.agent_version || null;
      const normalizedLatestVersion = latestVersion || null;
      const needsUpdate = isOutdated(currentVersion, normalizedLatestVersion);

      return {
        machine,
        needsUpdate,
        currentVersion,
        latestVersion: normalizedLatestVersion,
        updateAvailable: needsUpdate && !!normalizedLatestVersion
      };
    });
  }, [machines, latestVersion]);

  // Filter to only outdated machines
  const outdatedMachines = useMemo(() => {
    return machineUpdateStatuses
      .filter(status => status.needsUpdate)
      .map(status => status.machine);
  }, [machineUpdateStatuses]);

  // Count machines needing updates
  const totalMachinesNeedingUpdate = outdatedMachines.length;

  /**
   * Get update status for a specific machine
   */
  const getMachineUpdateStatus = (machine: Machine): MachineUpdateStatus => {
    const existingStatus = machineUpdateStatuses.find(
      status => status.machine.machineId === machine.machineId
    );

    if (existingStatus) {
      return existingStatus;
    }

    // If not found, calculate on the fly
    const currentVersion = machine.agent_version || null;
    const normalizedLatestVersion = latestVersion || null;
    const needsUpdate = isOutdated(currentVersion, normalizedLatestVersion);

    return {
      machine,
      needsUpdate,
      currentVersion,
      latestVersion: normalizedLatestVersion,
      updateAvailable: needsUpdate && !!normalizedLatestVersion
    };
  };

  return {
    outdatedMachines,
    machineUpdateStatuses,
    latestVersion: latestVersion || null,
    totalMachinesNeedingUpdate,
    isLoading: versionLoading,
    error: versionError,
    getMachineUpdateStatus
  };
}

/**
 * Helper hook to get just the count of machines needing updates
 * (lighter weight if you only need the count)
 */
export function useUpdateCount(machines: Machine[]): {
  count: number;
  isLoading: boolean;
} {
  const { totalMachinesNeedingUpdate, isLoading } = useOwletteUpdates(machines);

  return {
    count: totalMachinesNeedingUpdate,
    isLoading
  };
}
