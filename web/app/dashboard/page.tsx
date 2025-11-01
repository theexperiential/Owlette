'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useMachines, useSites } from '@/hooks/useFirestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import Image from 'next/image';
import { ChevronRight, Plus, LayoutGrid, List, ChevronDown, ChevronUp, Play, Square, Settings, Pencil, Trash2, Check, X, Menu } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';

type ViewType = 'card' | 'list';

export default function DashboardPage() {
  const { user, loading, signOut } = useAuth();
  const { sites, loading: sitesLoading, createSite, renameSite, deleteSite } = useSites();
  const [currentSiteId, setCurrentSiteId] = useState<string>('');
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteId, setNewSiteId] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingDialogOpen, setDeletingDialogOpen] = useState(false);
  const [siteToDelete, setSiteToDelete] = useState<string | null>(null);
  const [viewType, setViewType] = useState<ViewType>('card');
  const [expandedMachines, setExpandedMachines] = useState<Set<string>>(new Set());

  // Process Dialog state (supports both create and edit modes)
  const [processDialogOpen, setProcessDialogOpen] = useState(false);
  const [processDialogMode, setProcessDialogMode] = useState<'create' | 'edit'>('edit');
  const [editingMachineId, setEditingMachineId] = useState<string>('');
  const [editingProcessId, setEditingProcessId] = useState<string>('');
  const [editProcessForm, setEditProcessForm] = useState({
    name: '',
    exe_path: '',
    file_path: '',
    cwd: '',
    priority: 'Normal',
    visibility: 'Show',
    time_delay: '0',
    time_to_init: '10',
    relaunch_attempts: '3',
    autolaunch: false,
  });

  const { machines, loading: machinesLoading, killProcess, toggleAutolaunch, updateProcess, deleteProcess, createProcess } = useMachines(currentSiteId);
  const router = useRouter();

  const toggleMachineExpanded = (machineId: string) => {
    setExpandedMachines(prev => {
      const newSet = new Set(prev);
      if (newSet.has(machineId)) {
        newSet.delete(machineId);
      } else {
        newSet.add(machineId);
      }
      return newSet;
    });
  };

  const handleRowClick = (machineId: string, canExpand: boolean) => {
    // Don't toggle if user is selecting text
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }

    if (canExpand) {
      toggleMachineExpanded(machineId);
    }
  };

  const handleKillProcess = async (machineId: string, processId: string, processName: string) => {
    console.log('handleKillProcess called:', { machineId, processId, processName });
    try {
      await killProcess(machineId, processId, processName);
      console.log('killProcess completed successfully');
      toast.success(`Kill command sent for "${processName}"`);
    } catch (error: any) {
      console.error('handleKillProcess error:', error);
      toast.error(error.message || 'Failed to kill process');
    }
  };

  const handleToggleAutolaunch = async (machineId: string, processId: string, newValue: boolean, processName: string, exePath: string) => {
    console.log('handleToggleAutolaunch called:', { machineId, processId, processName, newValue, exePath });

    // Validate exe_path before enabling autolaunch
    if (newValue && (!exePath || exePath.trim() === '')) {
      toast.error(`Cannot enable autolaunch for "${processName}": Executable path is not set. Please edit the process and set a valid executable path.`);
      return;
    }

    try {
      await toggleAutolaunch(machineId, processId, processName, newValue);
      console.log('toggleAutolaunch completed successfully');
      toast.success(`Autolaunch ${newValue ? 'enabled' : 'disabled'} for "${processName}"`);
    } catch (error: any) {
      console.error('handleToggleAutolaunch error:', error);
      toast.error(error.message || 'Failed to toggle autolaunch');
    }
  };

  const openEditProcessDialog = (machineId: string, process: any) => {
    setProcessDialogMode('edit');
    setEditingMachineId(machineId);
    setEditingProcessId(process.id);
    setEditProcessForm({
      name: process.name || '',
      exe_path: process.exe_path || '',
      file_path: process.file_path || '',
      cwd: process.cwd || '',
      priority: process.priority || 'Normal',
      visibility: process.visibility || 'Show',
      time_delay: process.time_delay || '0',
      time_to_init: process.time_to_init || '10',
      relaunch_attempts: process.relaunch_attempts || '3',
      autolaunch: process.autolaunch || false,
    });
    setProcessDialogOpen(true);
  };

  const openCreateProcessDialog = (machineId: string) => {
    setProcessDialogMode('create');
    setEditingMachineId(machineId);
    setEditingProcessId(''); // No process ID for new process
    // Reset form to defaults
    setEditProcessForm({
      name: '',
      exe_path: '',
      file_path: '',
      cwd: '',
      priority: 'Normal',
      visibility: 'Show',
      time_delay: '0',
      time_to_init: '10',
      relaunch_attempts: '3',
      autolaunch: false,
    });
    setProcessDialogOpen(true);
  };

  const handleSaveProcess = async () => {
    // Validation
    if (!editProcessForm.name || !editProcessForm.name.trim()) {
      toast.error('Process name is required');
      return;
    }

    if (!editProcessForm.exe_path || !editProcessForm.exe_path.trim()) {
      toast.error('Executable path is required');
      return;
    }

    try {
      if (processDialogMode === 'create') {
        // Create new process
        await createProcess(editingMachineId, editProcessForm);
        toast.success(`Process "${editProcessForm.name}" created successfully!`);
      } else {
        // Update existing process
        await updateProcess(editingMachineId, editingProcessId, editProcessForm);
        toast.success(`Process "${editProcessForm.name}" updated successfully!`);
      }
      setProcessDialogOpen(false);
    } catch (error: any) {
      toast.error(error.message || `Failed to ${processDialogMode} process`);
    }
  };

  const handleDeleteProcess = async () => {
    if (!confirm(`Are you sure you want to permanently delete "${editProcessForm.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteProcess(editingMachineId, editingProcessId);
      toast.success(`Process "${editProcessForm.name}" deleted successfully!`);
      setProcessDialogOpen(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete process');
    }
  };

  // Load view preference from localStorage
  useEffect(() => {
    const savedView = localStorage.getItem('owlette_view_type') as ViewType;
    if (savedView) {
      setViewType(savedView);
    }
  }, []);

  // Save view preference to localStorage
  const handleViewChange = (view: ViewType) => {
    setViewType(view);
    localStorage.setItem('owlette_view_type', view);
  };

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

  // Initialize default_site if no sites exist
  useEffect(() => {
    if (!sitesLoading && sites.length === 0 && !currentSiteId) {
      // Create default_site document
      createSite('default_site', 'Default Site').then(() => {
        setCurrentSiteId('default_site');
      }).catch((err) => {
        console.error('Failed to create default site:', err);
      });
    }
  }, [sites, sitesLoading, currentSiteId, createSite]);

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

  const getMachineCountForSite = (siteId: string): number => {
    // This is a simple approximation - in a real app you might want to fetch this data
    // For now, we only know the machine count for the current site
    if (siteId === currentSiteId) {
      return machines.length;
    }
    return 0; // We don't have data for other sites
  };

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <p className="text-slate-400">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const onlineMachines = machines.filter(m => m.online).length;
  const totalProcesses = machines.reduce((acc, m) => {
    return acc + (m.metrics?.processes ? Object.keys(m.metrics.processes).length : 0);
  }, 0);

  const currentSite = sites.find(s => s.id === currentSiteId);

  return (
    <div className="min-h-screen bg-slate-950">
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
                    <span className="text-lg">Dashboard</span>
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

            {/* Site Selector - GitHub style */}
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
                                <p className="text-xs text-slate-400">
                                  {site.id === currentSiteId
                                    ? `${machines.length} machine${machines.length !== 1 ? 's' : ''}`
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
                      <Button variant="outline" onClick={() => setCreateDialogOpen(false)} className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700">
                        Cancel
                      </Button>
                      <Button onClick={handleCreateSite} className="bg-blue-600 hover:bg-blue-700 text-white">
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
      <main className="mx-auto max-w-7xl p-3 md:p-4">
        <div className="mb-4 md:mb-8">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">Welcome back!</h2>
          <p className="text-sm md:text-base text-slate-400">
            Manage your Windows processes from the cloud
          </p>
        </div>

        {/* Quick stats */}
        <div className="mb-6 grid grid-cols-3 gap-2 md:gap-4">
          <Card className="border-slate-800 bg-slate-900">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-slate-200">Machines</CardTitle>
            </CardHeader>
            <CardContent className="pb-2 md:pb-6">
              <div className="text-xl md:text-2xl font-bold text-white">{machines.length}</div>
              <p className="text-xs text-slate-400 hidden md:block">
                {machines.length === 0 ? 'No machines' : `${machines.length} registered`}
              </p>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-slate-200">Online</CardTitle>
            </CardHeader>
            <CardContent className="pb-2 md:pb-6">
              <div className="text-xl md:text-2xl font-bold text-white">{onlineMachines}</div>
              <p className="text-xs text-slate-400 hidden md:block">
                {onlineMachines === 0 ? 'None online' : `${onlineMachines} online`}
              </p>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-slate-200">Processes</CardTitle>
            </CardHeader>
            <CardContent className="pb-2 md:pb-6">
              <div className="text-xl md:text-2xl font-bold text-white">{totalProcesses}</div>
              <p className="text-xs text-slate-400 hidden md:block">
                Managed
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Machines list */}
        {machines.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg md:text-xl font-bold text-white">Machines</h3>

              {/* View Toggle - Hidden on mobile, always show card view */}
              <div className="hidden md:flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 p-1 select-none">
                <Button
                  variant={viewType === 'card' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => handleViewChange('card')}
                  className={`cursor-pointer text-white ${viewType === 'card' ? 'bg-slate-700' : 'hover:bg-slate-700'}`}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewType === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => handleViewChange('list')}
                  className={`cursor-pointer text-white ${viewType === 'list' ? 'bg-slate-700' : 'hover:bg-slate-700'}`}
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Card View - Always shown on mobile, toggle on desktop */}
            <div className={`grid gap-4 md:grid-cols-2 ${viewType === 'list' ? 'md:hidden' : ''}`}>
              {machines.map((machine) => (
                <Card key={machine.machineId} className="border-slate-800 bg-slate-900">
                  <CardHeader className="pb-3 md:pb-6">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base md:text-lg text-white select-text">{machine.machineId}</CardTitle>
                      <Badge className={`select-none text-xs ${machine.online ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                        {machine.online ? 'Online' : 'Offline'}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs md:text-sm text-slate-400 select-none hidden md:block">
                      Last heartbeat: {new Date(machine.lastHeartbeat * 1000).toLocaleString()}
                    </CardDescription>
                  </CardHeader>
                  {machine.metrics && (
                    <CardContent className="space-y-2 select-none">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400">CPU:</span>
                        <span className="text-white">{machine.metrics.cpu?.percent}%</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400">Memory:</span>
                        <span className="text-white">
                          {machine.metrics.memory?.percent}%
                          {machine.metrics.memory?.used_gb && machine.metrics.memory?.total_gb && (
                            <span className="text-slate-500 ml-1 hidden md:inline">
                              ({machine.metrics.memory.used_gb.toFixed(1)} / {machine.metrics.memory.total_gb.toFixed(1)} GB)
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400">Disk:</span>
                        <span className="text-white">
                          {machine.metrics.disk?.percent}%
                          {machine.metrics.disk?.used_gb && machine.metrics.disk?.total_gb && (
                            <span className="text-slate-500 ml-1 hidden md:inline">
                              ({machine.metrics.disk.used_gb.toFixed(1)} / {machine.metrics.disk.total_gb.toFixed(1)} GB)
                            </span>
                          )}
                        </span>
                      </div>
                      {machine.metrics.gpu && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-400">GPU:</span>
                            <span className="text-white">{machine.metrics.gpu.name}</span>
                          </div>
                          <div className="flex justify-between text-sm pl-4">
                            <span className="text-slate-500">Usage:</span>
                            <span className="text-white">
                              {machine.metrics.gpu.usage_percent}%
                              {machine.metrics.gpu.vram_used_gb !== undefined && machine.metrics.gpu.vram_total_gb && (
                                <span className="text-slate-500 ml-1">
                                  ({machine.metrics.gpu.vram_used_gb.toFixed(1)} / {machine.metrics.gpu.vram_total_gb.toFixed(1)} GB)
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  )}

                  {/* Expandable Process List */}
                  {machine.processes && machine.processes.length > 0 && (
                    <Collapsible open={expandedMachines.has(machine.machineId)} onOpenChange={() => toggleMachineExpanded(machine.machineId)}>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" className="w-full border-t border-slate-800 rounded-none hover:bg-slate-800/30 cursor-pointer">
                          <div className="flex items-center justify-between w-full select-none">
                            <span className="text-slate-400 text-sm">
                              {machine.processes.length} Process{machine.processes.length > 1 ? 'es' : ''}
                            </span>
                            {expandedMachines.has(machine.machineId) ? <ChevronUp className="h-4 w-4 text-slate-300" /> : <ChevronDown className="h-4 w-4 text-slate-300" />}
                          </div>
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="space-y-2 p-2 md:p-4 border-t border-slate-800 bg-slate-900">
                          {machine.processes.map((process) => (
                            <div key={process.id} className="flex items-center justify-between p-2 md:p-3 rounded bg-slate-800 hover:bg-slate-700 transition-colors">
                              <div className="flex-1 min-w-0 flex items-center gap-2">
                                <span className="text-sm md:text-base text-white font-medium truncate select-text">{process.name}</span>
                                <Badge className={`text-xs flex-shrink-0 select-none ${process.status === 'RUNNING' ? 'bg-green-600 hover:bg-green-700' : process.status === 'INACTIVE' ? 'bg-slate-600 hover:bg-slate-700' : 'bg-yellow-600 hover:bg-yellow-700'}`}>
                                  {process.status}
                                </Badge>
                                {process.pid && <span className="text-xs text-slate-400 select-text hidden sm:inline">PID: {process.pid}</span>}
                                <span className="truncate hidden md:inline text-xs text-slate-400 select-text" title={process.exe_path}>{process.exe_path}</span>
                              </div>
                              <div className="flex items-center gap-2 md:gap-3 ml-2 md:ml-4 flex-shrink-0">
                                <div className="flex items-center gap-2 hidden md:flex">
                                  <Label htmlFor={`autolaunch-${machine.machineId}-${process.id}`} className="text-xs text-slate-400 cursor-pointer select-none">
                                    Autolaunch
                                  </Label>
                                  <Switch
                                    id={`autolaunch-${machine.machineId}-${process.id}`}
                                    checked={process._optimisticAutolaunch !== undefined ? process._optimisticAutolaunch : process.autolaunch}
                                    onCheckedChange={(checked) => handleToggleAutolaunch(machine.machineId, process.id, checked, process.name, process.exe_path)}
                                    className="cursor-pointer"
                                  />
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openEditProcessDialog(machine.machineId, process)}
                                  className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 hover:border-slate-600 hover:text-white cursor-pointer"
                                >
                                  <Pencil className="h-3 w-3 md:mr-1" />
                                  <span className="hidden md:inline">Edit</span>
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleKillProcess(machine.machineId, process.id, process.name)}
                                  className="bg-slate-800 border-slate-700 text-red-400 hover:bg-red-900 hover:border-red-800 hover:text-red-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={process.status !== 'RUNNING'}
                                >
                                  <Square className="h-3 w-3 md:mr-1" />
                                  <span className="hidden md:inline">Kill</span>
                                </Button>
                              </div>
                            </div>
                          ))}
                          {/* New Process Button */}
                          <div className="flex justify-center pt-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openCreateProcessDialog(machine.machineId)}
                              className="bg-slate-800 border-slate-700 text-blue-400 hover:bg-blue-900 hover:border-blue-800 hover:text-blue-200 cursor-pointer"
                            >
                              <Plus className="h-3 w-3 mr-1" />
                              New Process
                            </Button>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {/* New Process button for machines with no processes */}
                  {(!machine.processes || machine.processes.length === 0) && (
                    <div className="border-t border-slate-800 p-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openCreateProcessDialog(machine.machineId)}
                        className="w-full bg-slate-800 border-slate-700 text-blue-400 hover:bg-blue-900 hover:border-blue-800 hover:text-blue-200 cursor-pointer"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        New Process
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>

            {/* List View - Hidden on mobile, only shown on desktop when selected */}
            <div className={`rounded-lg border border-slate-800 bg-slate-900 ${viewType === 'card' ? 'hidden' : 'hidden md:block'}`}>
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-800 hover:bg-slate-800">
                      <TableHead className="text-slate-200 w-8"></TableHead>
                      <TableHead className="text-slate-200">Hostname</TableHead>
                      <TableHead className="text-slate-200">Status</TableHead>
                      <TableHead className="text-slate-200">CPU</TableHead>
                      <TableHead className="text-slate-200">Memory</TableHead>
                      <TableHead className="text-slate-200">Disk</TableHead>
                      <TableHead className="text-slate-200">GPU</TableHead>
                      <TableHead className="text-slate-200">Processes</TableHead>
                      <TableHead className="text-slate-200">Last Heartbeat</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {machines.map((machine) => (
                      <React.Fragment key={machine.machineId}>
                        <TableRow
                          className="border-slate-800 hover:bg-slate-800 cursor-pointer"
                          onClick={() => handleRowClick(machine.machineId, true)}
                        >
                          <TableCell>
                            <div className="flex items-center justify-center">
                              {expandedMachines.has(machine.machineId) ? (
                                <ChevronUp className="h-4 w-4 text-slate-300" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-slate-300" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-medium text-white select-text">{machine.machineId}</TableCell>
                          <TableCell>
                            <Badge className={`text-xs select-none ${machine.online ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                              {machine.online ? 'Online' : 'Offline'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-white">
                            {machine.metrics?.cpu?.percent ?? '-'}%
                          </TableCell>
                          <TableCell className="text-white">
                            {machine.metrics?.memory ? (
                              <>
                                {machine.metrics.memory.percent}%
                                <span className="text-slate-500 text-xs ml-1">
                                  ({machine.metrics.memory.used_gb.toFixed(1)} / {machine.metrics.memory.total_gb.toFixed(1)} GB)
                                </span>
                              </>
                            ) : '-'}
                          </TableCell>
                          <TableCell className="text-white">
                            {machine.metrics?.disk ? (
                              <>
                                {machine.metrics.disk.percent}%
                                <span className="text-slate-500 text-xs ml-1">
                                  ({machine.metrics.disk.used_gb.toFixed(1)} / {machine.metrics.disk.total_gb.toFixed(1)} GB)
                                </span>
                              </>
                            ) : '-'}
                          </TableCell>
                          <TableCell className="text-white">
                            {machine.metrics?.gpu ? (
                              <div className="space-y-1">
                                <div className="text-xs text-slate-400">{machine.metrics.gpu.name}</div>
                                <div>
                                  {machine.metrics.gpu.usage_percent}%
                                  {machine.metrics.gpu.vram_used_gb !== undefined && machine.metrics.gpu.vram_total_gb && (
                                    <span className="text-slate-500 text-xs ml-1">
                                      ({machine.metrics.gpu.vram_used_gb.toFixed(1)} / {machine.metrics.gpu.vram_total_gb.toFixed(1)} GB)
                                    </span>
                                  )}
                                </div>
                              </div>
                            ) : '-'}
                          </TableCell>
                          <TableCell className="text-white">
                            {machine.processes ? machine.processes.length : 0}
                          </TableCell>
                          <TableCell className="text-slate-400 text-xs">
                            {new Date(machine.lastHeartbeat * 1000).toLocaleString()}
                          </TableCell>
                        </TableRow>

                        {/* Expanded Process Details Row */}
                        {expandedMachines.has(machine.machineId) && (
                          <TableRow key={`${machine.machineId}-processes`} className="border-slate-800 bg-slate-900">
                            <TableCell colSpan={9} className="p-0 bg-slate-900">
                              <div className="p-4 space-y-2 bg-slate-900">
                                {machine.processes && machine.processes.length > 0 ? (
                                  <>
                                    {machine.processes.map((process) => (
                                  <div key={process.id} className="flex items-center justify-between p-3 rounded bg-slate-800 hover:bg-slate-700 transition-colors">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-white font-medium truncate select-text">{process.name}</span>
                                        <Badge className={`text-xs flex-shrink-0 select-none ${process.status === 'RUNNING' ? 'bg-green-600 hover:bg-green-700' : process.status === 'INACTIVE' ? 'bg-slate-600 hover:bg-slate-700' : 'bg-yellow-600 hover:bg-yellow-700'}`}>
                                          {process.status}
                                        </Badge>
                                      </div>
                                      <div className="flex items-center gap-3 text-xs text-slate-400 select-text">
                                        {process.pid && <span>PID: {process.pid}</span>}
                                        <span className="truncate" title={process.exe_path}>{process.exe_path}</span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                                      <div className="flex items-center gap-2">
                                        <Label htmlFor={`autolaunch-list-${machine.machineId}-${process.id}`} className="text-xs text-slate-400 cursor-pointer select-none">
                                          Autolaunch
                                        </Label>
                                        <Switch
                                          id={`autolaunch-list-${machine.machineId}-${process.id}`}
                                          checked={process._optimisticAutolaunch !== undefined ? process._optimisticAutolaunch : process.autolaunch}
                                          onCheckedChange={(checked) => handleToggleAutolaunch(machine.machineId, process.id, checked, process.name, process.exe_path)}
                                          className="cursor-pointer"
                                        />
                                      </div>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => openEditProcessDialog(machine.machineId, process)}
                                        className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 hover:border-slate-600 hover:text-white cursor-pointer"
                                      >
                                        <Pencil className="h-3 w-3 mr-1" />
                                        Edit
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleKillProcess(machine.machineId, process.id, process.name)}
                                        className="bg-slate-800 border-slate-700 text-red-400 hover:bg-red-900 hover:border-red-800 hover:text-red-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                                        disabled={process.status !== 'RUNNING'}
                                      >
                                        <Square className="h-3 w-3 mr-1" />
                                        Kill
                                      </Button>
                                    </div>
                                  </div>
                                    ))}
                                    {/* New Process Button */}
                                    <div className="flex justify-center pt-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => openCreateProcessDialog(machine.machineId)}
                                        className="bg-slate-800 border-slate-700 text-blue-400 hover:bg-blue-900 hover:border-blue-800 hover:text-blue-200 cursor-pointer"
                                      >
                                        <Plus className="h-3 w-3 mr-1" />
                                        New Process
                                      </Button>
                                    </div>
                                  </>
                                ) : (
                                  <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                                    <p className="mb-4 text-sm">No processes configured for this machine</p>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => openCreateProcessDialog(machine.machineId)}
                                      className="bg-slate-800 border-slate-700 text-blue-400 hover:bg-blue-900 hover:border-blue-800 hover:text-blue-200 cursor-pointer"
                                    >
                                      <Plus className="h-3 w-3 mr-1" />
                                      New Process
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
          </div>
        ) : (
          <Card className="border-slate-800 bg-slate-900">
            <CardHeader>
              <CardTitle className="text-white">Getting Started</CardTitle>
              <CardDescription className="text-slate-400">
                Connect your first machine to start managing processes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                <h3 className="font-semibold text-white">Step 1: Install Owlette Agent</h3>
                <p className="text-sm text-slate-400">
                  Download and install the Owlette agent on your Windows machine
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                <h3 className="font-semibold text-white">Step 2: Configure Site ID</h3>
                <p className="text-sm text-slate-400">
                  Set the agent's site_id to <span className="font-mono text-blue-400">{currentSiteId}</span> in the config file
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                <h3 className="font-semibold text-white">Step 3: Start the Service</h3>
                <p className="text-sm text-slate-400">
                  Run the agent and refresh this page - your machine will appear above
                </p>
              </div>
            </CardContent>
          </Card>
        )}
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
              className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteSite}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete Site
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Process Dialog (Create/Edit) */}
      <Dialog open={processDialogOpen} onOpenChange={setProcessDialogOpen}>
        <DialogContent className="border-slate-700 bg-slate-800 text-white max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-white">
              {processDialogMode === 'create' ? 'New Process' : 'Edit Process'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {processDialogMode === 'create'
                ? 'Create a new process configuration'
                : 'Update process configuration'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="edit-name" className="text-white">Name</Label>
              <Input
                id="edit-name"
                value={editProcessForm.name}
                onChange={(e) => setEditProcessForm({ ...editProcessForm, name: e.target.value })}
                className="border-slate-700 bg-slate-900 text-white"
              />
            </div>

            {/* Executable Path */}
            <div className="space-y-2">
              <Label htmlFor="edit-exe-path" className="text-white">Executable Path</Label>
              <Input
                id="edit-exe-path"
                value={editProcessForm.exe_path}
                onChange={(e) => setEditProcessForm({ ...editProcessForm, exe_path: e.target.value })}
                className="border-slate-700 bg-slate-900 text-white"
                placeholder="C:/Program Files/..."
              />
            </div>

            {/* File Path / Cmd Args */}
            <div className="space-y-2">
              <Label htmlFor="edit-file-path" className="text-white">File Path / Command Arguments</Label>
              <Input
                id="edit-file-path"
                value={editProcessForm.file_path}
                onChange={(e) => setEditProcessForm({ ...editProcessForm, file_path: e.target.value })}
                className="border-slate-700 bg-slate-900 text-white"
                placeholder="Optional"
              />
            </div>

            {/* Working Directory */}
            <div className="space-y-2">
              <Label htmlFor="edit-cwd" className="text-white">Working Directory</Label>
              <Input
                id="edit-cwd"
                value={editProcessForm.cwd}
                onChange={(e) => setEditProcessForm({ ...editProcessForm, cwd: e.target.value })}
                className="border-slate-700 bg-slate-900 text-white"
                placeholder="Optional"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              {/* Priority */}
              <div className="space-y-2">
                <Label htmlFor="edit-priority" className="text-white">Task Priority</Label>
                <Select
                  value={editProcessForm.priority}
                  onValueChange={(value) => setEditProcessForm({ ...editProcessForm, priority: value })}
                >
                  <SelectTrigger id="edit-priority" className="border-slate-700 bg-slate-900 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-slate-700 bg-slate-900 text-white">
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Normal">Normal</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Realtime">Realtime</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Visibility */}
              <div className="space-y-2">
                <Label htmlFor="edit-visibility" className="text-white">Window Visibility</Label>
                <Select
                  value={editProcessForm.visibility}
                  onValueChange={(value) => setEditProcessForm({ ...editProcessForm, visibility: value })}
                >
                  <SelectTrigger id="edit-visibility" className="border-slate-700 bg-slate-900 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-slate-700 bg-slate-900 text-white">
                    <SelectItem value="Show">Show</SelectItem>
                    <SelectItem value="Hide">Hide</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Empty space for alignment */}
              <div></div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {/* Time Delay */}
              <div className="space-y-2">
                <Label htmlFor="edit-time-delay" className="text-white">Launch Delay (sec)</Label>
                <Input
                  id="edit-time-delay"
                  type="number"
                  value={editProcessForm.time_delay}
                  onChange={(e) => setEditProcessForm({ ...editProcessForm, time_delay: e.target.value })}
                  className="border-slate-700 bg-slate-900 text-white"
                />
              </div>

              {/* Time to Init */}
              <div className="space-y-2">
                <Label htmlFor="edit-time-init" className="text-white">Init Timeout (sec)</Label>
                <Input
                  id="edit-time-init"
                  type="number"
                  value={editProcessForm.time_to_init}
                  onChange={(e) => setEditProcessForm({ ...editProcessForm, time_to_init: e.target.value })}
                  className="border-slate-700 bg-slate-900 text-white"
                />
              </div>

              {/* Relaunch Attempts */}
              <div className="space-y-2">
                <Label htmlFor="edit-relaunch" className="text-white">Relaunch Attempts</Label>
                <Input
                  id="edit-relaunch"
                  type="number"
                  value={editProcessForm.relaunch_attempts}
                  onChange={(e) => setEditProcessForm({ ...editProcessForm, relaunch_attempts: e.target.value })}
                  className="border-slate-700 bg-slate-900 text-white"
                />
              </div>
            </div>

            {/* Autolaunch */}
            <div className="flex items-center space-x-2">
              <Switch
                id="edit-autolaunch"
                checked={editProcessForm.autolaunch}
                onCheckedChange={(checked) => setEditProcessForm({ ...editProcessForm, autolaunch: checked })}
              />
              <Label htmlFor="edit-autolaunch" className="text-white cursor-pointer">
                Enable Autolaunch
              </Label>
            </div>
          </div>
          <DialogFooter className="flex justify-between">
            {processDialogMode === 'edit' && (
              <Button
                variant="destructive"
                onClick={handleDeleteProcess}
                className="bg-red-600 hover:bg-red-700 text-white cursor-pointer"
              >
                Delete
              </Button>
            )}
            <div className={`flex gap-2 ${processDialogMode === 'create' ? 'ml-auto' : ''}`}>
              <Button
                variant="outline"
                onClick={() => setProcessDialogOpen(false)}
                className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700 hover:text-white cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveProcess}
                className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
              >
                {processDialogMode === 'create' ? 'Create Process' : 'Save Changes'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
