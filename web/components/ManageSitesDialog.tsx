'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Pencil, Trash2, Check, X, Plus, Copy } from 'lucide-react';
import { toast } from 'sonner';

interface Site {
  id: string;
  name: string;
}

interface ManageSitesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sites: Site[];
  currentSiteId: string;
  machineCount?: number;
  onRenameSite: (siteId: string, newName: string) => Promise<void>;
  onDeleteSite: (siteId: string) => Promise<void>;
  onCreateSite: () => void;
}

export function ManageSitesDialog({
  open,
  onOpenChange,
  sites,
  currentSiteId,
  machineCount = 0,
  onRenameSite,
  onDeleteSite,
  onCreateSite,
}: ManageSitesDialogProps) {
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingDialogOpen, setDeletingDialogOpen] = useState(false);
  const [siteToDelete, setSiteToDelete] = useState<string | null>(null);

  const startEditingSite = (siteId: string, siteName: string) => {
    setEditingSiteId(siteId);
    setEditingName(siteName);
  };

  const cancelEditingSite = () => {
    setEditingSiteId(null);
    setEditingName('');
  };

  const handleRenameSite = async (siteId: string) => {
    if (!editingName.trim()) {
      toast.error('Site name cannot be empty');
      return;
    }

    try {
      await onRenameSite(siteId, editingName);
      toast.success('Site renamed successfully!');
      setEditingSiteId(null);
      setEditingName('');
    } catch (error: any) {
      toast.error(error.message || 'Failed to rename site');
    }
  };

  const confirmDeleteSite = (siteId: string) => {
    setSiteToDelete(siteId);
    setDeletingDialogOpen(true);
  };

  const handleDeleteSite = async () => {
    if (!siteToDelete) return;

    if (sites.length === 1) {
      toast.error('Cannot delete the last site');
      setDeletingDialogOpen(false);
      setSiteToDelete(null);
      return;
    }

    try {
      await onDeleteSite(siteToDelete);
      toast.success('Site deleted successfully!');
      setDeletingDialogOpen(false);
      setSiteToDelete(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete site');
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="border-slate-700 bg-slate-800 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-white">Manage Sites</DialogTitle>
            <DialogDescription className="text-slate-400">
              Rename or delete your sites
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4 max-h-96 overflow-y-auto">
            {sites.map((site) => (
              <div
                key={site.id}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  site.id === currentSiteId
                    ? 'border-blue-600 bg-slate-750'
                    : 'border-slate-700 bg-slate-900'
                }`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {site.id === currentSiteId && (
                    <div className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0" />
                  )}
                  {editingSiteId === site.id ? (
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameSite(site.id);
                        if (e.key === 'Escape') cancelEditingSite();
                      }}
                      className="border-slate-700 bg-slate-800 text-white flex-1"
                      autoFocus
                    />
                  ) : (
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium truncate">{site.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs font-mono text-blue-400">
                          {site.id}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await navigator.clipboard.writeText(site.id);
                              toast.success(`Site ID "${site.id}" copied!`);
                            } catch (error) {
                              toast.error('Failed to copy Site ID');
                            }
                          }}
                          className="h-5 w-5 p-0 text-slate-400 hover:text-blue-400 hover:bg-slate-700"
                          title="Copy Site ID"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {site.id === currentSiteId
                          ? `${machineCount} machine${machineCount !== 1 ? 's' : ''}`
                          : 'Not loaded'}
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                  {editingSiteId === site.id ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRenameSite(site.id)}
                        className="text-green-500 hover:text-green-400 hover:bg-slate-700 cursor-pointer"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={cancelEditingSite}
                        className="text-slate-400 hover:text-slate-300 hover:bg-slate-700 cursor-pointer"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startEditingSite(site.id, site.name)}
                        className="text-blue-400 hover:text-blue-300 hover:bg-slate-700 cursor-pointer"
                        title="Rename site"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => confirmDeleteSite(site.id)}
                        className="text-red-400 hover:text-red-300 hover:bg-slate-700 cursor-pointer"
                        disabled={sites.length === 1}
                        title={sites.length === 1 ? "Cannot delete the last site" : "Delete site"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter className="border-t border-slate-700 pt-4">
            <Button
              onClick={() => {
                onOpenChange(false);
                onCreateSite();
              }}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Site
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deletingDialogOpen} onOpenChange={setDeletingDialogOpen}>
        <DialogContent className="border-slate-700 bg-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Delete Site</DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete this site? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {siteToDelete && (
            <div className="py-4">
              <p className="text-white">
                Site: <span className="font-semibold">{sites.find(s => s.id === siteToDelete)?.name}</span>
              </p>
              <p className="text-sm text-slate-400 mt-2">
                Note: The site document will be deleted, but machine data may remain in Firestore.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeletingDialogOpen(false);
                setSiteToDelete(null);
              }}
              className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700 cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteSite}
              className="bg-red-600 hover:bg-red-700 text-white cursor-pointer"
            >
              Delete Site
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
