'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, doc, setDoc, getDocs, deleteDoc, query, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface DeploymentTemplate {
  id: string;
  name: string;
  installer_name: string;
  installer_url: string;
  silent_flags: string;
  verify_path?: string;
  createdAt: number;
}

export interface DeploymentTarget {
  machineId: string;
  status: 'pending' | 'downloading' | 'installing' | 'completed' | 'failed';
  progress?: number;
  error?: string;
  completedAt?: number;
}

export interface Deployment {
  id: string;
  name: string;
  installer_name: string;
  installer_url: string;
  silent_flags: string;
  verify_path?: string;
  targets: DeploymentTarget[];
  createdAt: number;
  completedAt?: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'partial';
}

export function useDeploymentTemplates(siteId: string) {
  const [templates, setTemplates] = useState<DeploymentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db || !siteId) {
      setLoading(false);
      setError('Firebase not configured or no site selected');
      return;
    }

    try {
      const templatesRef = collection(db, 'sites', siteId, 'installer_templates');

      const unsubscribe = onSnapshot(
        templatesRef,
        (snapshot) => {
          const templateData: DeploymentTemplate[] = [];

          snapshot.forEach((doc) => {
            const data = doc.data();
            templateData.push({
              id: doc.id,
              name: data.name || 'Unnamed Template',
              installer_name: data.installer_name || '',
              installer_url: data.installer_url || '',
              silent_flags: data.silent_flags || '',
              verify_path: data.verify_path,
              createdAt: data.createdAt || Date.now(),
            });
          });

          // Sort by created date (newest first)
          templateData.sort((a, b) => b.createdAt - a.createdAt);

          setTemplates(templateData);
          setLoading(false);
        },
        (err) => {
          console.error('Error fetching templates:', err);
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

  const createTemplate = async (template: Omit<DeploymentTemplate, 'id' | 'createdAt'>) => {
    if (!db || !siteId) throw new Error('Firebase not configured');

    const templateId = `template-${Date.now()}`;
    const templateRef = doc(db, 'sites', siteId, 'installer_templates', templateId);

    await setDoc(templateRef, {
      ...template,
      createdAt: Date.now(),
    });

    return templateId;
  };

  const deleteTemplate = async (templateId: string) => {
    if (!db || !siteId) throw new Error('Firebase not configured');

    const templateRef = doc(db, 'sites', siteId, 'installer_templates', templateId);
    await deleteDoc(templateRef);
  };

  return { templates, loading, error, createTemplate, deleteTemplate };
}

export function useDeployments(siteId: string) {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db || !siteId) {
      setLoading(false);
      setError('Firebase not configured or no site selected');
      return;
    }

    try {
      const deploymentsRef = collection(db, 'sites', siteId, 'deployments');

      const unsubscribe = onSnapshot(
        deploymentsRef,
        (snapshot) => {
          const deploymentData: Deployment[] = [];

          snapshot.forEach((doc) => {
            const data = doc.data();
            deploymentData.push({
              id: doc.id,
              name: data.name || 'Unnamed Deployment',
              installer_name: data.installer_name || '',
              installer_url: data.installer_url || '',
              silent_flags: data.silent_flags || '',
              verify_path: data.verify_path,
              targets: data.targets || [],
              createdAt: data.createdAt || Date.now(),
              completedAt: data.completedAt,
              status: data.status || 'pending',
            });
          });

          // Sort by created date (newest first)
          deploymentData.sort((a, b) => b.createdAt - a.createdAt);

          setDeployments(deploymentData);
          setLoading(false);
        },
        (err) => {
          console.error('Error fetching deployments:', err);
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

  const createDeployment = async (
    deployment: Omit<Deployment, 'id' | 'createdAt' | 'status'>,
    machineIds: string[]
  ) => {
    if (!db || !siteId) throw new Error('Firebase not configured');

    const deploymentId = `deploy-${Date.now()}`;
    const deploymentRef = doc(db, 'sites', siteId, 'deployments', deploymentId);

    // Initialize targets with pending status
    const targets: DeploymentTarget[] = machineIds.map(machineId => ({
      machineId,
      status: 'pending',
    }));

    // Create deployment document
    await setDoc(deploymentRef, {
      ...deployment,
      targets,
      createdAt: Date.now(),
      status: 'pending',
    });

    // Send install command to each machine in parallel
    const commandPromises = machineIds.map(async (machineId) => {
      // Use hyphens instead of underscores to avoid Firestore field path errors
      const commandId = `install-${deploymentId}-${machineId}-${Date.now()}`;
      const commandRef = doc(db!, 'sites', siteId, 'machines', machineId, 'commands', 'pending');

      await setDoc(commandRef, {
        [commandId]: {
          type: 'install_software',
          installer_url: deployment.installer_url,
          installer_name: deployment.installer_name,
          silent_flags: deployment.silent_flags,
          verify_path: deployment.verify_path,
          deployment_id: deploymentId,
          timestamp: Date.now(),
          status: 'pending',
        }
      }, { merge: true });
    });

    // Wait for all commands to be sent
    await Promise.all(commandPromises);

    // Update deployment status to in_progress
    await setDoc(deploymentRef, {
      status: 'in_progress',
    }, { merge: true });

    return deploymentId;
  };

  const cancelDeployment = async (deploymentId: string, machineId: string, installer_name: string) => {
    if (!db || !siteId) throw new Error('Firebase not configured');

    // Send cancel command to the machine
    const commandId = `cancel-${Date.now()}-${machineId}`;
    const commandRef = doc(db, 'sites', siteId, 'machines', machineId, 'commands', 'pending');

    await setDoc(commandRef, {
      [commandId]: {
        type: 'cancel_installation',
        installer_name: installer_name,
        deployment_id: deploymentId,
        timestamp: Date.now(),
      }
    }, { merge: true });

    // Update deployment target status to cancelled
    const deploymentRef = doc(db, 'sites', siteId, 'deployments', deploymentId);
    const deploymentSnap = await getDocs(query(collection(db, 'sites', siteId, 'deployments'), limit(1)));

    // This is a workaround - need to fetch current deployment to update targets
    // In a production app, you'd use a server function or transaction
    return commandId;
  };

  const deleteDeployment = async (deploymentId: string) => {
    if (!db || !siteId) throw new Error('Firebase not configured');

    const deploymentRef = doc(db, 'sites', siteId, 'deployments', deploymentId);
    await deleteDoc(deploymentRef);
  };

  return { deployments, loading, error, createDeployment, cancelDeployment, deleteDeployment };
}

// Convenience hook to get both templates and deployments
export function useDeploymentManager(siteId: string) {
  const templates = useDeploymentTemplates(siteId);
  const deployments = useDeployments(siteId);

  return {
    templates: templates.templates,
    templatesLoading: templates.loading,
    templatesError: templates.error,
    createTemplate: templates.createTemplate,
    deleteTemplate: templates.deleteTemplate,

    deployments: deployments.deployments,
    deploymentsLoading: deployments.loading,
    deploymentsError: deployments.error,
    createDeployment: deployments.createDeployment,
    cancelDeployment: deployments.cancelDeployment,
    deleteDeployment: deployments.deleteDeployment,
  };
}
