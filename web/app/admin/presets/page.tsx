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

        {/* Presets Table/Grid */}
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
          <>
            {/* Desktop Table View (hidden on mobile) */}
            <div className="hidden lg:block bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-750 border-b border-slate-700">
                    <tr>
                      <th className="px-4 xl:px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Preset
                      </th>
                      <th className="px-4 xl:px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Category
                      </th>
                      <th className="px-4 xl:px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Installer
                      </th>
                      <th className="hidden xl:table-cell px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Flags
                      </th>
                      <th className="px-4 xl:px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {filteredPresets.map((preset) => (
                      <tr key={preset.id} className="hover:bg-slate-750 transition-colors">
                        <td className="px-4 xl:px-6 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            {preset.icon && (
                              <span className="text-2xl flex-shrink-0">{preset.icon}</span>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-2 flex-wrap">
                                <p className="text-white font-medium text-sm">{preset.software_name}</p>
                                <p className="text-slate-400 text-sm">{preset.name}</p>
                              </div>
                              {preset.is_owlette_agent && (
                                <Badge variant="outline" className="mt-1 border-blue-600 text-blue-400 text-xs">
                                  Auto-update
                                </Badge>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 xl:px-6 py-3">
                          <Badge variant="outline" className="border-slate-600 text-slate-300 text-xs whitespace-nowrap">
                            {preset.category}
                          </Badge>
                        </td>
                        <td className="px-4 xl:px-6 py-3">
                          <p className="text-slate-300 text-sm font-mono truncate max-w-[200px]">{preset.installer_name}</p>
                          {preset.installer_url && (
                            <p className="text-slate-500 text-xs truncate max-w-[200px]">
                              {preset.installer_url.substring(0, 40)}...
                            </p>
                          )}
                        </td>
                        <td className="hidden xl:table-cell px-6 py-3">
                          <p className="text-slate-400 text-xs font-mono truncate max-w-[150px]" title={preset.silent_flags}>
                            {preset.silent_flags}
                          </p>
                        </td>
                        <td className="px-4 xl:px-6 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEdit(preset)}
                              className="border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDelete(preset)}
                              className="border-red-700 bg-red-900/20 text-red-400 hover:bg-red-900/40 hover:text-red-300 cursor-pointer"
                              title="Delete"
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

            {/* Mobile Card View */}
            <div className="lg:hidden space-y-4">
              {filteredPresets.map((preset) => (
                <div key={preset.id} className="bg-slate-800 border border-slate-700 rounded-lg p-4 hover:border-slate-600 transition-colors">
                  {/* Header with Icon and Name */}
                  <div className="flex items-start gap-3 mb-3">
                    {preset.icon && (
                      <span className="text-3xl flex-shrink-0">{preset.icon}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div>
                          <h3 className="text-white font-medium text-base">{preset.software_name}</h3>
                          <p className="text-slate-400 text-sm">{preset.name}</p>
                        </div>
                        <Badge variant="outline" className="border-slate-600 text-slate-300 text-xs whitespace-nowrap">
                          {preset.category}
                        </Badge>
                      </div>
                      {preset.is_owlette_agent && (
                        <Badge variant="outline" className="border-blue-600 text-blue-400 text-xs">
                          Auto-update
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Details */}
                  <div className="space-y-2 text-sm mb-3">
                    <div>
                      <p className="text-slate-500 text-xs mb-1">Installer</p>
                      <p className="text-slate-300 font-mono text-xs break-all">{preset.installer_name}</p>
                    </div>
                    {preset.installer_url && (
                      <div>
                        <p className="text-slate-500 text-xs mb-1">URL</p>
                        <p className="text-slate-400 text-xs truncate">{preset.installer_url}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-slate-500 text-xs mb-1">Flags</p>
                      <p className="text-slate-400 text-xs font-mono break-all">{preset.silent_flags}</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-3 border-t border-slate-700">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(preset)}
                      className="flex-1 border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(preset)}
                      className="flex-1 border-red-700 bg-red-900/20 text-red-400 hover:bg-red-900/40 hover:text-red-300 cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
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
