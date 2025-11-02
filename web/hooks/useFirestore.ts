'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, doc, query, setDoc, getDocs, deleteDoc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { logger } from '@/lib/logger';

export interface Process {
  id: string;
  name: string;
  status: string;
  pid: number | null;
  autolaunch: boolean;
  exe_path: string;
  file_path: string;
  cwd: string;
  priority: string;
  visibility: string;
  time_delay: string;
  time_to_init: string;
  relaunch_attempts: string;
  responsive: boolean;
  last_updated: number;
  index: number; // Order from config file
  // For optimistic UI updates
  _optimisticAutolaunch?: boolean;
}

export interface Machine {
  machineId: string;
  lastHeartbeat: number;
  online: boolean;
  metrics?: {
    cpu: { percent: number; unit: string };
    memory: { percent: number; total_gb: number; used_gb: number; unit: string };
    disk: { percent: number; total_gb: number; used_gb: number; unit: string };
    gpu?: { name: string; usage_percent: number; vram_total_gb: number; vram_used_gb: number; unit: string };
    processes?: Record<string, string>;
  };
  processes?: Process[];
}

export interface Site {
  id: string;
  name: string;
  createdAt: number;
}

export function useSites() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db) {
      setLoading(false);
      setError('Firebase not configured');
      return;
    }

    try {
      const sitesRef = collection(db, 'sites');

      const unsubscribe = onSnapshot(
        sitesRef,
        (snapshot) => {
          const siteData: Site[] = [];

          snapshot.forEach((doc) => {
            const data = doc.data();
            siteData.push({
              id: doc.id,
              name: data.name || doc.id,
              createdAt: data.createdAt || Date.now(),
            });
          });

          // Sort by name
          siteData.sort((a, b) => a.name.localeCompare(b.name));

          setSites(siteData);
          setLoading(false);
        },
        (err) => {
          console.error('Error fetching sites:', err);
          setError(err.message);
          setLoading(false);
        }
      );

      return () => unsubscribe();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }, []);

  const createSite = async (siteId: string, name: string) => {
    if (!db) throw new Error('Firebase not configured');

    const siteRef = doc(db, 'sites', siteId);
    await setDoc(siteRef, {
      name,
      createdAt: Date.now(),
    });
  };

  const renameSite = async (siteId: string, newName: string) => {
    if (!db) throw new Error('Firebase not configured');
    if (!newName.trim()) throw new Error('Site name cannot be empty');

    const siteRef = doc(db, 'sites', siteId);
    await updateDoc(siteRef, {
      name: newName.trim(),
    });
  };

  const deleteSite = async (siteId: string) => {
    if (!db) throw new Error('Firebase not configured');

    // Delete the site document
    // Note: Firestore doesn't automatically delete subcollections (machines)
    // In a production app, you might want to use a Cloud Function to handle this
    // For now, we'll just delete the site document
    const siteRef = doc(db, 'sites', siteId);
    await deleteDoc(siteRef);
  };

  return { sites, loading, error, createSite, renameSite, deleteSite };
}

export function useMachines(siteId: string) {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db || !siteId) {
      setLoading(false);
      setError('Firebase not configured or no site selected');
      return;
    }

    try {
      // Listen to machines collection in real-time
      const machinesRef = collection(db, 'sites', siteId, 'machines');

      const unsubscribe = onSnapshot(
        machinesRef,
        (snapshot) => {
          setMachines(prevMachines => {
            const machineData: Machine[] = [];

            snapshot.forEach((doc) => {
              const data = doc.data();

              // Find previous machine data to preserve GPU if not in update
              const prevMachine = prevMachines.find(m => m.machineId === doc.id);

            // Parse processes from the processes object - try both locations
            let processes: Process[] = [];
            const processesData = data.processes || data.metrics?.processes;

            if (processesData && typeof processesData === 'object') {
              processes = Object.entries(processesData)
                .map(([id, processData]: [string, any]) => ({
                  id,
                  name: processData.name || 'Unknown',
                  status: processData.status || 'UNKNOWN',
                  pid: processData.pid || null,
                  autolaunch: processData.autolaunch || false,
                  exe_path: processData.exe_path || '',
                  file_path: processData.file_path || '',
                  cwd: processData.cwd || '',
                  priority: processData.priority || 'Normal',
                  visibility: processData.visibility || 'Show',
                  time_delay: processData.time_delay || '0',
                  time_to_init: processData.time_to_init || '10',
                  relaunch_attempts: processData.relaunch_attempts || '3',
                  responsive: processData.responsive ?? true,
                  last_updated: processData.last_updated || 0,
                  index: processData.index ?? 999, // Preserve config order, default to end
                }))
                .sort((a, b) => a.index - b.index); // Sort by config order (index field)
            }

            // Convert Firestore Timestamp to Unix timestamp in seconds
            let lastHeartbeat = 0;
            if (data.lastHeartbeat) {
              if (typeof data.lastHeartbeat === 'object' && 'seconds' in data.lastHeartbeat) {
                // Firestore Timestamp object
                lastHeartbeat = data.lastHeartbeat.seconds;
              } else if (typeof data.lastHeartbeat === 'number') {
                // Already a number
                lastHeartbeat = data.lastHeartbeat;
              }
            }

              // Preserve GPU data if current update has invalid/missing GPU (name is "N/A" or missing)
              const metrics = data.metrics ? {
                ...data.metrics,
                gpu: (data.metrics.gpu?.name && data.metrics.gpu.name !== 'N/A')
                  ? data.metrics.gpu
                  : prevMachine?.metrics?.gpu
              } : prevMachine?.metrics;

              machineData.push({
                machineId: doc.id,
                lastHeartbeat,
                online: data.online || false,
                metrics,
                processes,
              });
            });

            // Sort machines by ID for stable ordering (prevents flickering)
            machineData.sort((a, b) => a.machineId.localeCompare(b.machineId));

            return machineData;
          });
          setLoading(false);
        },
        (err) => {
          console.error('Error fetching machines:', err);
          setError(err.message);
          setLoading(false);
        }
      );

      return () => unsubscribe();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }, [siteId]);

  const killProcess = async (machineId: string, processId: string, processName: string) => {
    if (!db || !siteId) throw new Error('Firebase not configured');

    const commandPath = `sites/${siteId}/machines/${machineId}/commands/pending`;
    const commandId = `kill_${Date.now()}`;

    logger.debug(`Sending kill command for process "${processName}"`, {
      context: 'killProcess',
      data: { machineId, processId, commandId },
    });

    const commandRef = doc(db, 'sites', siteId, 'machines', machineId, 'commands', 'pending');
    const commandData = {
      type: 'kill_process',
      process_name: processName,
      timestamp: Date.now(),
      status: 'pending',
    };

    try {
      await setDoc(commandRef, {
        [commandId]: commandData
      }, { merge: true });

      logger.firestore.write(commandPath, commandId, 'create');
      logger.debug('Kill command sent successfully', { context: 'killProcess' });
    } catch (error) {
      logger.firestore.error('Failed to send kill command', error);
      throw error;
    }
  };

  const toggleAutolaunch = async (machineId: string, processId: string, processName: string, newValue: boolean) => {
    if (!db || !siteId) throw new Error('Firebase not configured');

    // Optimistically update the UI immediately
    setMachines(prevMachines =>
      prevMachines.map(machine => {
        if (machine.machineId === machineId) {
          return {
            ...machine,
            processes: machine.processes?.map(process => {
              if (process.id === processId) {
                return {
                  ...process,
                  _optimisticAutolaunch: newValue
                };
              }
              return process;
            })
          };
        }
        return machine;
      })
    );

    const commandPath = `sites/${siteId}/machines/${machineId}/commands/pending`;
    const commandId = `toggle_autolaunch_${Date.now()}`;

    logger.debug(`Toggling autolaunch for "${processName}" to ${newValue}`, {
      context: 'toggleAutolaunch',
      data: { machineId, processId, commandId },
    });

    const commandRef = doc(db, 'sites', siteId, 'machines', machineId, 'commands', 'pending');
    const commandData = {
      type: 'toggle_autolaunch',
      process_name: processName,
      autolaunch: newValue,
      timestamp: Date.now(),
      status: 'pending',
    };

    try {
      await setDoc(commandRef, {
        [commandId]: commandData
      }, { merge: true });

      logger.firestore.write(commandPath, commandId, 'create');
      logger.debug('Toggle command sent successfully', { context: 'toggleAutolaunch' });
    } catch (error) {
      logger.firestore.error('Failed to send toggle command', error);
      throw error;
    }
  };

  const updateProcess = async (machineId: string, processId: string, updatedData: Partial<Process>) => {
    if (!db || !siteId) throw new Error('Firebase not configured');

    const configRef = doc(db, 'config', siteId, 'machines', machineId);
    const configPath = `config/${siteId}/machines/${machineId}`;

    logger.debug(`Updating process "${processId}"`, {
      context: 'updateProcess',
      data: { machineId, processId, updatedData },
    });

    try {
      logger.firestore.read(configPath);

      const configSnap = await getDoc(configRef);
      if (!configSnap.exists()) {
        logger.error('Config document not found', { context: 'updateProcess', data: { configPath } });
        throw new Error('Configuration not found');
      }

      const config = configSnap.data();

      if (!config.processes || !Array.isArray(config.processes)) {
        logger.error('Invalid config structure - no processes array', { context: 'updateProcess' });
        throw new Error('Invalid configuration structure');
      }

      const targetProcess = config.processes.find((proc: any) => proc.id === processId);
      if (!targetProcess) {
        logger.error('Process not found in config', { context: 'updateProcess', data: { processId } });
        throw new Error('Process not found');
      }

      const updatedProcesses = config.processes.map((proc: any) =>
        proc.id === processId ? { ...proc, ...updatedData } : proc
      );

      await updateDoc(configRef, {
        processes: updatedProcesses
      });

      logger.firestore.write(configPath, undefined, 'update');
      logger.debug('Process updated successfully', { context: 'updateProcess' });
    } catch (error) {
      logger.firestore.error('Failed to update process', error);
      throw error;
    }
  };

  const deleteProcess = async (machineId: string, processId: string) => {
    if (!db || !siteId) throw new Error('Firebase not configured');

    const configRef = doc(db, 'config', siteId, 'machines', machineId);
    const configPath = `config/${siteId}/machines/${machineId}`;

    logger.debug(`Deleting process "${processId}"`, {
      context: 'deleteProcess',
      data: { machineId, processId },
    });

    try {
      logger.firestore.read(configPath);

      const configSnap = await getDoc(configRef);
      if (!configSnap.exists()) {
        logger.error('Config document not found', { context: 'deleteProcess', data: { configPath } });
        throw new Error('Configuration not found');
      }

      const config = configSnap.data();

      if (!config.processes || !Array.isArray(config.processes)) {
        logger.error('Invalid config structure - no processes array', { context: 'deleteProcess' });
        throw new Error('Invalid configuration structure');
      }

      const targetProcess = config.processes.find((proc: any) => proc.id === processId);
      if (!targetProcess) {
        logger.error('Process not found in config', { context: 'deleteProcess', data: { processId } });
        throw new Error('Process not found');
      }

      const updatedProcesses = config.processes.filter((proc: any) => proc.id !== processId);

      await updateDoc(configRef, {
        processes: updatedProcesses
      });

      logger.firestore.write(configPath, undefined, 'delete');
      logger.debug('Process deleted successfully', { context: 'deleteProcess' });
    } catch (error) {
      logger.firestore.error('Failed to delete process', error);
      throw error;
    }
  };

  const createProcess = async (machineId: string, processData: Partial<Process>) => {
    if (!db || !siteId) throw new Error('Firebase not configured');

    const configRef = doc(db, 'config', siteId, 'machines', machineId);
    const configPath = `config/${siteId}/machines/${machineId}`;

    logger.debug('Creating new process', {
      context: 'createProcess',
      data: { machineId, processData },
    });

    try {
      logger.firestore.read(configPath);

      const configSnap = await getDoc(configRef);
      if (!configSnap.exists()) {
        logger.error('Config document not found', { context: 'createProcess', data: { configPath } });
        throw new Error('Configuration not found');
      }

      const config = configSnap.data();

      if (!config.processes || !Array.isArray(config.processes)) {
        logger.error('Invalid config structure - no processes array', { context: 'createProcess' });
        throw new Error('Invalid configuration structure');
      }

      const newProcessId = crypto.randomUUID();

      const newProcess = {
        id: newProcessId,
        name: processData.name || 'New Process',
        exe_path: processData.exe_path || '',
        file_path: processData.file_path || '',
        cwd: processData.cwd || '',
        priority: processData.priority || 'Normal',
        visibility: processData.visibility || 'Show',
        time_delay: processData.time_delay || '0',
        time_to_init: processData.time_to_init || '10',
        relaunch_attempts: processData.relaunch_attempts || '3',
        autolaunch: processData.autolaunch ?? false
      };

      const updatedProcesses = [...config.processes, newProcess];

      await updateDoc(configRef, {
        processes: updatedProcesses
      });

      logger.firestore.write(configPath, undefined, 'create');
      logger.debug('Process created successfully', { context: 'createProcess', data: { newProcessId } });

      return newProcessId;
    } catch (error) {
      logger.firestore.error('Failed to create process', error);
      throw error;
    }
  };

  return { machines, loading, error, killProcess, toggleAutolaunch, updateProcess, deleteProcess, createProcess };
}
