'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useSites } from '@/hooks/useFirestore';
import { useProjectDistributionManager } from '@/hooks/useProjectDistributions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ChevronRight, Plus, FolderArchive, CheckCircle2, XCircle, Clock, Loader2, Settings, ChevronDown, Pencil, Trash2, Check, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Image from 'next/image';
import ProjectDistributionDialog from '@/components/ProjectDistributionDialog';
import { toast } from 'sonner';

export default function ProjectsPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { sites, loading: sitesLoading, createSite, renameSite, deleteSite } = useSites();
  const [currentSiteId, setCurrentSiteId] = useState<string>('');
  const [distributionDialogOpen, setDistributionDialogOpen] = useState(false);
  const [selectedDistributionId, setSelectedDistributionId] = useState<string | null>(null);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteId, setNewSiteId] = useState('');
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingDialogOpen, setDeletingDialogOpen] = useState(false);
  const [siteToDelete, setSiteToDelete] = useState<string | null>(null);
  const router = useRouter();

  const {
    distributions,
    distributionsLoading,
    templates,
    templatesLoading,
    createDistribution,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    cancelDistribution,
    deleteDistribution,
  } = useProjectDistributionManager(currentSiteId);

  // Load saved site from localStorage or use first available
  useEffect(() => {
    if (!sitesLoading && sites.length > 0 && !currentSiteId) {
      const savedSite = localStorage.getItem('owlette_current_site');
      if (savedSite && sites.find(s => s.id === savedSite)) {
        setCurrentSiteId(savedSite);
      } else {
        setCurrentSiteId(sites[0].id);
      }
    }
  }, [sites, sitesLoading, currentSiteId]);

  // Save site selection to localStorage
  const handleSiteChange = (siteId: string) => {
    setCurrentSiteId(siteId);
    localStorage.setItem('owlette_current_site', siteId);
  };

  const handleCreateSite = async () => {
    if (!newSiteName || !newSiteId) {
      toast.error('Please provide both site ID and name');
      return;
    }

    try {
      await createSite(newSiteId, newSiteName);
      toast.success(`Site "${newSiteName}" created successfully!`);
      setCreateDialogOpen(false);
      setNewSiteName('');
      setNewSiteId('');
      handleSiteChange(newSiteId);
    } catch (error: any) {
      toast.error(error.message || 'Failed to create site');
    }
  };

  const startEditingSite = (siteId: string, currentName: string) => {
    setEditingSiteId(siteId);
    setEditingName(currentName);
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
      await renameSite(siteId, editingName);
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

    // Prevent deleting the last site
    if (sites.length === 1) {
      toast.error('Cannot delete the last site');
      setDeletingDialogOpen(false);
      setSiteToDelete(null);
      return;
    }

    try {
      await deleteSite(siteToDelete);

      // If we deleted the current site, switch to another one
      if (siteToDelete === currentSiteId) {
        const remainingSites = sites.filter(s => s.id !== siteToDelete);
        if (remainingSites.length > 0) {
          handleSiteChange(remainingSites[0].id);
        }
      }

      toast.success('Site deleted successfully!');
      setDeletingDialogOpen(false);
      setSiteToDelete(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete site');
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <p className="text-slate-400">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'in_progress':
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      case 'partial':
        return <Clock className="h-5 w-5 text-yellow-500" />;
      default:
        return <Clock className="h-5 w-5 text-slate-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      completed: 'bg-green-600 hover:bg-green-700',
      failed: 'bg-red-600 hover:bg-red-700',
      in_progress: 'bg-blue-600 hover:bg-blue-700',
      partial: 'bg-yellow-600 hover:bg-yellow-700',
      pending: 'bg-slate-600 hover:bg-slate-700',
      downloading: 'bg-cyan-600 hover:bg-cyan-700',
      extracting: 'bg-purple-600 hover:bg-purple-700',
    };

    return (
      <Badge className={`select-none ${colors[status] || colors.pending}`}>
        {status.replace('_', ' ')}
      </Badge>
    );
  };

  const selectedDistribution = distributions.find(d => d.id === selectedDistributionId);

  return (
    <div className="min-h-screen bg-slate-950 pb-8">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <Image src="/owlette-icon.png" alt="Owlette" width={32} height={32} />
              <h1 className="text-xl font-bold text-white">Owlette</h1>

              {/* Breadcrumb separator */}
              <ChevronRight className="h-4 w-4 text-slate-600" />

              {/* Navigation Menu - Breadcrumb style */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer">
                    <span className="text-lg">Distribute Projects</span>
                    <ChevronDown className="h-4 w-4 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="border-slate-700 bg-slate-800">
                  <DropdownMenuItem
                    onClick={() => router.push('/dashboard')}
                    className="text-white focus:bg-slate-700 focus:text-white cursor-pointer"
                  >
                    Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => router.push('/deployments')}
                    className="text-white focus:bg-slate-700 focus:text-white cursor-pointer"
                  >
                    Deploy Software
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => router.push('/projects')}
                    className="text-white focus:bg-slate-700 focus:text-white cursor-pointer"
                  >
                    Distribute Projects
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Site Selector */}
            {sites.length > 0 && (
              <div className="flex items-center gap-2">
                <ChevronRight className="h-4 w-4 text-slate-600" />
                <Select value={currentSiteId} onValueChange={handleSiteChange}>
                  <SelectTrigger className="w-[200px] border-slate-700 bg-slate-800 text-white cursor-pointer">
                    <SelectValue placeholder="Select site" />
                  </SelectTrigger>
                  <SelectContent className="border-slate-700 bg-slate-800">
                    {sites.map((site) => (
                      <SelectItem
                        key={site.id}
                        value={site.id}
                        className="text-white focus:bg-slate-700 focus:text-white"
                      >
                        {site.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Manage Sites Dialog */}
                <Dialog open={manageDialogOpen} onOpenChange={setManageDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700 hover:text-white cursor-pointer">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
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
                                <p className="text-xs text-slate-400">{site.id}</p>
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
                  </DialogContent>
                </Dialog>

                {/* Create Site Dialog */}
                <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700 hover:text-white cursor-pointer">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
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
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setCreateDialogOpen(false)} className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700 hover:text-white cursor-pointer">
                        Cancel
                      </Button>
                      <Button onClick={handleCreateSite} className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer">
                        Create Site
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-400 select-text">{user.email}</span>
            <Button variant="outline" onClick={signOut} className="cursor-pointer border-slate-700 bg-slate-800 text-white hover:bg-slate-700 hover:text-white select-none">
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl p-4">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white">Project Distributions</h2>
            <p className="text-slate-400">
              Distribute project files (ZIPs, .toe files, etc.) across your machines
            </p>
          </div>

          <ProjectDistributionDialog
            open={distributionDialogOpen}
            onOpenChange={setDistributionDialogOpen}
            siteId={currentSiteId}
            templates={templates}
            onCreateDistribution={createDistribution}
            onCreateTemplate={createTemplate}
            onUpdateTemplate={updateTemplate}
            onDeleteTemplate={deleteTemplate}
          />
        </div>

        {/* Quick Stats */}
        <div className="mb-8 grid gap-4 md:grid-cols-4">
          <Card className="border-slate-800 bg-slate-900">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-200">Total Distributions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{distributions.length}</div>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-200">In Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {distributions.filter(d => d.status === 'in_progress').length}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-200">Completed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {distributions.filter(d => d.status === 'completed').length}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-200">Templates</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{templates.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Distributions List */}
        <div className="space-y-4">
          {distributionsLoading ? (
            <Card className="border-slate-800 bg-slate-900">
              <CardContent className="p-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-slate-400" />
                <p className="mt-2 text-slate-400">Loading distributions...</p>
              </CardContent>
            </Card>
          ) : distributions.length === 0 ? (
            <Card className="border-slate-800 bg-slate-900">
              <CardHeader>
                <CardTitle className="text-white">No Distributions Yet</CardTitle>
                <CardDescription className="text-slate-400">
                  Create your first distribution to sync project files across your machines
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => setDistributionDialogOpen(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  New Distribution
                </Button>
              </CardContent>
            </Card>
          ) : (
            distributions.map((distribution) => (
              <Card
                key={distribution.id}
                className="border-slate-800 bg-slate-900 cursor-pointer hover:border-slate-700 transition-colors"
                onClick={() => setSelectedDistributionId(distribution.id === selectedDistributionId ? null : distribution.id)}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(distribution.status)}
                      <div>
                        <CardTitle className="text-white select-text">{distribution.name}</CardTitle>
                        <CardDescription className="text-slate-400 select-text text-xs">
                          {(() => {
                            try {
                              const url = new URL(distribution.project_url);
                              const filename = url.pathname.substring(url.pathname.lastIndexOf('/') + 1);
                              return filename || 'project.zip';
                            } catch {
                              return 'Invalid URL';
                            }
                          })()}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(distribution.status)}
                      <span className="text-xs text-slate-500">
                        {new Date(distribution.createdAt).toLocaleString()}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await deleteDistribution(distribution.id);
                          } catch (error: any) {
                            console.error('Failed to delete distribution:', error);
                          }
                        }}
                        className="h-7 px-2 text-slate-400 hover:text-red-400 hover:bg-red-950/30 cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {selectedDistributionId === distribution.id && (
                  <CardContent className="space-y-4 border-t border-slate-800 pt-4">
                    <div className="grid gap-3 text-sm">
                      <div>
                        <div className="text-slate-400 mb-1">Project URL:</div>
                        <div className="text-white select-text break-all">{distribution.project_url}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 mb-1">Extract Path:</div>
                        <div className="text-white select-text break-all">
                          {distribution.extract_path || <span className="text-slate-500 italic">~/Documents/OwletteProjects (default)</span>}
                        </div>
                      </div>
                      {distribution.verify_files && distribution.verify_files.length > 0 && (
                        <div>
                          <div className="text-slate-400 mb-1">Verify Files:</div>
                          <div className="text-white select-text break-all">{distribution.verify_files.join(', ')}</div>
                        </div>
                      )}
                    </div>

                    <div>
                      <h4 className="text-sm font-medium text-white mb-2">Target Machines ({distribution.targets.length})</h4>
                      <div className="space-y-2">
                        {distribution.targets.map((target) => (
                          <div key={target.machineId} className="flex items-center justify-between p-2 rounded bg-slate-800">
                            <span className="text-white select-text">{target.machineId}</span>
                            <div className="flex items-center gap-2">
                              {target.progress !== undefined && (target.status === 'downloading' || target.status === 'extracting') && (
                                <span className="text-xs text-slate-400">{target.progress}%</span>
                              )}
                              {getStatusBadge(target.status)}
                              {(target.status === 'pending' || target.status === 'downloading' || target.status === 'extracting') && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={async () => {
                                    try {
                                      await cancelDistribution(distribution.id, target.machineId, distribution.project_name);
                                      // Status will update automatically via Firestore listener
                                    } catch (error: any) {
                                      console.error('Failed to cancel distribution:', error);
                                    }
                                  }}
                                  className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-950/30"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            ))
          )}
        </div>
      </main>

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
              className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700 hover:text-white cursor-pointer"
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
    </div>
  );
}
