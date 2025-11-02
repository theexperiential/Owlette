'use client';

import React, { useEffect, useState, memo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useMachines, useSites } from '@/hooks/useFirestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { toast } from 'sonner';
import Image from 'next/image';
import { ChevronRight, Plus, LayoutGrid, List, ChevronDown, ChevronUp, Square, Settings, LogOut, Copy, Check, Pencil, Trash2 } from 'lucide-react';
import { getUserInitials } from '@/lib/userUtils';
import { AccountSettingsDialog } from '@/components/AccountSettingsDialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ManageSitesDialog } from '@/components/ManageSitesDialog';
import { CreateSiteDialog } from '@/components/CreateSiteDialog';

type ViewType = 'card' | 'list';

// Memoized table header to prevent flickering on data updates
const MemoizedTableHeader = memo(() => {
  return (
    <TableHeader className="sticky top-0 z-10 bg-slate-900">
      <TableRow className="border-slate-800 hover:bg-slate-800">
        <TableHead className="text-slate-200 w-8" style={{ willChange: 'auto' }}></TableHead>
        <TableHead className="text-slate-200" style={{ willChange: 'auto' }}>Hostname</TableHead>
        <TableHead className="text-slate-200" style={{ willChange: 'auto' }}>Status</TableHead>
        <TableHead className="text-slate-200" style={{ willChange: 'auto' }}>CPU</TableHead>
        <TableHead className="text-slate-200" style={{ willChange: 'auto' }}>Memory</TableHead>
        <TableHead className="text-slate-200" style={{ willChange: 'auto' }}>Disk</TableHead>
        <TableHead className="text-slate-200" style={{ willChange: 'auto' }}>GPU</TableHead>
        <TableHead className="text-slate-200" style={{ willChange: 'auto' }}>Processes</TableHead>
        <TableHead className="text-slate-200" style={{ willChange: 'auto' }}>Last Heartbeat</TableHead>
      </TableRow>
    </TableHeader>
  );
});

MemoizedTableHeader.displayName = 'MemoizedTableHeader';

export default function DashboardPage() {
  const { user, loading, signOut } = useAuth();
  const { sites, loading: sitesLoading, createSite, renameSite, deleteSite } = useSites();
  const [currentSiteId, setCurrentSiteId] = useState<string>('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [viewType, setViewType] = useState<ViewType>('card');
  const [expandedMachines, setExpandedMachines] = useState<Set<string>>(new Set());
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [copiedSiteId, setCopiedSiteId] = useState(false);

  // Process Dialog state (supports both create and edit modes)
  const [processDialogOpen, setProcessDialogOpen] = useState(false);
  const [processDialogMode, setProcessDialogMode] = useState<'create' | 'edit'>('edit');
  const [editingMachineId, setEditingMachineId] = useState<string>('');
  const [editingProcessId, setEditingProcessId] = useState<string>('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
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

  const copySiteIdToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(currentSiteId);
      setCopiedSiteId(true);
      toast.success('Site ID copied to clipboard!');
      setTimeout(() => setCopiedSiteId(false), 2000);
    } catch (error) {
      toast.error('Failed to copy Site ID');
    }
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
    try {
      await deleteProcess(editingMachineId, editingProcessId);
      toast.success(`Process "${editProcessForm.name}" deleted successfully!`);
      setProcessDialogOpen(false);
      setDeleteConfirmOpen(false);
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

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setManageDialogOpen(true)}
                  className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700 hover:text-white cursor-pointer"
                >
                  <Settings className="h-4 w-4" />
                </Button>

                <ManageSitesDialog
                  open={manageDialogOpen}
                  onOpenChange={setManageDialogOpen}
                  sites={sites}
                  currentSiteId={currentSiteId}
                  machineCount={machines.length}
                  onRenameSite={renameSite}
                  onDeleteSite={async (siteId) => {
                    await deleteSite(siteId);
                    // If we deleted the current site, switch to another one
                    if (siteId === currentSiteId) {
                      const remainingSites = sites.filter(s => s.id !== siteId);
                      if (remainingSites.length > 0) {
                        handleSiteChange(remainingSites[0].id);
                      }
                    }
                  }}
                  onCreateSite={() => setCreateDialogOpen(true)}
                />

                <CreateSiteDialog
                  open={createDialogOpen}
                  onOpenChange={setCreateDialogOpen}
                  onCreateSite={createSite}
                />
              </div>
            )}
          </div>

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 h-auto py-2 px-3 hover:bg-slate-800 cursor-pointer">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-blue-600 text-white text-sm font-medium">
                    {getUserInitials(user)}
                  </AvatarFallback>
                </Avatar>
                {user.displayName && (
                  <span className="text-sm text-white hidden md:inline">{user.displayName}</span>
                )}
                <ChevronDown className="h-4 w-4 text-slate-400" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 border-slate-700 bg-slate-800">
              <div className="px-2 py-3 text-sm">
                {user.displayName && (
                  <p className="font-medium text-white mb-1">{user.displayName}</p>
                )}
                <p className="text-xs text-slate-400 truncate">{user.email}</p>
              </div>
              <DropdownMenuSeparator className="bg-slate-700" />
              <DropdownMenuItem
                onClick={() => setAccountSettingsOpen(true)}
                className="text-white focus:bg-slate-700 focus:text-white cursor-pointer"
              >
                <Settings className="mr-2 h-4 w-4" />
                Account Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={signOut}
                className="text-white focus:bg-slate-700 focus:text-white cursor-pointer"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl p-3 md:p-4">
        <div className="mt-3 md:mt-2 mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white mb-1">
              Welcome back{user.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}!
            </h2>
            <p className="text-sm md:text-base text-slate-400">
              Manage your Windows processes from the cloud
            </p>
          </div>

          {/* Site ID Display with Copy */}
          {currentSiteId && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-slate-800 transition-colors cursor-pointer group flex-shrink-0" onClick={copySiteIdToClipboard}>
                    <div className="flex flex-col">
                      <span className="text-xs text-slate-400">Site ID</span>
                      <span className="font-mono text-sm text-blue-400 font-semibold">{currentSiteId}</span>
                    </div>
                    {copiedSiteId ? (
                      <Check className="h-4 w-4 text-green-400 flex-shrink-0" />
                    ) : (
                      <Copy className="h-4 w-4 text-slate-400 group-hover:text-blue-400 transition-colors flex-shrink-0" />
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="font-semibold mb-1">Use this Site ID when installing the agent</p>
                  <p className="text-xs text-slate-300">
                    Run the installer on your Windows machine and enter this Site ID when prompted,
                    or set it in <span className="font-mono">config/config.json</span>
                  </p>
                  <p className="text-xs text-slate-400 mt-2">
                    Download from: <span className="font-mono text-blue-400">owlette.app</span>
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
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
                  className={`cursor-pointer ${viewType === 'card' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:bg-slate-600 hover:text-white'}`}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewType === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => handleViewChange('list')}
                  className={`cursor-pointer ${viewType === 'list' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:bg-slate-600 hover:text-white'}`}
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
                      {machine.metrics.cpu && (
                        <div className="flex text-sm gap-2">
                          <span className="text-slate-400 flex-shrink-0">CPU:</span>
                          <span className="text-slate-300 truncate" title={machine.metrics.cpu.name || 'Unknown CPU'}>
                            {machine.metrics.cpu.name || 'Unknown CPU'}
                          </span>
                          <span className="text-white flex-shrink-0 ml-auto">{machine.metrics.cpu.percent}%</span>
                        </div>
                      )}
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
                        <div className="flex text-sm gap-2">
                          <span className="text-slate-400 flex-shrink-0">GPU:</span>
                          <span className="text-slate-300 truncate" title={machine.metrics.gpu.name}>
                            {machine.metrics.gpu.name}
                          </span>
                          <span className="text-white flex-shrink-0 ml-auto">
                            {machine.metrics.gpu.usage_percent}%
                            {machine.metrics.gpu.vram_used_gb !== undefined && machine.metrics.gpu.vram_total_gb && (
                              <span className="text-slate-500 ml-1">
                                ({machine.metrics.gpu.vram_used_gb.toFixed(1)} / {machine.metrics.gpu.vram_total_gb.toFixed(1)} GB)
                              </span>
                            )}
                          </span>
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
                              </div>
                              <div className="flex items-center gap-2 md:gap-3 ml-2 md:ml-4 flex-shrink-0">
                                <div className="flex items-center gap-2">
                                  <Label htmlFor={`autolaunch-${machine.machineId}-${process.id}`} className="text-xs text-slate-400 cursor-pointer select-none hidden md:inline">
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
                                  className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 hover:border-slate-600 hover:text-white cursor-pointer p-2"
                                  title="Edit"
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleKillProcess(machine.machineId, process.id, process.name)}
                                  className="bg-slate-800 border-slate-700 text-red-400 hover:bg-red-900 hover:border-red-800 hover:text-red-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 p-2"
                                  disabled={process.status !== 'RUNNING'}
                                  title="Kill"
                                >
                                  <Square className="h-3 w-3" />
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
            <div className={`rounded-lg border border-slate-800 bg-slate-900 overflow-hidden ${viewType === 'card' ? 'hidden' : 'hidden md:block'}`}>
                <Table style={{ contain: 'layout' }}>
                  <MemoizedTableHeader />
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
                            {machine.metrics?.cpu ? (
                              <>
                                <div className="text-xs text-slate-400">{machine.metrics.cpu.name || 'Unknown CPU'}</div>
                                <div className="text-sm">{machine.metrics.cpu.percent}%</div>
                              </>
                            ) : '-'}
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
                            {machine.metrics?.gpu && machine.metrics.gpu.name && machine.metrics.gpu.name !== 'N/A' ? (
                              <>
                                <div className="text-xs text-slate-400">{machine.metrics.gpu.name}</div>
                                <div className="text-sm">
                                  {machine.metrics.gpu.usage_percent}%
                                  {machine.metrics.gpu.vram_used_gb !== undefined && machine.metrics.gpu.vram_total_gb && (
                                    <span className="text-slate-500 text-xs ml-1">
                                      ({machine.metrics.gpu.vram_used_gb.toFixed(1)} / {machine.metrics.gpu.vram_total_gb.toFixed(1)} GB)
                                    </span>
                                  )}
                                </div>
                              </>
                            ) : (
                              <span className="text-slate-500">N/A</span>
                            )}
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
          <DialogFooter className="flex items-center">
            {processDialogMode === 'edit' && (
              <Button
                variant="ghost"
                onClick={() => setDeleteConfirmOpen(true)}
                className="text-red-400 hover:text-red-300 hover:bg-red-950/30 cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
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

      {/* Delete Process Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="border-slate-700 bg-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Delete Process</DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to permanently delete "{editProcessForm.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700 hover:text-white cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteProcess}
              className="bg-red-600 hover:bg-red-700 text-white cursor-pointer"
            >
              Delete Process
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Account Settings Dialog */}
      <AccountSettingsDialog
        open={accountSettingsOpen}
        onOpenChange={setAccountSettingsOpen}
      />
    </div>
  );
}
