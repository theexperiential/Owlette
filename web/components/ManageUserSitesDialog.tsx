'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSites } from '@/hooks/useFirestore';
import { useAuth } from '@/contexts/AuthContext';

interface ManageUserSitesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userEmail: string;
  userSites: string[];
  onAssignSite: (userId: string, siteId: string) => Promise<void>;
  onRemoveSite: (userId: string, siteId: string) => Promise<void>;
}

export function ManageUserSitesDialog({
  open,
  onOpenChange,
  userId,
  userEmail,
  userSites,
  onAssignSite,
  onRemoveSite,
}: ManageUserSitesDialogProps) {
  const { isAdmin, userSites: adminSites } = useAuth();
  const { sites, loading: sitesLoading } = useSites(adminSites, isAdmin);
  const [assigningTo, setAssigningTo] = useState<string | null>(null);
  const [removingFrom, setRemovingFrom] = useState<string | null>(null);

  const handleAssignSite = async (siteId: string) => {
    setAssigningTo(siteId);
    try {
      await onAssignSite(userId, siteId);
      toast.success('Site Assigned', {
        description: `${userEmail} now has access to this site.`,
      });
    } catch (err: any) {
      toast.error('Assignment Failed', {
        description: err.message || 'Failed to assign site to user.',
      });
    } finally {
      setAssigningTo(null);
    }
  };

  const handleRemoveSite = async (siteId: string) => {
    setRemovingFrom(siteId);
    try {
      await onRemoveSite(userId, siteId);
      toast.success('Site Removed', {
        description: `${userEmail} no longer has access to this site.`,
      });
    } catch (err: any) {
      toast.error('Removal Failed', {
        description: err.message || 'Failed to remove site from user.',
      });
    } finally {
      setRemovingFrom(null);
    }
  };

  const assignedSites = sites.filter((site) => userSites.includes(site.id));
  const availableSites = sites.filter((site) => !userSites.includes(site.id));

  // Find orphaned site IDs (in user's array but don't exist in sites collection)
  const validSiteIds = sites.map(s => s.id);
  const orphanedSiteIds = userSites.filter((siteId) => !validSiteIds.includes(siteId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-700 bg-slate-800 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-white">Manage Site Access</DialogTitle>
          <DialogDescription className="text-slate-400">
            Control which sites {userEmail} can access
          </DialogDescription>
        </DialogHeader>

        {sitesLoading ? (
          <div className="flex justify-center items-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            <span className="ml-2 text-slate-400">Loading sites...</span>
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Assigned Sites */}
            <div>
              <h3 className="text-sm font-semibold text-white mb-3">
                Assigned Sites ({assignedSites.length})
              </h3>
              {assignedSites.length === 0 ? (
                <div className="text-center py-6 text-slate-400 bg-slate-900 rounded-lg border border-slate-700">
                  No sites assigned yet
                </div>
              ) : (
                <div className="space-y-2">
                  {assignedSites.map((site) => (
                    <div
                      key={site.id}
                      className="flex items-center justify-between p-3 bg-slate-900 rounded-lg border border-slate-700"
                    >
                      <div className="flex-1">
                        <p className="text-white font-medium">{site.name}</p>
                        <p className="text-xs text-slate-400 font-mono">{site.id}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveSite(site.id)}
                        disabled={removingFrom === site.id}
                        className="text-red-400 hover:text-red-300 hover:bg-red-950/30 cursor-pointer"
                      >
                        {removingFrom === site.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Orphaned/Invalid Site References */}
            {orphanedSiteIds.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-red-400 mb-3">
                  Invalid Site References ({orphanedSiteIds.length})
                </h3>
                <div className="space-y-2">
                  <div className="text-xs text-slate-400 mb-2 p-2 bg-red-950/20 border border-red-900 rounded">
                    These site IDs are in the user's access list but the sites no longer exist or are inaccessible. Remove them to fix the site count.
                  </div>
                  {orphanedSiteIds.map((siteId) => (
                    <div
                      key={siteId}
                      className="flex items-center justify-between p-3 bg-red-950/30 rounded-lg border border-red-900"
                    >
                      <div className="flex-1">
                        <p className="text-red-300 font-medium">Invalid/Orphaned Site</p>
                        <p className="text-xs text-red-400 font-mono">{siteId}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveSite(siteId)}
                        disabled={removingFrom === siteId}
                        className="text-red-400 hover:text-red-300 hover:bg-red-950/30 cursor-pointer"
                      >
                        {removingFrom === siteId ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Available Sites */}
            {availableSites.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-white mb-3">
                  Available Sites ({availableSites.length})
                </h3>
                <div className="space-y-2">
                  {availableSites.map((site) => (
                    <div
                      key={site.id}
                      className="flex items-center justify-between p-3 bg-slate-900 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
                    >
                      <div className="flex-1">
                        <p className="text-white font-medium">{site.name}</p>
                        <p className="text-xs text-slate-400 font-mono">{site.id}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAssignSite(site.id)}
                        disabled={assigningTo === site.id}
                        className="border-blue-600 text-blue-400 hover:bg-blue-950/30 hover:text-blue-300 cursor-pointer"
                      >
                        {assigningTo === site.id ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Assigning...
                          </>
                        ) : (
                          <>
                            <Plus className="h-4 w-4 mr-2" />
                            Assign
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!sitesLoading && sites.length === 0 && (
          <div className="text-center py-8 text-slate-400">
            <p>No sites available yet.</p>
            <p className="text-sm mt-2">Create a site first from the dashboard.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
