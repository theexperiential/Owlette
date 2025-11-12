'use client';

import { useState } from 'react';
import { useInstallerManagement } from '@/hooks/useInstallerManagement';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Package, Plus, Loader2, Download, Trash2, CheckCircle, Copy } from 'lucide-react';
import { toast } from 'sonner';
import UploadInstallerDialog from '@/components/admin/UploadInstallerDialog';
import { formatFileSize } from '@/lib/storageUtils';

/**
 * Installers Admin Page
 *
 * Admin-only page for managing Owlette Agent installer versions.
 * Allows admins to:
 * - View all versions
 * - Upload new versions
 * - Set version as latest
 * - Delete old versions
 */
export default function InstallerVersionsPage() {
  const {
    versions,
    latestVersion,
    loading,
    error,
    uploadVersion,
    setAsLatest,
    deleteVersion,
  } = useInstallerManagement();
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deletingVersion, setDeletingVersion] = useState<string | null>(null);
  const [settingLatest, setSettingLatest] = useState<string | null>(null);
  const [setLatestDialogOpen, setSetLatestDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [versionToSetLatest, setVersionToSetLatest] = useState<string>('');
  const [versionToDelete, setVersionToDelete] = useState<string>('');

  const handleSetAsLatest = (version: string) => {
    if (latestVersion?.version === version) {
      toast.info('Already Latest', {
        description: 'This version is already set as latest.',
      });
      return;
    }

    setVersionToSetLatest(version);
    setSetLatestDialogOpen(true);
  };

  const confirmSetAsLatest = async () => {
    setSettingLatest(versionToSetLatest);
    setSetLatestDialogOpen(false);

    try {
      await setAsLatest(versionToSetLatest);
      toast.success('Latest Version Updated', {
        description: `Version ${versionToSetLatest} is now the latest.`,
      });
    } catch (err: any) {
      toast.error('Update Failed', {
        description: err.message || 'Failed to update latest version.',
      });
    } finally {
      setSettingLatest(null);
      setVersionToSetLatest('');
    }
  };

  const handleDelete = (version: string) => {
    if (latestVersion?.version === version) {
      toast.error('Cannot Delete', {
        description: 'Cannot delete the current latest version. Set a different version as latest first.',
      });
      return;
    }

    setVersionToDelete(version);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    setDeletingVersion(versionToDelete);
    setDeleteDialogOpen(false);

    try {
      await deleteVersion(versionToDelete);
      toast.success('Version Deleted', {
        description: `Version ${versionToDelete} has been deleted.`,
      });
    } catch (err: any) {
      toast.error('Delete Failed', {
        description: err.message || 'Failed to delete version.',
      });
    } finally {
      setDeletingVersion(null);
      setVersionToDelete('');
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const copyDownloadLink = async (downloadUrl: string, version: string) => {
    try {
      await navigator.clipboard.writeText(downloadUrl);
      toast.success('Link Copied', {
        description: `Download link for version ${version} copied to clipboard.`,
      });
    } catch (err) {
      toast.error('Copy Failed', {
        description: 'Failed to copy link to clipboard.',
      });
    }
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Installers</h1>
          <p className="text-slate-400">Manage Owlette Agent installer versions and downloads</p>
        </div>
        <Button
          onClick={() => setUploadDialogOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
        >
          <Plus className="h-4 w-4 mr-2" />
          Upload New Version
        </Button>
      </div>

      {/* Stats Card */}
      {latestVersion && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 mb-8">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-600 rounded-lg">
              <Package className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-slate-400">Current Latest Version</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-2xl font-bold text-white">{latestVersion.version}</p>
                <Badge className="bg-green-600">Latest</Badge>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-400">File Size</p>
              <p className="text-lg text-white font-medium">
                {formatFileSize(latestVersion.file_size)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => window.open(latestVersion.download_url, '_blank')}
                variant="outline"
                size="icon"
                className="border-slate-700 bg-slate-900 text-white hover:bg-slate-700 hover:text-white cursor-pointer"
                title={`Download Owlette Agent v${latestVersion.version}`}
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                onClick={() => copyDownloadLink(latestVersion.download_url, latestVersion.version)}
                variant="outline"
                size="icon"
                className="border-slate-700 bg-slate-900 text-white hover:bg-slate-700 hover:text-white cursor-pointer"
                title={`Copy download link for Owlette Agent v${latestVersion.version}`}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6">
          <p className="text-red-300">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <span className="ml-3 text-slate-400">Loading versions...</span>
        </div>
      )}

      {/* Versions Table */}
      {!loading && !error && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/50">
                <th className="text-left p-4 text-sm font-medium text-slate-300">Version</th>
                <th className="text-left p-4 text-sm font-medium text-slate-300">File Size</th>
                <th className="text-left p-4 text-sm font-medium text-slate-300">Uploaded</th>
                <th className="text-left p-4 text-sm font-medium text-slate-300">Uploaded By</th>
                <th className="text-left p-4 text-sm font-medium text-slate-300">Release Notes</th>
                <th className="text-right p-4 text-sm font-medium text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {versions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    No versions uploaded yet. Click "Upload New Version" to get started.
                  </td>
                </tr>
              ) : (
                versions.map((version) => {
                  const isLatest = latestVersion?.version === version.version;
                  const isDeleting = deletingVersion === version.version;
                  const isSetting = settingLatest === version.version;

                  return (
                    <tr
                      key={version.id}
                      className="border-b border-slate-700 hover:bg-slate-700/50 transition-colors"
                    >
                      {/* Version */}
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium">{version.version}</span>
                          {isLatest && (
                            <Badge className="bg-green-600 flex items-center gap-1">
                              <CheckCircle className="h-3 w-3" />
                              Latest
                            </Badge>
                          )}
                        </div>
                      </td>

                      {/* File Size */}
                      <td className="p-4 text-slate-400">
                        {formatFileSize(version.file_size)}
                      </td>

                      {/* Upload Date */}
                      <td className="p-4 text-slate-400 text-sm">
                        {formatDate(version.release_date)}
                      </td>

                      {/* Uploaded By */}
                      <td className="p-4 text-slate-400 text-sm">
                        {version.uploaded_by}
                      </td>

                      {/* Release Notes */}
                      <td className="p-4">
                        {version.release_notes ? (
                          <p className="text-sm text-slate-400 line-clamp-2">
                            {version.release_notes}
                          </p>
                        ) : (
                          <span className="text-xs text-slate-600">No notes</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="p-4">
                        <div className="flex items-center justify-between gap-2">
                          {/* Left side: Set as Latest button (or empty space) */}
                          <div className="min-w-[100px]">
                            {!isLatest && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleSetAsLatest(version.version)}
                                disabled={isSetting || isDeleting}
                                className="border-slate-700 bg-slate-900 text-white hover:bg-slate-700 hover:text-white cursor-pointer text-xs"
                              >
                                {isSetting ? (
                                  <>
                                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                    Setting...
                                  </>
                                ) : (
                                  'Set as Latest'
                                )}
                              </Button>
                            )}
                          </div>

                          {/* Right side: Icon buttons (always aligned) */}
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => window.open(version.download_url, '_blank')}
                              className="border-slate-700 bg-slate-900 text-white hover:bg-slate-700 hover:text-white cursor-pointer"
                              title={`Download Owlette Agent v${version.version}`}
                            >
                              <Download className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => copyDownloadLink(version.download_url, version.version)}
                              className="border-slate-700 bg-slate-900 text-white hover:bg-slate-700 hover:text-white cursor-pointer"
                              title={`Copy download link for Owlette Agent v${version.version}`}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            {!isLatest ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDelete(version.version)}
                                disabled={isDeleting || isSetting}
                                className="border-slate-700 bg-slate-900 text-red-400 hover:bg-red-900 hover:text-red-300 cursor-pointer"
                              >
                                {isDeleting ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
                              </Button>
                            ) : (
                              <div className="w-[36px]" />
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Info Box */}
      {!loading && !error && versions.length > 0 && (
        <div className="mt-6 bg-blue-900/30 border border-blue-700 rounded-lg p-4">
          <p className="text-blue-300 text-sm">
            <strong>Note:</strong> The "Latest" version is what users will download from the public
            download link. You can upload multiple versions and switch between them at any time.
            Old versions cannot be deleted if they are currently set as latest.
          </p>
        </div>
      )}

      {/* Upload Dialog */}
      <UploadInstallerDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        onUpload={uploadVersion}
      />

      {/* Set as Latest Confirmation Dialog */}
      <Dialog open={setLatestDialogOpen} onOpenChange={setSetLatestDialogOpen}>
        <DialogContent className="border-slate-700 bg-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Set as Latest Version</DialogTitle>
            <DialogDescription className="text-slate-400">
              Set version {versionToSetLatest} as the latest version?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSetLatestDialogOpen(false)}
              className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700 hover:text-white cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmSetAsLatest}
              className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="border-slate-700 bg-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Delete Version</DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete version {versionToDelete}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700 hover:text-white cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700 text-white cursor-pointer"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
