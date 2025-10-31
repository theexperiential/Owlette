'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, doc, query, setDoc, getDocs, deleteDoc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

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
          const machineData: Machine[] = [];

          snapshot.forEach((doc) => {
            const data = doc.data();

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
                }))
                .sort((a, b) => a.name.localeCompare(b.name)); // Sort by name alphabetically
            }

            machineData.push({
              machineId: doc.id,
              lastHeartbeat: data.lastHeartbeat || 0,
              online: data.online || false,
              metrics: data.metrics,
              processes,
            });
          });

          setMachines(machineData);
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

    // Send kill command to the machine's commands/pending document
    // Agent listens to sites/{site}/machines/{machine}/commands/pending
    const commandPath = `sites/${siteId}/machines/${machineId}/commands/pending`;
    console.log('Writing kill command to:', commandPath);

    const commandId = `kill_${Date.now()}`;
    const commandRef = doc(db, 'sites', siteId, 'machines', machineId, 'commands', 'pending');
    const commandData = {
      type: 'kill_process',
      process_name: processName,  // Agent expects 'process_name'
      timestamp: Date.now(),
      status: 'pending',
    };

    console.log('Command ID:', commandId);
    console.log('Command data:', commandData);

    try {
      // Write to the pending document as a field
      await setDoc(commandRef, {
        [commandId]: commandData
      }, { merge: true });
      console.log('Kill command written successfully');
    } catch (error) {
      console.error('Error writing kill command:', error);
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

    // Send command to agent to update config file
    // Agent listens to sites/{site}/machines/{machine}/commands/pending
    const commandPath = `sites/${siteId}/machines/${machineId}/commands/pending`;
    console.log('Writing toggle command to:', commandPath);

    const commandId = `toggle_autolaunch_${Date.now()}`;
    const commandRef = doc(db, 'sites', siteId, 'machines', machineId, 'commands', 'pending');
    const commandData = {
      type: 'toggle_autolaunch',
      process_name: processName,
      autolaunch: newValue,
      timestamp: Date.now(),
      status: 'pending',
    };

    console.log('Command ID:', commandId);
    console.log('Command data:', commandData);

    try {
      // Write to the pending document as a field
      await setDoc(commandRef, {
        [commandId]: commandData
      }, { merge: true });
      console.log('Toggle command written successfully');
    } catch (error) {
      console.error('Error writing toggle command:', error);
      throw error;
    }
  };

  const updateProcess = async (machineId: string, processId: string, updatedData: Partial<Process>) => {
    if (!db || !siteId) throw new Error('Firebase not configured');

    // Write directly to config collection (source of truth)
    // Agent's config listener will detect change and update metrics automatically
    const configRef = doc(db, 'config', siteId, 'machines', machineId);

    console.log('🔧 [updateProcess] Updating process in config');
    console.log('  Config path:', `config/${siteId}/machines/${machineId}`);
    console.log('  Process ID:', processId);
    console.log('  Updated data:', updatedData);

    try {
      // Get current config
      const configSnap = await getDoc(configRef);
      if (!configSnap.exists()) {
        console.error('❌ Config document does not exist at:', `config/${siteId}/machines/${machineId}`);
        throw new Error(`Config document not found at config/${siteId}/machines/${machineId}`);
      }

      const config = configSnap.data();
      console.log('📄 Current config:', config);

      if (!config.processes || !Array.isArray(config.processes)) {
        console.error('❌ Config document has no processes array:', config);
        throw new Error('Config document has invalid structure - no processes array');
      }

      // Find the process being updated
      const targetProcess = config.processes.find((proc: any) => proc.id === processId);
      if (!targetProcess) {
        console.error('❌ Process not found in config. Process ID:', processId);
        console.error('Available processes:', config.processes.map((p: any) => ({ id: p.id, name: p.name })));
        throw new Error(`Process ${processId} not found in config`);
      }

      console.log('📝 Updating process:', targetProcess.name);

      // Find and update the specific process
      const updatedProcesses = config.processes.map((proc: any) =>
        proc.id === processId
          ? { ...proc, ...updatedData }  // Merge updates
          : proc
      );

      console.log('✏️ Updated processes array:', updatedProcesses);

      // Write back to Firestore CONFIG (not metrics!)
      await updateDoc(configRef, {
        processes: updatedProcesses
      });

      console.log('✅ Config updated in Firestore successfully!');
      console.log('  Agent should detect change and update local config.json');
      console.log('  Metrics will be pushed to sites collection automatically');
    } catch (error) {
      console.error('❌ Error updating process config:', error);
      throw error;
    }
  };

  return { machines, loading, error, killProcess, toggleAutolaunch, updateProcess };
}
