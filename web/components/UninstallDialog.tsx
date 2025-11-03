'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash2, Loader2, Package } from 'lucide-react';
import { toast } from 'sonner';
import { useMachines } from '@/hooks/useFirestore';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

interface Software {
  name: string;
  version: string;
  publisher: string;
  install_location: string;
  uninstall_command: string;
  installer_type: string;
  registry_key: string;
}

interface UninstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  onCreateUninstall: (softwareName: string, machineIds: string[]) => Promise<void>;
}

export default function UninstallDialog({
  open,
  onOpenChange,
  siteId,
  onCreateUninstall,
}: UninstallDialogProps) {
  const { machines } = useMachines(siteId);
  const [selectedMachines, setSelectedMachines] = useState<Set<string>>(new Set());
  const [availableSoftware, setAvailableSoftware] = useState<Software[]>([]);
  const [selectedSoftware, setSelectedSoftware] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);

  const allMachinesSelected = selectedMachines.size === machines.length && machines.length > 0;
  const onlineMachines = machines.filter(m => m.online);

  // Fetch installed software from selected machines
  useEffect(() => {
    if (!open || selectedMachines.size === 0) {
      setAvailableSoftware([]);
      return;
    }

    const fetchSoftware = async () => {
      setLoading(true);
      try {
        // Fetch software from Firestore for selected machines
        const { collection, getDocs } = await import('firebase/firestore');
        const { db } = await import('@/lib/firebase');

        const softwareMap = new Map<string, Software>();

        // Fetch from each selected machine
        for (const machineId of Array.from(selectedMachines)) {
          const machine = machines.find(m => m.machineId === machineId);
          if (!machine || !machine.online) continue; // Only fetch from online machines

          try {
            const softwareRef = collection(db!, 'sites', siteId, 'machines', machineId, 'installed_software');
            const snapshot = await getDocs(softwareRef);

            snapshot.forEach((doc) => {
              const data = doc.data() as Software;
              const key = `${data.name}_${data.version}`;

              // Only add if not already in map (avoid duplicates)
              if (!softwareMap.has(key)) {
                softwareMap.set(key, data);
              }
            });
          } catch (err) {
            console.error(`Failed to fetch software from ${machineId}:`, err);
          }
        }

        const softwareList = Array.from(softwareMap.values());
        softwareList.sort((a, b) => a.name.localeCompare(b.name));
        setAvailableSoftware(softwareList);
      } catch (error: any) {
        console.error('Failed to fetch software:', error);
        toast.error('Failed to fetch installed software');
      } finally {
        setLoading(false);
      }
    };

    fetchSoftware();
  }, [open, selectedMachines, siteId, machines]);

  const toggleMachine = (machineId: string) => {
    const newSelected = new Set(selectedMachines);
    if (newSelected.has(machineId)) {
      newSelected.delete(machineId);
    } else {
      newSelected.add(machineId);
    }
    setSelectedMachines(newSelected);
    // Clear selected software when machines change
    setSelectedSoftware('');
  };

  const toggleAllMachines = () => {
    if (allMachinesSelected) {
      setSelectedMachines(new Set());
    } else {
      setSelectedMachines(new Set(machines.map(m => m.machineId)));
    }
    setSelectedSoftware('');
  };

  const selectOnlyOnlineMachines = () => {
    setSelectedMachines(new Set(onlineMachines.map(m => m.machineId)));
    setSelectedSoftware('');
  };

  const handleUninstall = async () => {
    // Validation
    if (selectedMachines.size === 0) {
      toast.error('Please select at least one machine');
      return;
    }

    if (!selectedSoftware) {
      toast.error('Please select software to uninstall');
      return;
    }

    const software = availableSoftware.find(s => `${s.name}_${s.version}` === selectedSoftware);
    if (!software) {
      toast.error('Selected software not found');
      return;
    }

    // Confirm uninstall
    const machineCount = selectedMachines.size;
    const confirmMsg = `Uninstall "${software.name}" from ${machineCount} machine${machineCount > 1 ? 's' : ''}?\n\nThis action cannot be undone.`;
    if (!confirm(confirmMsg)) {
      return;
    }

    setUninstalling(true);
    try {
      await onCreateUninstall(software.name, Array.from(selectedMachines));
      toast.success(`Uninstall initiated for ${software.name} on ${machineCount} machine${machineCount > 1 ? 's' : ''}`);

      // Close dialog and reset
      onOpenChange(false);
      setSelectedMachines(new Set());
      setSelectedSoftware('');
      setAvailableSoftware([]);
    } catch (error: any) {
      toast.error(error.message || 'Failed to create uninstall task');
    } finally {
      setUninstalling(false);
    }
  };

  const selectedSoftwareInfo = availableSoftware.find(s => `${s.name}_${s.version}` === selectedSoftware);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5" />
            Uninstall Software
          </DialogTitle>
          <DialogDescription>
            Select machines and software to uninstall remotely
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Step 1: Select Machines */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">1. Select Target Machines</Label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={selectOnlyOnlineMachines}
                  disabled={onlineMachines.length === 0}
                >
                  Online Only ({onlineMachines.length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={toggleAllMachines}
                >
                  {allMachinesSelected ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
            </div>

            <div className="border rounded-md p-4 max-h-48 overflow-y-auto">
              {machines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No machines available</p>
              ) : (
                <div className="space-y-2">
                  {machines.map((machine) => (
                    <div key={machine.machineId} className="flex items-center space-x-2">
                      <Checkbox
                        id={`machine-${machine.machineId}`}
                        checked={selectedMachines.has(machine.machineId)}
                        onCheckedChange={() => toggleMachine(machine.machineId)}
                      />
                      <label
                        htmlFor={`machine-${machine.machineId}`}
                        className="flex-1 text-sm font-medium leading-none cursor-pointer flex items-center gap-2"
                      >
                        {machine.machineId}
                        {machine.online ? (
                          <Badge variant="default" className="ml-2">Online</Badge>
                        ) : (
                          <Badge variant="secondary" className="ml-2">Offline</Badge>
                        )}
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Step 2: Select Software */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">2. Select Software to Uninstall</Label>

            {selectedMachines.size === 0 ? (
              <p className="text-sm text-muted-foreground">Select machines first to see available software</p>
            ) : loading ? (
              <div className="flex items-center gap-2 p-4 border rounded-md">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading installed software...</span>
              </div>
            ) : availableSoftware.length === 0 ? (
              <p className="text-sm text-muted-foreground">No software detected on selected machines (may need to wait for inventory sync)</p>
            ) : (
              <>
                <Select value={selectedSoftware} onValueChange={setSelectedSoftware}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select software to uninstall" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSoftware.map((software) => (
                      <SelectItem key={`${software.name}_${software.version}`} value={`${software.name}_${software.version}`}>
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4" />
                          <span>{software.name}</span>
                          {software.version && <span className="text-muted-foreground text-xs">v{software.version}</span>}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Software Details */}
                {selectedSoftwareInfo && (
                  <Card className="mt-3">
                    <CardContent className="pt-4 space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="font-semibold">Name:</span> {selectedSoftwareInfo.name}
                        </div>
                        <div>
                          <span className="font-semibold">Version:</span> {selectedSoftwareInfo.version || 'N/A'}
                        </div>
                        <div>
                          <span className="font-semibold">Publisher:</span> {selectedSoftwareInfo.publisher || 'N/A'}
                        </div>
                        <div>
                          <span className="font-semibold">Type:</span> {selectedSoftwareInfo.installer_type.toUpperCase()}
                        </div>
                        {selectedSoftwareInfo.install_location && (
                          <div className="col-span-2">
                            <span className="font-semibold">Location:</span>
                            <span className="text-muted-foreground ml-1 font-mono text-xs">{selectedSoftwareInfo.install_location}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uninstalling}>
            Cancel
          </Button>
          <Button
            onClick={handleUninstall}
            disabled={selectedMachines.size === 0 || !selectedSoftware || uninstalling}
            variant="destructive"
          >
            {uninstalling ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uninstalling...
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                Uninstall Software
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
