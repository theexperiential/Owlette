'use client';

import { useState, useEffect } from 'react';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { handleError } from '@/lib/errorHandler';

export interface InstallerVersionInfo {
  version: string;
  downloadUrl: string;
  fileSize: number;
  releaseDate: Timestamp;
  releaseNotes?: string;
}

/**
 * useInstallerVersion Hook
 *
 * Public hook for fetching the latest installer version.
 * Used by the download button in the dashboard header.
 *
 * Features:
 * - Real-time updates when new version is uploaded
 * - Returns latest version metadata
 * - Available to all authenticated users
 *
 * Usage:
 * const { version, downloadUrl, fileSize, isLoading } = useInstallerVersion();
 */
export function useInstallerVersion() {
  const [versionInfo, setVersionInfo] = useState<InstallerVersionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db) {
      setError('Firebase is not configured');
      setLoading(false);
      return;
    }

    try {
      const latestRef = doc(db, 'installer_metadata', 'latest');

      const unsubscribe = onSnapshot(
        latestRef,
        (doc) => {
          if (doc.exists()) {
            const data = doc.data();
            setVersionInfo({
              version: data.version,
              downloadUrl: data.download_url,
              fileSize: data.file_size,
              releaseDate: data.release_date,
              releaseNotes: data.release_notes,
            });
            setError(null);
          } else {
            setError('No installer version available');
          }
          setLoading(false);
        },
        (err) => {
          console.error('Error fetching installer version:', err);
          const friendlyMessage = handleError(err);
          setError(friendlyMessage);
          setLoading(false);
        }
      );

      return () => unsubscribe();
    } catch (err) {
      console.error('Error setting up version listener:', err);
      const friendlyMessage = handleError(err);
      setError(friendlyMessage);
      setLoading(false);
    }
  }, []);

  return {
    version: versionInfo?.version,
    downloadUrl: versionInfo?.downloadUrl,
    fileSize: versionInfo?.fileSize,
    releaseDate: versionInfo?.releaseDate,
    releaseNotes: versionInfo?.releaseNotes,
    isLoading: loading,
    error,
  };
}
