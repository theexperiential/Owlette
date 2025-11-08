/**
 * UpdateOwletteButton Component
 *
 * Provides a one-click button to update all Owlette agents to the latest version.
 * Displays current version, outdated machine count, and confirmation dialog.
 *
 * Features:
 * - Shows latest available version
 * - Counts machines needing updates
 * - Confirmation dialog with machine selection
 * - Progress tracking during update
 * - Success/error notifications
 */

'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { RefreshCw, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useOwletteUpdates } from '@/hooks/useOwletteUpdates';
import { Machine } from '@/hooks/useFirestore';
import { toast } from 'sonner';

interface UpdateOwletteButtonProps {
  siteId: string;
  machines: Machine[];
}

export function UpdateOwletteButton({ siteId, machines }: UpdateOwletteButtonProps) {
  const {
    outdatedMachines,
    latestVersion,
    totalMachinesNeedingUpdate,
    isLoading,
    updateMachines,
    updatingMachines,
  } = useOwletteUpdates(machines);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedMachines, setSelectedMachines] = useState<Set<string>>(new Set());
  const [isUpdating, setIsUpdating] = useState(false);

  // Initialize selected machines when dialog opens
  const handleOpenDialog = () => {
    // Select all outdated machines by default
    setSelectedMachines(new Set(outdatedMachines.map(m => m.machineId)));
    setDialogOpen(true);
  };

  const handleToggleMachine = (machineId: string) => {
    setSelectedMachines(prev => {
      const newSet = new Set(prev);
      if (newSet.has(machineId)) {
        newSet.delete(machineId);
      } else {
        newSet.add(machineId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    setSelectedMachines(new Set(outdatedMachines.map(m => m.machineId)));
  };

  const handleDeselectAll = () => {
    setSelectedMachines(new Set());
  };

  const handleUpdate = async () => {
    if (selectedMachines.size === 0) {
      toast.error('Please select at least one machine to update');
      return;
    }

    setIsUpdating(true);

    try {
      await updateMachines(siteId, Array.from(selectedMachines));

      toast.success(
        `Update initiated for ${selectedMachines.size} machine(s)`,
        {
          description: 'The Owlette service will restart automatically after updating',
          duration: 5000,
        }
      );

      setDialogOpen(false);
      setSelectedMachines(new Set());
    } catch (error) {
      console.error('Failed to update machines:', error);
      toast.error(
        'Failed to initiate update',
        {
          description: error instanceof Error ? error.message : 'Unknown error occurred',
          duration: 5000,
        }
      );
    } finally {
      setIsUpdating(false);
    }
  };

  // Don't show button if no machines or all up-to-date
  if (isLoading || totalMachinesNeedingUpdate === 0) {
    return null;
  }

  return (
    <>
      <Button
        onClick={handleOpenDialog}
        variant="outline"
        className="border-orange-600 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950 cursor-pointer"
      >
        <RefreshCw className="h-4 w-4 mr-2" />
        Update Owlette
        {latestVersion && (
          <span className="ml-2 text-xs">to v{latestVersion}</span>
        )}
        {totalMachinesNeedingUpdate > 0 && (
          <Badge variant="destructive" className="ml-2">
            {totalMachinesNeedingUpdate}
          </Badge>
        )}
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Update Owlette Agents</DialogTitle>
            <DialogDescription>
              Update selected machines to Owlette v{latestVersion || 'latest'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Info banner */}
            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-900 dark:text-blue-100">
                  <p className="font-medium mb-1">What happens during an update:</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-800 dark:text-blue-200">
                    <li>The Owlette service will stop automatically</li>
                    <li>The new version will install silently</li>
                    <li>The Owlette service will restart automatically</li>
                    <li>The machine will appear online again within 1-2 minutes</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Machine selection */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium">
                  Select machines to update ({selectedMachines.size} of {outdatedMachines.length} selected)
                </h3>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleSelectAll}
                    disabled={selectedMachines.size === outdatedMachines.length}
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleDeselectAll}
                    disabled={selectedMachines.size === 0}
                  >
                    Deselect All
                  </Button>
                </div>
              </div>

              <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
                {outdatedMachines.map((machine) => {
                  const isSelected = selectedMachines.has(machine.machineId);
                  const isUpdating = updatingMachines.has(machine.machineId);

                  return (
                    <label
                      key={machine.machineId}
                      className="flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleToggleMachine(machine.machineId)}
                        disabled={isUpdating}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">
                            {machine.machineId}
                          </span>
                          {isUpdating && (
                            <Badge variant="secondary" className="flex items-center gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Updating...
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          Current: {machine.agent_version ? `v${machine.agent_version}` : '< v2.0.8'} → Latest: v{latestVersion}
                        </div>
                      </div>
                      {machine.online ? (
                        <Badge className="bg-green-100 text-green-800 border-green-200">
                          Online
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          Offline
                        </Badge>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleUpdate}
              disabled={isUpdating || selectedMachines.size === 0}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {isUpdating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Update {selectedMachines.size} Machine{selectedMachines.size !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
