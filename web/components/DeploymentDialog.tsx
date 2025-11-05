'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Download, Loader2, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMachines } from '@/hooks/useFirestore';
import { DeploymentTemplate, Deployment } from '@/hooks/useDeployments';
import { Badge } from '@/components/ui/badge';
import { useSystemPresets } from '@/hooks/useSystemPresets';
import { useInstallerVersion } from '@/hooks/useInstallerVersion';
import { SelectGroup, SelectLabel } from '@/components/ui/select';

interface DeploymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  templates: DeploymentTemplate[];
  onCreateDeployment: (deployment: Omit<Deployment, 'id' | 'createdAt' | 'status'>, machineIds: string[]) => Promise<string>;
  onCreateTemplate: (template: Omit<DeploymentTemplate, 'id' | 'createdAt'>) => Promise<string>;
  onUpdateTemplate: (templateId: string, template: Partial<Omit<DeploymentTemplate, 'id' | 'createdAt'>>) => Promise<void>;
  onDeleteTemplate: (templateId: string) => Promise<void>;
}

export default function DeploymentDialog({
  open,
  onOpenChange,
  siteId,
  templates,
  onCreateDeployment,
  onCreateTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
}: DeploymentDialogProps) {
  const { machines } = useMachines(siteId);
  const { presets, categories } = useSystemPresets();
  const { version: latestInstallerVersion, downloadUrl: latestInstallerUrl } = useInstallerVersion();

  const [deploymentName, setDeploymentName] = useState('');
  const [installerName, setInstallerName] = useState('');
  const [installerUrl, setInstallerUrl] = useState('');
  const [silentFlags, setSilentFlags] = useState('');
  const [verifyPath, setVerifyPath] = useState('');
  const [selectedMachines, setSelectedMachines] = useState<Set<string>>(new Set());
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [editingTemplate, setEditingTemplate] = useState<string>('');  // ID of template being edited
  const [selectedPreset, setSelectedPreset] = useState<string>('');  // ID of selected system preset

  const allMachinesSelected = selectedMachines.size === machines.length && machines.length > 0;
  const onlineMachines = machines.filter(m => m.online);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setDeploymentName('');
      setInstallerName('');
      setInstallerUrl('');
      setSilentFlags('');
      setVerifyPath('');
      setSelectedMachines(new Set());
      setSaveAsTemplate(false);
      setSelectedTemplate('');
      setEditingTemplate('');
      setSelectedPreset('');
    }
  }, [open]);

  const handleTemplateSelect = (templateId: string) => {
    if (templateId === 'none') {
      setSelectedTemplate('');
      setEditingTemplate('');
      return;
    }

    const template = templates.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplate(templateId);
      setDeploymentName(template.name);
      setInstallerName(template.installer_name);
      setInstallerUrl(template.installer_url);
      setSilentFlags(template.silent_flags);
      setVerifyPath(template.verify_path || '');
      setEditingTemplate('');

      // Clear preset selection when template is selected
      setSelectedPreset('');
    }
  };

  const handlePresetSelect = (presetId: string) => {
    if (presetId === 'none') {
      setSelectedPreset('');
      return;
    }

    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      setSelectedPreset(presetId);

      // Populate form with preset data
      if (preset.is_owlette_agent) {
        // Special handling for Owlette Agent preset - fetch latest from installer_metadata
        setDeploymentName(`Update Owlette to v${latestInstallerVersion || 'latest'}`);
        setInstallerName(preset.installer_name);
        setInstallerUrl(latestInstallerUrl || ''); // Dynamic URL from installer_metadata
      } else {
        // Standard preset
        setDeploymentName(`Deploy ${preset.software_name}`);
        setInstallerName(preset.installer_name);
        setInstallerUrl(preset.installer_url);
      }

      setSilentFlags(preset.silent_flags);
      setVerifyPath(preset.verify_path || '');

      // Clear template selection when preset is selected
      setSelectedTemplate('');
      setEditingTemplate('');
    }
  };

  const handleEditTemplate = () => {
    if (selectedTemplate) {
      setEditingTemplate(selectedTemplate);
      setSaveAsTemplate(false);
      toast.info('Edit the template fields below and deploy to save changes');
    }
  };

  const handleDeleteTemplate = async () => {
    if (!selectedTemplate) return;

    const template = templates.find(t => t.id === selectedTemplate);
    if (!template) return;

    if (!confirm(`Delete template "${template.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await onDeleteTemplate(selectedTemplate);
      toast.success('Template deleted successfully');

      // Clear form
      setSelectedTemplate('');
      setEditingTemplate('');
      setDeploymentName('');
      setInstallerName('');
      setInstallerUrl('');
      setSilentFlags('');
      setVerifyPath('');
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete template');
    }
  };

  const toggleMachine = (machineId: string) => {
    const newSelected = new Set(selectedMachines);
    if (newSelected.has(machineId)) {
      newSelected.delete(machineId);
    } else {
      newSelected.add(machineId);
    }
    setSelectedMachines(newSelected);
  };

  const toggleAllMachines = () => {
    if (allMachinesSelected) {
      setSelectedMachines(new Set());
    } else {
      setSelectedMachines(new Set(machines.map(m => m.machineId)));
    }
  };

  const selectOnlyOnlineMachines = () => {
    setSelectedMachines(new Set(onlineMachines.map(m => m.machineId)));
  };

  const handleDeploy = async () => {
    // Validation
    if (!deploymentName.trim()) {
      toast.error('Please provide a deployment name');
      return;
    }

    if (!installerName.trim()) {
      toast.error('Please provide an installer name');
      return;
    }

    if (!installerUrl.trim()) {
      toast.error('Please provide an installer URL');
      return;
    }

    // Validate URL format
    try {
      new URL(installerUrl);
    } catch (e) {
      toast.error('Invalid installer URL format');
      return;
    }

    if (selectedMachines.size === 0) {
      toast.error('Please select at least one machine');
      return;
    }

    setDeploying(true);

    try {
      // Update existing template if in edit mode
      if (editingTemplate) {
        const templateData: any = {
          name: deploymentName,
          installer_name: installerName,
          installer_url: installerUrl,
          silent_flags: silentFlags,
        };
        if (verifyPath?.trim()) templateData.verify_path = verifyPath.trim();

        await onUpdateTemplate(editingTemplate, templateData);
        toast.success('Template updated successfully!');
        setEditingTemplate('');
      }
      // Save as new template if requested
      else if (saveAsTemplate) {
        const templateData: any = {
          name: deploymentName,
          installer_name: installerName,
          installer_url: installerUrl,
          silent_flags: silentFlags,
        };
        if (verifyPath?.trim()) templateData.verify_path = verifyPath.trim();

        await onCreateTemplate(templateData);
        toast.success('Template saved successfully!');
      }

      // Check if this is an Owlette update deployment
      const selectedPresetData = selectedPreset ? presets.find(p => p.id === selectedPreset) : null;
      const isOwletteUpdate = selectedPresetData?.is_owlette_agent || false;

      // Build deployment object, excluding undefined fields
      const deploymentData: any = {
        name: deploymentName,
        installer_name: installerName,
        installer_url: installerUrl,
        silent_flags: silentFlags,
        targets: [],  // Will be filled by the hook
      };

      // Only add optional fields if they have values (Firestore doesn't accept undefined)
      if (verifyPath?.trim()) deploymentData.verify_path = verifyPath.trim();
      if (isOwletteUpdate) deploymentData.is_owlette_update = true;

      // Create deployment
      const deploymentId = await onCreateDeployment(
        deploymentData,
        Array.from(selectedMachines)
      );

      toast.success(`Deployment started! Installing on ${selectedMachines.size} machine${selectedMachines.size > 1 ? 's' : ''}`);

      // Reset form
      setDeploymentName('');
      setInstallerName('');
      setInstallerUrl('');
      setSilentFlags('');
      setVerifyPath('');
      setSelectedMachines(new Set());
      setSaveAsTemplate(false);
      setSelectedTemplate('');

      onOpenChange(false);
    } catch (error: any) {
      console.error('Deployment error:', error);
      toast.error(error.message || 'Failed to create deployment');
    } finally {
      setDeploying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-700 bg-slate-800 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Deploy Software</DialogTitle>
          <DialogDescription className="text-slate-400">
            Install software across multiple machines simultaneously
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Template Selection */}
          {templates.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="template" className="text-white">My Templates</Label>
              <div className="flex gap-2">
                <Select value={selectedTemplate} onValueChange={handleTemplateSelect}>
                  <SelectTrigger className="border-slate-700 bg-slate-900 text-white flex-1">
                    <SelectValue placeholder="Select a template..." />
                  </SelectTrigger>
                  <SelectContent className="border-slate-700 bg-slate-800">
                    <SelectItem value="none" className="text-white focus:bg-slate-700 focus:text-white">
                      None
                    </SelectItem>
                    {templates.map((template) => (
                      <SelectItem
                        key={template.id}
                        value={template.id}
                        className="text-white focus:bg-slate-700 focus:text-white"
                      >
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedTemplate && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={handleEditTemplate}
                      className="border-slate-700 bg-slate-900 text-white hover:bg-slate-700 hover:text-white cursor-pointer"
                      title="Edit template"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={handleDeleteTemplate}
                      className="border-slate-700 bg-slate-900 text-red-400 hover:bg-red-900 hover:text-red-300 cursor-pointer"
                      title="Delete template"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
              {editingTemplate && (
                <div className="flex items-center gap-2 p-2 bg-blue-900/30 border border-blue-700 rounded text-sm">
                  <Pencil className="h-3 w-3 text-blue-400" />
                  <span className="text-blue-300">Editing template - changes will be saved when you deploy</span>
                </div>
              )}
            </div>
          )}

          {/* Template Library */}
          {presets.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="system-preset" className="text-white">Template Library</Label>
              <Select value={selectedPreset} onValueChange={handlePresetSelect}>
                <SelectTrigger className="border-slate-700 bg-slate-900 text-white">
                  <SelectValue placeholder="Select a template..." />
                </SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-800">
                  <SelectItem value="none" className="text-white focus:bg-slate-700 focus:text-white">
                    None
                  </SelectItem>
                  {categories.map(category => {
                    const categoryPresets = presets.filter(p => p.category === category);
                    if (categoryPresets.length === 0) return null;

                    return (
                      <SelectGroup key={category}>
                        <SelectLabel className="text-slate-400">{category}</SelectLabel>
                        {categoryPresets.map(preset => (
                          <SelectItem
                            key={preset.id}
                            value={preset.id}
                            className="text-white focus:bg-slate-700 focus:text-white"
                          >
                            <span className="flex items-center gap-2">
                              {preset.icon && <span>{preset.icon}</span>}
                              <span>{preset.name}</span>
                              {preset.is_owlette_agent && (
                                <Badge variant="outline" className="ml-2 border-blue-600 text-blue-400 text-xs">
                                  Auto
                                </Badge>
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                Admin-curated software catalog (TouchDesigner, VLC, Owlette Agent, etc.)
              </p>
            </div>
          )}

          {/* Deployment Name */}
          <div className="space-y-2">
            <Label htmlFor="deployment-name" className="text-white">Deployment Name</Label>
            <Input
              id="deployment-name"
              placeholder="e.g., TouchDesigner 2023.11760"
              value={deploymentName}
              onChange={(e) => setDeploymentName(e.target.value)}
              className="border-slate-700 bg-slate-900 text-white"
            />
          </div>

          {/* Installer Name */}
          <div className="space-y-2">
            <Label htmlFor="installer-name" className="text-white">Installer Filename</Label>
            <Input
              id="installer-name"
              placeholder="e.g., TouchDesigner.exe"
              value={installerName}
              onChange={(e) => setInstallerName(e.target.value)}
              className="border-slate-700 bg-slate-900 text-white"
            />
            <p className="text-xs text-slate-500">The filename to save the installer as</p>
          </div>

          {/* Installer URL */}
          <div className="space-y-2">
            <Label htmlFor="installer-url" className="text-white">Installer URL</Label>
            <Input
              id="installer-url"
              placeholder="https://example.com/installer.exe"
              value={installerUrl}
              onChange={(e) => setInstallerUrl(e.target.value)}
              className="border-slate-700 bg-slate-900 text-white font-mono text-sm"
            />
            <p className="text-xs text-slate-500">Direct download link to the installer</p>
          </div>

          {/* Silent Flags */}
          <div className="space-y-2">
            <Label htmlFor="silent-flags" className="text-white">Silent Install Flags</Label>
            <Input
              id="silent-flags"
              placeholder='/VERYSILENT /DIR="C:\\Program Files\\App"'
              value={silentFlags}
              onChange={(e) => setSilentFlags(e.target.value)}
              className="border-slate-700 bg-slate-900 text-white"
            />
            <p className="text-xs text-slate-500">Command-line flags for silent installation</p>
          </div>

          {/* Verify Path (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="verify-path" className="text-white">Verify Path (Optional)</Label>
            <Input
              id="verify-path"
              placeholder='C:\\Program Files\\App\\app.exe'
              value={verifyPath}
              onChange={(e) => setVerifyPath(e.target.value)}
              className="border-slate-700 bg-slate-900 text-white"
            />
            <p className="text-xs text-slate-500">Path to verify after installation completes</p>
          </div>

          {/* Target Machines */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-white">Target Machines ({selectedMachines.size} selected)</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={selectOnlyOnlineMachines}
                  className="border-slate-700 bg-slate-900 text-white hover:bg-slate-700 hover:text-white cursor-pointer text-xs"
                >
                  Online Only ({onlineMachines.length})
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={toggleAllMachines}
                  className="border-slate-700 bg-slate-900 text-white hover:bg-slate-700 hover:text-white cursor-pointer text-xs"
                >
                  {allMachinesSelected ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
            </div>

            <div className="border border-slate-700 rounded-lg p-3 bg-slate-900 max-h-48 overflow-y-auto space-y-2">
              {machines.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-2">No machines available</p>
              ) : (
                machines.map((machine) => (
                  <div
                    key={machine.machineId}
                    className="flex items-center justify-between p-2 rounded hover:bg-slate-800 cursor-pointer"
                    onClick={() => toggleMachine(machine.machineId)}
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={selectedMachines.has(machine.machineId)}
                        onCheckedChange={() => toggleMachine(machine.machineId)}
                        className="cursor-pointer"
                      />
                      <span className="text-white">{machine.machineId}</span>
                    </div>
                    <Badge className={`text-xs ${machine.online ? 'bg-green-600' : 'bg-red-600'}`}>
                      {machine.online ? 'Online' : 'Offline'}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Save as Template */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="save-template"
              checked={saveAsTemplate}
              onCheckedChange={(checked) => setSaveAsTemplate(checked as boolean)}
              className="cursor-pointer"
            />
            <Label htmlFor="save-template" className="text-white cursor-pointer">
              Save as template for future deployments
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700 hover:text-white cursor-pointer"
            disabled={deploying}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDeploy}
            className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
            disabled={deploying}
          >
            {deploying ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Deploying...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Deploy to {selectedMachines.size} Machine{selectedMachines.size !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
