'use client';

import { useState } from 'react';
import { useSystemPresets, type SystemPreset } from '@/hooks/useSystemPresets';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Settings, Plus, Loader2, Pencil, Trash2, Package } from 'lucide-react';
import { toast } from 'sonner';
import SystemPresetDialog from '@/components/SystemPresetDialog';

/**
 * System Presets Admin Page
 *
 * Admin-only page for managing software deployment presets.
 * Allows admins to:
 * - View all system presets
 * - Create new presets
 * - Edit existing presets
 * - Delete presets
 */
export default function SystemPresetsPage() {
  const {
    presets,
    loading,
    error,
    deletePreset,
    categories,
  } = useSystemPresets();

  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<SystemPreset | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [presetToDelete, setPresetToDelete] = useState<SystemPreset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  const handleCreateNew = () => {
    setEditingPreset(null);
    setPresetDialogOpen(true);
  };

  const handleEdit = (preset: SystemPreset) => {
    setEditingPreset(preset);
    setPresetDialogOpen(true);
  };

  const handleDelete = (preset: SystemPreset) => {
    setPresetToDelete(preset);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!presetToDelete) return;

    setDeleting(true);

    try {
      await deletePreset(presetToDelete.id);
      toast.success('Preset Deleted', {
        description: `"${presetToDelete.name}" has been deleted.`,
      });
      setDeleteDialogOpen(false);
      setPresetToDelete(null);
    } catch (err: any) {
      toast.error('Delete Failed', {
        description: err.message || 'Failed to delete preset.',
      });
    } finally {
      setDeleting(false);
    }
  };

  // Filter presets by selected category
  const filteredPresets = selectedCategory === 'All'
    ? presets
    : presets.filter(p => p.category === selectedCategory);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="flex items-center gap-3 text-slate-300">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading presets...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="text-center">
          <p className="text-red-400 font-medium mb-2">Error loading presets</p>
          <p className="text-slate-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Template Library</h1>
              <p className="text-slate-400">
                Admin-curated software catalog for deployments (TouchDesigner, VLC, Owlette Agent, etc.)
              </p>
            </div>
            <Button
              onClick={handleCreateNew}
              className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
            >
              <Plus className="h-5 w-5 mr-2" />
              Add Template
            </Button>
          </div>

          {/* Category Filter Tabs */}
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={selectedCategory === 'All' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory('All')}
              className={
                selectedCategory === 'All'
                  ? 'bg-blue-600 text-white cursor-pointer'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer'
              }
            >
              All ({presets.length})
            </Button>
            {categories.map(category => {
              const count = presets.filter(p => p.category === category).length;
              return (
                <Button
                  key={category}
                  variant={selectedCategory === category ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategory(category)}
                  className={
                    selectedCategory === category
                      ? 'bg-blue-600 text-white cursor-pointer'
                      : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer'
                  }
                >
                  {category} ({count})
                </Button>
              );
            })}
          </div>
        </div>

        {/* Presets Table */}
        {filteredPresets.length === 0 ? (
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-12 text-center">
            <Package className="h-16 w-16 text-slate-600 mx-auto mb-4" />
            <h3 className="text-xl font-medium text-white mb-2">No Presets Found</h3>
            <p className="text-slate-400 mb-6">
              {selectedCategory === 'All'
                ? 'Create your first system preset to get started.'
                : `No presets found in "${selectedCategory}" category.`}
            </p>
            {selectedCategory === 'All' && (
              <Button
                onClick={handleCreateNew}
                className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
              >
                <Plus className="h-5 w-5 mr-2" />
                Add First Preset
              </Button>
            )}
          </div>
        ) : (
          <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-750 border-b border-slate-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Preset
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Installer
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Flags
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {filteredPresets.map((preset) => (
                    <tr key={preset.id} className="hover:bg-slate-750 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {preset.icon && (
                            <span className="text-2xl">{preset.icon}</span>
                          )}
                          <div>
                            <p className="text-white font-medium">{preset.name}</p>
                            <p className="text-slate-400 text-sm">{preset.software_name}</p>
                            {preset.is_owlette_agent && (
                              <Badge variant="outline" className="mt-1 border-blue-600 text-blue-400 text-xs">
                                Auto-update
                              </Badge>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant="outline" className="border-slate-600 text-slate-300">
                          {preset.category}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-slate-300 text-sm font-mono">{preset.installer_name}</p>
                        {preset.installer_url && (
                          <p className="text-slate-500 text-xs truncate max-w-xs">
                            {preset.installer_url.substring(0, 50)}...
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-slate-400 text-xs font-mono">
                          {preset.silent_flags}
                        </p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEdit(preset)}
                            className="border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(preset)}
                            className="border-red-700 bg-red-900/20 text-red-400 hover:bg-red-900/40 hover:text-red-300 cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Create/Edit Preset Dialog */}
        <SystemPresetDialog
          open={presetDialogOpen}
          onOpenChange={setPresetDialogOpen}
          preset={editingPreset}
        />

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent className="border-slate-700 bg-slate-800 text-white">
            <DialogHeader>
              <DialogTitle>Delete Preset</DialogTitle>
              <DialogDescription className="text-slate-400">
                Are you sure you want to delete "{presetToDelete?.name}"? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteDialogOpen(false);
                  setPresetToDelete(null);
                }}
                disabled={deleting}
                className="border-slate-700 bg-slate-900 text-white hover:bg-slate-700 cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                onClick={confirmDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-700 text-white cursor-pointer"
              >
                {deleting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete Preset'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
