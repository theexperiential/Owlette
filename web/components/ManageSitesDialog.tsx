'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pencil, Trash2, Check, X, Plus, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { COMMON_TIMEZONES } from '@/lib/timeUtils';

interface Site {
  id: string;
  name: string;
  timezone?: string;
  timeFormat?: '12h' | '24h';
}

interface ManageSitesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sites: Site[];
  currentSiteId: string;
  machineCount?: number;
  onUpdateSite: (siteId: string, updates: { name?: string; timezone?: string; timeFormat?: '12h' | '24h' }) => Promise<void>;
  onDeleteSite: (siteId: string) => Promise<void>;
  onCreateSite: () => void;
}

export function ManageSitesDialog({
  open,
  onOpenChange,
  sites,
  currentSiteId,
  machineCount = 0,
  onUpdateSite,
  onDeleteSite,
  onCreateSite,
}: ManageSitesDialogProps) {
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingTimezone, setEditingTimezone] = useState('UTC');
  const [editingTimeFormat, setEditingTimeFormat] = useState<'12h' | '24h'>('12h');
  const [deletingDialogOpen, setDeletingDialogOpen] = useState(false);
  const [siteToDelete, setSiteToDelete] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Reset editing state when dialog closes
  useEffect(() => {
    if (!open) {
      setEditingSiteId(null);
      setEditingName('');
      setEditingTimezone('UTC');
      setEditingTimeFormat('12h');
    }
  }, [open]);

  const startEditingSite = (site: Site) => {
    setEditingSiteId(site.id);
    setEditingName(site.name);
    setEditingTimezone(site.timezone || 'UTC');
    setEditingTimeFormat(site.timeFormat || '12h');
  };

  const cancelEditingSite = () => {
    setEditingSiteId(null);
    setEditingName('');
    setEditingTimezone('UTC');
    setEditingTimeFormat('12h');
  };

  const handleSaveSite = async (siteId: string) => {
    if (!editingName.trim()) {
      toast.error('Site name cannot be empty');
      return;
    }

    const site = sites.find(s => s.id === siteId);
    if (!site) return;

    // Check if anything changed
    const nameChanged = editingName.trim() !== site.name;
    const timezoneChanged = editingTimezone !== (site.timezone || 'UTC');
    const timeFormatChanged = editingTimeFormat !== (site.timeFormat || '12h');

    if (!nameChanged && !timezoneChanged && !timeFormatChanged) {
      cancelEditingSite();
      return;
    }

    setIsSaving(true);
    try {
      const updates: { name?: string; timezone?: string; timeFormat?: '12h' | '24h' } = {};
      if (nameChanged) updates.name = editingName.trim();
      if (timezoneChanged) updates.timezone = editingTimezone;
      if (timeFormatChanged) updates.timeFormat = editingTimeFormat;

      await onUpdateSite(siteId, updates);
      toast.success('Site updated successfully!');
      cancelEditingSite();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update site');
    } finally {
      setIsSaving(false);
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
              Edit site names, timezones, or delete sites
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4 pr-2 max-h-96 overflow-y-auto">
            {sites.map((site) => (
              <div
                key={site.id}
                className={`rounded-lg border transition-colors ${
                  site.id === currentSiteId
                    ? 'border-blue-600 bg-slate-900'
                    : 'border-slate-700 bg-slate-800/50'
                }`}
              >
                {editingSiteId === site.id ? (
                  /* Edit Mode */
                  <div className="p-4 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor={`name-${site.id}`} className="text-slate-300 text-sm">
                        Site Name
                      </Label>
                      <Input
                        id={`name-${site.id}`}
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveSite(site.id);
                          if (e.key === 'Escape') cancelEditingSite();
                        }}
                        className="border-slate-600 bg-slate-700 text-white"
                        autoFocus
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor={`timezone-${site.id}`} className="text-slate-300 text-sm">
                          Timezone
                        </Label>
                        <Select value={editingTimezone} onValueChange={setEditingTimezone}>
                          <SelectTrigger
                            id={`timezone-${site.id}`}
                            className="border-slate-600 bg-slate-700 text-white"
                          >
                            <SelectValue placeholder="Select timezone" />
                          </SelectTrigger>
                          <SelectContent className="border-slate-600 bg-slate-800 max-h-60">
                            {COMMON_TIMEZONES.map((tz) => (
                              <SelectItem
                                key={tz.value}
                                value={tz.value}
                                className="text-white hover:bg-slate-700 cursor-pointer"
                              >
                                {tz.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`timeformat-${site.id}`} className="text-slate-300 text-sm">
                          Time Format
                        </Label>
                        <Select value={editingTimeFormat} onValueChange={(v) => setEditingTimeFormat(v as '12h' | '24h')}>
                          <SelectTrigger
                            id={`timeformat-${site.id}`}
                            className="border-slate-600 bg-slate-700 text-white"
                          >
                            <SelectValue placeholder="Select format" />
                          </SelectTrigger>
                          <SelectContent className="border-slate-600 bg-slate-800">
                            <SelectItem value="12h" className="text-white hover:bg-slate-700 cursor-pointer">
                              12-hour (3:30 PM)
                            </SelectItem>
                            <SelectItem value="24h" className="text-white hover:bg-slate-700 cursor-pointer">
                              24-hour (15:30)
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={cancelEditingSite}
                        disabled={isSaving}
                        className="text-slate-400 hover:text-slate-300 hover:bg-slate-700 cursor-pointer"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleSaveSite(site.id)}
                        disabled={isSaving}
                        className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                      >
                        <Check className="h-4 w-4 mr-1" />
                        {isSaving ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* View Mode */
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium truncate">{site.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-xs font-mono text-slate-500">
                            {site.id}
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await navigator.clipboard.writeText(site.id);
                                toast.success(`Site ID copied!`);
                              } catch {
                                toast.error('Failed to copy Site ID');
                              }
                            }}
                            className="h-5 w-5 p-0 text-slate-500 hover:text-blue-400 hover:bg-transparent cursor-pointer"
                            title="Copy Site ID"
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        {site.id === currentSiteId && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            {machineCount} machine{machineCount !== 1 ? 's' : ''} · {site.timezone || 'UTC'}
                          </p>
                        )}
                        {site.id !== currentSiteId && site.timezone && site.timezone !== 'UTC' && (
                          <p className="text-xs text-slate-500 mt-0.5">
                            {site.timezone}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startEditingSite(site)}
                        className="text-slate-400 hover:text-blue-400 hover:bg-slate-700 cursor-pointer"
                        title="Edit site"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => confirmDeleteSite(site.id)}
                        className="text-slate-400 hover:text-red-400 hover:bg-slate-700 cursor-pointer"
                        disabled={sites.length === 1}
                        title={sites.length === 1 ? "Cannot delete the last site" : "Delete site"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
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
