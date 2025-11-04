'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

interface CreateSiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateSite: (siteId: string, siteName: string, userId: string) => Promise<void>;
}

export function CreateSiteDialog({
  open,
  onOpenChange,
  onCreateSite,
}: CreateSiteDialogProps) {
  const { user } = useAuth();
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteId, setNewSiteId] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateSite = async () => {
    if (!newSiteId.trim() || !newSiteName.trim()) {
      toast.error('Please fill in both Site ID and Site Name');
      return;
    }

    if (!user) {
      toast.error('You must be logged in to create a site');
      return;
    }

    setIsCreating(true);
    try {
      await onCreateSite(newSiteId, newSiteName, user.uid);
      toast.success(`Site "${newSiteName}" created successfully!`);
      setNewSiteId('');
      setNewSiteName('');
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to create site');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-700 bg-slate-800 text-white">
        <DialogHeader>
          <DialogTitle className="text-white">Create New Site</DialogTitle>
          <DialogDescription className="text-slate-400">
            Add a new site to organize your machines
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="site-id" className="text-white">Site ID</Label>
            <Input
              id="site-id"
              placeholder="e.g., nyc_office"
              value={newSiteId}
              onChange={(e) => setNewSiteId(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
              className="border-slate-700 bg-slate-900 text-white"
            />
            <p className="text-xs text-slate-500">Lowercase, use underscores instead of spaces</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="site-name" className="text-white">Site Name</Label>
            <Input
              id="site-name"
              placeholder="e.g., NYC Office"
              value={newSiteName}
              onChange={(e) => setNewSiteName(e.target.value)}
              className="border-slate-700 bg-slate-900 text-white"
            />
            <p className="text-xs text-slate-500">Display name for the site</p>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700 cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreateSite}
            disabled={isCreating}
            className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
          >
            {isCreating ? 'Creating...' : 'Create Site'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
