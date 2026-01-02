'use client';

import React, { useEffect, useState, memo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useMachines, useSites } from '@/hooks/useFirestore';
import { useDeployments } from '@/hooks/useDeployments';
import { useMachineOperations } from '@/hooks/useMachineOperations';
import { useInstallerVersion } from '@/hooks/useInstallerVersion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, LayoutGrid, List, ChevronDown, ChevronUp, Square, Copy, Pencil, Trash2, Download } from 'lucide-react';
import { AccountSettingsDialog } from '@/components/AccountSettingsDialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { ManageSitesDialog } from '@/components/ManageSitesDialog';
import { CreateSiteDialog } from '@/components/CreateSiteDialog';
import DownloadButton from '@/components/DownloadButton';
import { MachineContextMenu } from '@/components/MachineContextMenu';
import { RemoveMachineDialog } from '@/components/RemoveMachineDialog';
import { PageHeader } from '@/components/PageHeader';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatTemperature, getTemperatureColorClass } from '@/lib/temperatureUtils';
import { formatStorageRange } from '@/lib/storageUtils';

type ViewType = 'card' | 'list';

// Memoized table header to prevent flickering on data updates
const MemoizedTableHeader = memo(() => {
  return (
    <TableHeader className="sticky top-0 z-10 bg-card">
      <TableRow className="border-border hover:bg-muted">
        <TableHead className="text-foreground w-8" style={{ willChange: 'auto' }}></TableHead>
        <TableHead className="text-foreground w-32" style={{ willChange: 'auto' }}>Hostname</TableHead>
        <TableHead className="text-foreground w-20" style={{ willChange: 'auto' }}>Status</TableHead>
        <TableHead className="text-foreground w-36" style={{ willChange: 'auto' }}>CPU</TableHead>
        <TableHead className="text-foreground w-28" style={{ willChange: 'auto' }}>Memory</TableHead>
        <TableHead className="text-foreground w-28" style={{ willChange: 'auto' }}>Disk</TableHead>
        <TableHead className="text-foreground w-32" style={{ willChange: 'auto' }}>GPU</TableHead>
        <TableHead className="text-foreground w-36" style={{ willChange: 'auto' }}>Last Heartbeat</TableHead>
        <TableHead className="text-foreground w-8" style={{ willChange: 'auto' }}></TableHead>
      </TableRow>
    </TableHeader>
  );
});

MemoizedTableHeader.displayName = 'MemoizedTableHeader';

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading, signOut, isAdmin, userSites, requiresMfaSetup, userPreferences } = useAuth();
  const { sites, loading: sitesLoading, createSite, renameSite, deleteSite } = useSites(user?.uid, userSites, isAdmin);
  const { version, downloadUrl } = useInstallerVersion();
  const [currentSiteId, setCurrentSiteId] = useState<string>('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [viewType, setViewType] = useState<ViewType>('card');
  const [expandedMachines, setExpandedMachines] = useState<Set<string>>(new Set());
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);

  // Delay showing "Getting Started" to avoid flash if machines are still loading
  const [canShowGettingStarted, setCanShowGettingStarted] = useState(false);

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
    visibility: 'Normal',
    time_delay: '0',
    time_to_init: '10',
    relaunch_attempts: '3',
    autolaunch: false,
  });

  const { machines, loading: machinesLoading, killProcess, toggleAutolaunch, updateProcess, deleteProcess, createProcess } = useMachines(currentSiteId);
  const { checkMachineHasActiveDeployment } = useDeployments(currentSiteId);
  const { removeMachineFromSite, removing: isRemovingMachine } = useMachineOperations(currentSiteId);

  // Remove Machine Dialog state
  const [removeMachineDialogOpen, setRemoveMachineDialogOpen] = useState(false);
  const [machineToRemove, setMachineToRemove] = useState<{ id: string; name: string; isOnline: boolean } | null>(null);

  // Multilingual welcome messages with language info
  const welcomeMessages = [
    // English (heavy)
    { text: "Welcome back", language: "English", translation: "Welcome back" },
    { text: "Greetings", language: "English", translation: "Greetings" },
    { text: "Hey there", language: "English (casual)", translation: "Hey there" },
    { text: "Good to see you", language: "English", translation: "Good to see you" },
    { text: "Hello again", language: "English", translation: "Hello again" },
    { text: "Welcome", language: "English", translation: "Welcome" },
    { text: "Howdy", language: "English (Southern US)", translation: "Howdy" },
    { text: "What's up", language: "English (casual)", translation: "What's up" },
    { text: "G'day", language: "English (Australian)", translation: "G'day / Good day" },
    { text: "Cheers", language: "English (British)", translation: "Cheers / Hello" },

    // Spanish (heavy)
    { text: "Bienvenido", language: "Spanish", translation: "Welcome" },
    { text: "Hola de nuevo", language: "Spanish", translation: "Hello again" },
    { text: "Qué tal", language: "Spanish (casual)", translation: "What's up / How's it going" },
    { text: "Saludos", language: "Spanish", translation: "Greetings" },
    { text: "Buenas", language: "Spanish (casual)", translation: "Hey / Hi there" },
    { text: "Hola", language: "Spanish", translation: "Hello" },
    { text: "Bienvenido de vuelta", language: "Spanish", translation: "Welcome back" },
    { text: "Qué onda", language: "Spanish (Mexican)", translation: "What's up" },
    { text: "¿Cómo estás?", language: "Spanish", translation: "How are you?" },
    { text: "Encantado de verte", language: "Spanish", translation: "Pleased to see you" },

    // French
    { text: "Bienvenue", language: "French", translation: "Welcome" },
    { text: "Salut", language: "French (casual)", translation: "Hi" },
    { text: "Bon retour", language: "French", translation: "Good return / Welcome back" },

    // German
    { text: "Willkommen zurück", language: "German", translation: "Welcome back" },
    { text: "Hallo", language: "German", translation: "Hello" },
    { text: "Grüß dich", language: "German (casual)", translation: "Greetings to you" },

    // Italian
    { text: "Benvenuto", language: "Italian", translation: "Welcome" },
    { text: "Ciao", language: "Italian", translation: "Hi / Bye" },

    // Portuguese
    { text: "Bem-vindo de volta", language: "Portuguese", translation: "Welcome back" },
    { text: "Olá", language: "Portuguese", translation: "Hello" },

    // Dutch
    { text: "Welkom terug", language: "Dutch", translation: "Welcome back" },

    // Russian
    { text: "Добро пожаловать", language: "Russian", translation: "Welcome" },
    { text: "Привет", language: "Russian", translation: "Hi" },

    // Asian languages
    { text: "欢迎回来", language: "Chinese (Simplified)", translation: "Welcome back" },
    { text: "ようこそ", language: "Japanese", translation: "Welcome" },
    { text: "환영합니다", language: "Korean", translation: "Welcome" },
    { text: "स्वागत है", language: "Hindi", translation: "Welcome" },
    { text: "ยินดีต้อนรับกลับมา", language: "Thai", translation: "Welcome back" },
    { text: "Chào mừng trở lại", language: "Vietnamese", translation: "Welcome back" },

    // Middle Eastern
    { text: "مرحبا بعودتك", language: "Arabic", translation: "Welcome back" },
    { text: "ברוך השב", language: "Hebrew", translation: "Blessed is the return" },
    { text: "Hoş geldin", language: "Turkish", translation: "Welcome" },

    // Scandinavian
    { text: "Välkommen tillbaka", language: "Swedish", translation: "Welcome back" },
    { text: "Velkommen tilbage", language: "Danish", translation: "Welcome back" },
    { text: "Velkommen tilbake", language: "Norwegian", translation: "Welcome back" },
    { text: "Tervetuloa takaisin", language: "Finnish", translation: "Welcome back" },

    // Other European
    { text: "Witaj ponownie", language: "Polish", translation: "Welcome again" },
    { text: "Vítejte zpět", language: "Czech", translation: "Welcome back" },
    { text: "Καλώς ήρθες πάλι", language: "Greek", translation: "Welcome back" },
    { text: "Bine ai revenit", language: "Romanian", translation: "Good you returned" },

    // Southeast Asian
    { text: "Selamat datang kembali", language: "Indonesian", translation: "Safe arrival back" },
    { text: "Maligayang pagbabalik", language: "Filipino", translation: "Happy return" },

    // Celtic
    { text: "Fàilte air ais", language: "Scottish Gaelic", translation: "Welcome back" },
    { text: "Croeso yn ôl", language: "Welsh", translation: "Welcome back" },
    { text: "Fáilte ar ais", language: "Irish", translation: "Welcome back" },
  ];

  // Random cheesy tech jokes
  const techJokes = [
    "Your pixels are in good hands",
    "Keeping your GPUs well-fed and happy",
    "Because Ctrl+Alt+Delete is so 2000s",
    "Herding your processes since 2025",
    "Making sure your renders don't surrender",
    "Your CPU's personal trainer",
    "We put the 'auto' in autolaunch",
    "Babysitting processes so you don't have to",
    "Keeping the frames flowing",
    "Process management: Now streaming",
    "Your digital janitor service",
    "Making computers computier since 2025",
    "Because someone has to babysit your GPUs",
    "Turning crashes into... well, less crashes",
    "Your processes' favorite nanny",
    "We'll handle the restarts, you handle the art",
    "Keeping your render farm from going on strike",
    "Process wrangling at its finest",
    "Making sure your video doesn't get stagefright",
    "Your machines' remote control, literally",
    "Teaching old GPUs new tricks",
    "We don't judge your 47 Chrome tabs",
    "Remotely judging your cable management",
    "Making Windows behave since 2025",
    "Your processes called, they want a manager",
    "Turning blue screens into green lights",
    "The cloud's favorite floor manager",
    "Because 'Have you tried turning it off and on again?' gets old",
    "Your GPU's therapist",
    "Making sure your RAM doesn't feel lonely",
    "Process management with extra cheese",
    "We put the 'service' in Windows Service",
    "Keeping your video walls from having a meltdown",
    "Because manual restarts are for peasants",
    "Your installation's guardian angel",
    "Making TouchDesigner touch easier",
    "Render farm to table, fresh processes daily",
    "We speak fluent GPU",
    "Your digital signage's best friend",
    "Because someone needs to watch the watchers",
    "Turning 'It works on my machine' into reality",
    "Process therapy, cloud edition",
    "Making Resolume resolve to stay running",
    "Your kiosk's remote babysitter",
    "Because uptime is updog",
    "GPU whisperer extraordinaire",
    "Making your media servers less dramatic",
    "We've seen things... running things",
    "Your process's life coach",
    "Because closing Task Manager won't fix this",
    "Keeping your renders rendering since 2025",
    "The owl watches over your processes",
    "Making Windows services less mysterious",
    "Your exhibition's technical director",
    "Process management: It's not rocket science, it's harder"
  ];

  const [randomWelcome] = useState(() => welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)]);
  const [randomJoke] = useState(() => techJokes[Math.floor(Math.random() * techJokes.length)]);

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

    // Map legacy visibility values to new options (backward compatibility)
    let visibilityValue = process.visibility || 'Normal';
    if (visibilityValue === 'Show') {
      visibilityValue = 'Normal';
    } else if (visibilityValue === 'Hide') {
      visibilityValue = 'Hidden';
    }

    setEditProcessForm({
      name: process.name || '',
      exe_path: process.exe_path || '',
      file_path: process.file_path || '',
      cwd: process.cwd || '',
      priority: process.priority || 'Normal',
      visibility: visibilityValue,
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
      visibility: 'Normal',
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

  const openRemoveMachineDialog = (machineId: string, machineName: string, isOnline: boolean) => {
    setMachineToRemove({ id: machineId, name: machineName, isOnline });
    setRemoveMachineDialogOpen(true);
  };

  const handleConfirmRemoveMachine = async () => {
    if (!machineToRemove) return;

    try {
      await removeMachineFromSite(machineToRemove.id);
      toast.success(`Machine "${machineToRemove.name}" removed from site successfully!`);
      setRemoveMachineDialogOpen(false);
      setMachineToRemove(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to remove machine');
    }
  };

  // Load view preference from localStorage
  useEffect(() => {
    const savedView = localStorage.getItem('owlette_view_type') as ViewType;
    if (savedView) {
      setViewType(savedView);
    }
  }, []);

  // Delay showing "Getting Started" by 2 seconds to avoid flash if machines load quickly
  useEffect(() => {
    const timer = setTimeout(() => {
      setCanShowGettingStarted(true);
    }, 2000); // 2 second delay
    return () => clearTimeout(timer);
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

  // 2FA Guard: Redirect users who need to complete 2FA setup
  useEffect(() => {
    if (!loading && user && requiresMfaSetup) {
      router.push('/setup-2fa');
    }
  }, [loading, user, requiresMfaSetup, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
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
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <PageHeader
        currentPage="Dashboard"
        sites={sites}
        currentSiteId={currentSiteId}
        onSiteChange={handleSiteChange}
        onManageSites={() => setManageDialogOpen(true)}
        onAccountSettings={() => setAccountSettingsOpen(true)}
        actionButton={<DownloadButton />}
      />

      {/* Site Management Dialogs */}
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
        onSiteCreated={(siteId) => setCurrentSiteId(siteId)}
      />

      {/* Main content */}
      <main className="mx-auto max-w-screen-2xl p-3 md:p-4">
        <div className="mt-3 md:mt-2 mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground mb-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help">
                      {randomWelcome.text}{user.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}!
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-semibold">{randomWelcome.language}</p>
                    <p className="text-xs text-foreground">{randomWelcome.translation}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </h2>
            <p className="text-sm md:text-base text-muted-foreground">
              {randomJoke}
            </p>
          </div>
        </div>

        {/* Quick stats */}
        <div className="mb-6 grid grid-cols-3 gap-2 md:gap-4">
          <Card className="border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-foreground">Machines</CardTitle>
            </CardHeader>
            <CardContent className="pb-2 md:pb-6">
              <div className="text-xl md:text-2xl font-bold text-foreground">{machines.length}</div>
              <p className="text-xs text-muted-foreground hidden md:block">
                {machines.length === 0 ? 'No machines' : `${machines.length} registered`}
              </p>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-foreground">Online</CardTitle>
            </CardHeader>
            <CardContent className="pb-2 md:pb-6">
              <div className="text-xl md:text-2xl font-bold text-foreground">{onlineMachines}</div>
              <p className="text-xs text-muted-foreground hidden md:block">
                {onlineMachines === 0 ? 'None online' : `${onlineMachines} online`}
              </p>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-foreground">Processes</CardTitle>
            </CardHeader>
            <CardContent className="pb-2 md:pb-6">
              <div className="text-xl md:text-2xl font-bold text-foreground">{totalProcesses}</div>
              <p className="text-xs text-muted-foreground hidden md:block">
                Managed
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Machines list */}
        {machines.length > 0 ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg md:text-xl font-bold text-foreground">Machines</h3>

              {/* View Toggle - Hidden on mobile, always show card view */}
              <div className="hidden md:flex items-center gap-1 rounded-lg border border-border bg-muted p-1 select-none">
                <Button
                  variant={viewType === 'card' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => handleViewChange('card')}
                  className={`cursor-pointer ${viewType === 'card' ? 'bg-input text-foreground' : 'text-muted-foreground hover:bg-input hover:text-foreground'}`}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewType === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => handleViewChange('list')}
                  className={`cursor-pointer ${viewType === 'list' ? 'bg-input text-foreground' : 'text-muted-foreground hover:bg-input hover:text-foreground'}`}
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Card View - Always shown on mobile, toggle on desktop */}
            <div className={`grid gap-4 md:grid-cols-2 animate-in fade-in duration-300 ${viewType === 'list' ? 'md:hidden' : ''}`}>
              {machines.map((machine) => (
                <Card key={machine.machineId} className="border-border bg-card">
                  <CardHeader className="pb-3 md:pb-6">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base md:text-lg text-foreground select-text">{machine.machineId}</CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge className={`select-none text-xs ${machine.online ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                          {machine.online ? 'Online' : 'Offline'}
                        </Badge>
                        <MachineContextMenu
                          machineId={machine.machineId}
                          machineName={machine.machineId}
                          siteId={currentSiteId}
                          isOnline={machine.online}
                          onRemoveMachine={() => openRemoveMachineDialog(machine.machineId, machine.machineId, machine.online)}
                        />
                      </div>
                    </div>
                    <CardDescription className="text-xs md:text-sm text-muted-foreground select-none hidden md:block">
                      Last heartbeat: {new Date(machine.lastHeartbeat * 1000).toLocaleString()}
                    </CardDescription>
                  </CardHeader>
                  {machine.metrics && (
                    <CardContent className="space-y-2 select-none">
                      {machine.metrics.cpu && (
                        <div className="flex text-sm gap-2">
                          <span className="text-muted-foreground flex-shrink-0">CPU:</span>
                          <span className="text-foreground truncate" title={machine.metrics.cpu.name || 'Unknown CPU'}>
                            {machine.metrics.cpu.name || 'Unknown CPU'}
                          </span>
                          <span className="text-foreground flex-shrink-0 ml-auto">
                            {machine.metrics.cpu.percent}%
                            {machine.metrics.cpu.temperature !== undefined && (
                              <span className={`ml-2 text-xs ${getTemperatureColorClass(machine.metrics.cpu.temperature)}`}>
                                {formatTemperature(machine.metrics.cpu.temperature, userPreferences.temperatureUnit)}
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Memory:</span>
                        <span className="text-foreground">
                          {machine.metrics.memory?.percent}%
                          {machine.metrics.memory?.used_gb && machine.metrics.memory?.total_gb && (
                            <span className="text-muted-foreground ml-1 hidden md:inline">
                              ({formatStorageRange(machine.metrics.memory.used_gb, machine.metrics.memory.total_gb)})
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Disk:</span>
                        <span className="text-foreground">
                          {machine.metrics.disk?.percent}%
                          {machine.metrics.disk?.used_gb && machine.metrics.disk?.total_gb && (
                            <span className="text-muted-foreground ml-1 hidden md:inline">
                              ({formatStorageRange(machine.metrics.disk.used_gb, machine.metrics.disk.total_gb)})
                            </span>
                          )}
                        </span>
                      </div>
                      {machine.metrics.gpu && (
                        <div className="flex text-sm gap-2">
                          <span className="text-muted-foreground flex-shrink-0">GPU:</span>
                          <span className="text-foreground truncate" title={machine.metrics.gpu.name}>
                            {machine.metrics.gpu.name}
                          </span>
                          <span className="text-foreground flex-shrink-0 ml-auto">
                            {machine.metrics.gpu.usage_percent}%
                            {machine.metrics.gpu.vram_used_gb !== undefined && machine.metrics.gpu.vram_total_gb && (
                              <span className="text-muted-foreground ml-1">
                                ({formatStorageRange(machine.metrics.gpu.vram_used_gb, machine.metrics.gpu.vram_total_gb)})
                              </span>
                            )}
                            {machine.metrics.gpu.temperature !== undefined && (
                              <span className={`ml-2 text-xs ${getTemperatureColorClass(machine.metrics.gpu.temperature)}`}>
                                {formatTemperature(machine.metrics.gpu.temperature, userPreferences.temperatureUnit)}
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
                        <Button variant="ghost" className="w-full border-t border-border rounded-none hover:bg-muted/30 cursor-pointer">
                          <div className="flex items-center justify-between w-full select-none">
                            <span className="text-muted-foreground text-sm">
                              {machine.processes.length} Process{machine.processes.length > 1 ? 'es' : ''}
                            </span>
                            {expandedMachines.has(machine.machineId) ? <ChevronUp className="h-4 w-4 text-foreground" /> : <ChevronDown className="h-4 w-4 text-foreground" />}
                          </div>
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="space-y-2 p-2 md:p-4 border-t border-border bg-card">
                          {machine.processes.map((process) => (
                            <div key={process.id} className="flex items-center justify-between p-2 md:p-3 rounded bg-muted hover:bg-input transition-colors">
                              <div className="flex-1 min-w-0 flex items-center gap-2">
                                <span className="text-sm md:text-base text-foreground font-medium truncate select-text">{process.name}</span>
                                <Badge className={`text-xs flex-shrink-0 select-none ${!machine.online ? 'bg-muted-foreground/50 hover:bg-muted-foreground/60' : process.status === 'RUNNING' ? 'bg-green-600 hover:bg-green-700' : process.status === 'INACTIVE' ? 'bg-muted-foreground/50 hover:bg-muted-foreground/60' : 'bg-yellow-600 hover:bg-yellow-700'}`}>
                                  {!machine.online ? 'UNKNOWN' : process.status}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2 md:gap-3 ml-2 md:ml-4 flex-shrink-0">
                                <div className="flex items-center gap-2">
                                  <Label htmlFor={`autolaunch-${machine.machineId}-${process.id}`} className="text-xs text-muted-foreground cursor-pointer select-none hidden md:inline">
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
                                  className="bg-muted border-border text-foreground hover:bg-input hover:border-border hover:text-foreground cursor-pointer p-2"
                                  title="Edit"
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleKillProcess(machine.machineId, process.id, process.name)}
                                  className="bg-muted border-border text-red-400 hover:bg-red-900 hover:border-red-800 hover:text-red-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 p-2"
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
                              className="bg-muted border-border text-accent-cyan hover:bg-accent-cyan-hover hover:border-accent-cyan hover:text-foreground cursor-pointer"
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
                    <div className="border-t border-border p-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openCreateProcessDialog(machine.machineId)}
                        className="w-full bg-muted border-border text-accent-cyan hover:bg-accent-cyan-hover hover:border-accent-cyan hover:text-foreground cursor-pointer"
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
            <div className={`rounded-lg border border-border bg-card overflow-hidden animate-in fade-in duration-300 ${viewType === 'card' ? 'hidden' : 'hidden md:block'}`}>
                <Table style={{ contain: 'layout', tableLayout: 'fixed' }}>
                  <MemoizedTableHeader />
                  <TableBody>
                    {machines.map((machine) => (
                      <React.Fragment key={machine.machineId}>
                        <TableRow
                          className="border-border hover:bg-muted cursor-pointer"
                          onClick={() => handleRowClick(machine.machineId, true)}
                        >
                          <TableCell>
                            <div className="flex items-center justify-center">
                              {expandedMachines.has(machine.machineId) ? (
                                <ChevronUp className="h-4 w-4 text-foreground" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-foreground" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-medium text-foreground select-text max-w-32">
                            <div className="truncate" title={machine.machineId}>{machine.machineId}</div>
                          </TableCell>
                          <TableCell className="max-w-20">
                            <Badge className={`text-xs select-none ${machine.online ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                              {machine.online ? 'Online' : 'Offline'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-foreground max-w-36">
                            {machine.metrics?.cpu ? (
                              <>
                                <div className="text-xs text-muted-foreground truncate" title={machine.metrics.cpu.name || 'Unknown CPU'}>{machine.metrics.cpu.name || 'Unknown CPU'}</div>
                                <div className="text-sm">
                                  {machine.metrics.cpu.percent}%
                                  {machine.metrics.cpu.temperature !== undefined && (
                                    <span className={`ml-2 text-xs ${getTemperatureColorClass(machine.metrics.cpu.temperature)}`}>
                                      {formatTemperature(machine.metrics.cpu.temperature, userPreferences.temperatureUnit)}
                                    </span>
                                  )}
                                </div>
                              </>
                            ) : '-'}
                          </TableCell>
                          <TableCell className="text-foreground max-w-28">
                            {machine.metrics?.memory ? (
                              <>
                                <div className="text-xs text-muted-foreground">
                                  {formatStorageRange(machine.metrics.memory.used_gb, machine.metrics.memory.total_gb)}
                                </div>
                                <div className="text-sm">
                                  {machine.metrics.memory.percent}%
                                </div>
                              </>
                            ) : '-'}
                          </TableCell>
                          <TableCell className="text-foreground max-w-28">
                            {machine.metrics?.disk ? (
                              <>
                                <div className="text-xs text-muted-foreground">
                                  {formatStorageRange(machine.metrics.disk.used_gb, machine.metrics.disk.total_gb)}
                                </div>
                                <div className="text-sm">
                                  {machine.metrics.disk.percent}%
                                </div>
                              </>
                            ) : '-'}
                          </TableCell>
                          <TableCell className="text-foreground max-w-32">
                            {machine.metrics?.gpu && machine.metrics.gpu.name && machine.metrics.gpu.name !== 'N/A' ? (
                              <>
                                <div className="text-xs text-muted-foreground truncate" title={machine.metrics.gpu.name}>{machine.metrics.gpu.name}</div>
                                <div className="text-sm" title={machine.metrics.gpu.vram_used_gb !== undefined && machine.metrics.gpu.vram_total_gb ? formatStorageRange(machine.metrics.gpu.vram_used_gb, machine.metrics.gpu.vram_total_gb) : undefined}>
                                  {machine.metrics.gpu.usage_percent}%
                                  {machine.metrics.gpu.temperature !== undefined && (
                                    <span className={`ml-2 text-xs ${getTemperatureColorClass(machine.metrics.gpu.temperature)}`}>
                                      {formatTemperature(machine.metrics.gpu.temperature, userPreferences.temperatureUnit)}
                                    </span>
                                  )}
                                </div>
                              </>
                            ) : (
                              <span className="text-muted-foreground">N/A</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs max-w-36">
                            <div className="truncate" title={new Date(machine.lastHeartbeat * 1000).toLocaleString()}>
                              {new Date(machine.lastHeartbeat * 1000).toLocaleString()}
                            </div>
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <MachineContextMenu
                              machineId={machine.machineId}
                              machineName={machine.machineId}
                              siteId={currentSiteId}
                              isOnline={machine.online}
                              onRemoveMachine={() => openRemoveMachineDialog(machine.machineId, machine.machineId, machine.online)}
                            />
                          </TableCell>
                        </TableRow>

                        {/* Expanded Process Details Row */}
                        {expandedMachines.has(machine.machineId) && (
                          <TableRow key={`${machine.machineId}-processes`} className="border-border bg-card">
                            <TableCell colSpan={9} className="p-0 bg-card">
                              <div className="p-4 space-y-2 bg-card">
                                {machine.processes && machine.processes.length > 0 ? (
                                  <>
                                    {machine.processes.map((process) => (
                                  <div key={process.id} className="flex items-center justify-between p-3 rounded bg-muted hover:bg-input transition-colors">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-foreground font-medium truncate select-text">{process.name}</span>
                                        <Badge className={`text-xs flex-shrink-0 select-none ${!machine.online ? 'bg-muted-foreground/50 hover:bg-muted-foreground/60' : process.status === 'RUNNING' ? 'bg-green-600 hover:bg-green-700' : process.status === 'INACTIVE' ? 'bg-muted-foreground/50 hover:bg-muted-foreground/60' : 'bg-yellow-600 hover:bg-yellow-700'}`}>
                                          {!machine.online ? 'UNKNOWN' : process.status}
                                        </Badge>
                                      </div>
                                      <div className="flex items-center gap-3 text-xs text-muted-foreground select-text">
                                        {process.pid && <span>PID: {process.pid}</span>}
                                        <span className="truncate" title={process.exe_path}>{process.exe_path}</span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                                      <div className="flex items-center gap-2">
                                        <Label htmlFor={`autolaunch-list-${machine.machineId}-${process.id}`} className="text-xs text-muted-foreground cursor-pointer select-none">
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
                                        className="bg-muted border-border text-foreground hover:bg-input hover:border-border hover:text-foreground cursor-pointer"
                                      >
                                        <Pencil className="h-3 w-3 mr-1" />
                                        Edit
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleKillProcess(machine.machineId, process.id, process.name)}
                                        className="bg-muted border-border text-red-400 hover:bg-red-900 hover:border-red-800 hover:text-red-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
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
                                        className="bg-muted border-border text-accent-cyan hover:bg-accent-cyan-hover hover:border-accent-cyan hover:text-foreground cursor-pointer"
                                      >
                                        <Plus className="h-3 w-3 mr-1" />
                                        New Process
                                      </Button>
                                    </div>
                                  </>
                                ) : (
                                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                                    <p className="mb-4 text-sm">No processes configured for this machine</p>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => openCreateProcessDialog(machine.machineId)}
                                      className="bg-muted border-border text-accent-cyan hover:bg-accent-cyan-hover hover:border-accent-cyan hover:text-foreground cursor-pointer"
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
        ) : canShowGettingStarted ? (
          <Card className="border-border bg-card animate-in fade-in duration-500">
            <CardHeader>
              <CardTitle className="text-foreground">Getting Started</CardTitle>
              <CardDescription className="text-muted-foreground">
                Connect your first machine to start managing processes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Step 1: Create Your First Site (only shown when no sites exist) */}
              {sites.length === 0 && (
                <div className="rounded-lg border-2 border-accent-cyan bg-accent-cyan/10 p-6">
                  <h3 className="text-lg font-bold text-foreground mb-2">Step 1: Create Your First Site</h3>
                  <p className="text-sm text-foreground mb-4">
                    Sites organize your machines by location or purpose (e.g., &quot;NYC Office&quot;, &quot;Home Studio&quot;, &quot;Production Floor&quot;).
                    Create your first site to get started!
                  </p>
                  <Button
                    onClick={() => setCreateDialogOpen(true)}
                    className="bg-accent-cyan hover:bg-accent-cyan-hover text-foreground font-semibold px-6 py-3 cursor-pointer"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create Your First Site
                  </Button>
                </div>
              )}

              {/* Steps 2-5: Only shown after site is created */}
              {sites.length > 0 && (
                <>
                  <div className="rounded-lg border border-border bg-background p-4">
                    <h3 className="font-semibold text-foreground mb-3">Step 1: Download Owlette Agent</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Download and run the installer <strong className="text-foreground">on the machine you want to add</strong> (not necessarily this one).
                  Use the copy link option if connecting via remote desktop tools like Parsec, TeamViewer, or RDP.
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      if (!downloadUrl) {
                        toast.error('Download Unavailable', {
                          description: 'Installer download URL is not available.',
                        });
                        return;
                      }
                      try {
                        window.open(downloadUrl, '_blank');
                        toast.success('Download Started', {
                          description: `Downloading Owlette v${version}`,
                        });
                      } catch (err) {
                        toast.error('Download Failed', {
                          description: 'Failed to start download. Please try again.',
                        });
                      }
                    }}
                    disabled={!downloadUrl}
                    className="flex-1 bg-accent-cyan hover:bg-accent-cyan-hover text-foreground cursor-pointer"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    <span>Download {version && `v${version}`}</span>
                  </Button>
                  <Button
                    onClick={() => {
                      if (!downloadUrl) {
                        toast.error('Copy Failed', {
                          description: 'Download URL is not available.',
                        });
                        return;
                      }
                      try {
                        navigator.clipboard.writeText(downloadUrl);
                        toast.success('Link Copied', {
                          description: 'Download link copied to clipboard',
                        });
                      } catch (err) {
                        toast.error('Copy Failed', {
                          description: 'Failed to copy link. Please try again.',
                        });
                      }
                    }}
                    disabled={!downloadUrl}
                    className="flex-1 bg-accent-cyan hover:bg-accent-cyan-hover text-foreground cursor-pointer"
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    <span>Copy Link</span>
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-background p-4">
                <h3 className="font-semibold text-foreground">Step 2: Run the Installer</h3>
                <p className="text-sm text-muted-foreground">
                  On that machine, double-click the installer - it will automatically open a browser for authentication
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background p-4">
                <h3 className="font-semibold text-foreground">Step 3: Authorize Agent</h3>
                <p className="text-sm text-muted-foreground">
                  Log in and authorize the agent for site <span className="font-mono text-accent-cyan">{currentSiteId}</span>
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background p-4">
                <h3 className="font-semibold text-foreground">Step 4: Done!</h3>
                <p className="text-sm text-muted-foreground">
                  The installer completes automatically and that machine will appear above within seconds
                </p>
              </div>
                </>
              )}
            </CardContent>
          </Card>
        ) : null}
      </main>

      {/* Process Dialog (Create/Edit) */}
      <Dialog open={processDialogOpen} onOpenChange={setProcessDialogOpen}>
        <DialogContent className="border-border bg-muted text-foreground max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {processDialogMode === 'create' ? 'New Process' : 'Edit Process'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {processDialogMode === 'create'
                ? 'Create a new process configuration'
                : 'Update process configuration'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="edit-name" className="text-foreground">Name</Label>
              <Input
                id="edit-name"
                value={editProcessForm.name}
                onChange={(e) => setEditProcessForm({ ...editProcessForm, name: e.target.value })}
                className="border-border bg-card text-foreground"
              />
            </div>

            {/* Executable Path */}
            <div className="space-y-2">
              <Label htmlFor="edit-exe-path" className="text-foreground">Executable Path</Label>
              <Input
                id="edit-exe-path"
                value={editProcessForm.exe_path}
                onChange={(e) => setEditProcessForm({ ...editProcessForm, exe_path: e.target.value })}
                className="border-border bg-card text-foreground"
                placeholder="C:/Program Files/..."
              />
            </div>

            {/* File Path / Cmd Args */}
            <div className="space-y-2">
              <Label htmlFor="edit-file-path" className="text-foreground">File Path / Command Arguments</Label>
              <Input
                id="edit-file-path"
                value={editProcessForm.file_path}
                onChange={(e) => setEditProcessForm({ ...editProcessForm, file_path: e.target.value })}
                className="border-border bg-card text-foreground"
                placeholder="Optional"
              />
            </div>

            {/* Working Directory */}
            <div className="space-y-2">
              <Label htmlFor="edit-cwd" className="text-foreground">Working Directory</Label>
              <Input
                id="edit-cwd"
                value={editProcessForm.cwd}
                onChange={(e) => setEditProcessForm({ ...editProcessForm, cwd: e.target.value })}
                className="border-border bg-card text-foreground"
                placeholder="Optional"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              {/* Priority */}
              <div className="space-y-2">
                <Label htmlFor="edit-priority" className="text-foreground">Task Priority</Label>
                <Select
                  value={editProcessForm.priority}
                  onValueChange={(value) => setEditProcessForm({ ...editProcessForm, priority: value })}
                >
                  <SelectTrigger id="edit-priority" className="border-border bg-card text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-card text-foreground">
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Normal">Normal</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Realtime">Realtime</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Visibility */}
              <div className="space-y-2">
                <Label htmlFor="edit-visibility" className="text-foreground">Window Visibility</Label>
                <Select
                  value={editProcessForm.visibility}
                  onValueChange={(value) => setEditProcessForm({ ...editProcessForm, visibility: value })}
                >
                  <SelectTrigger id="edit-visibility" className="border-border bg-card text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-card text-foreground">
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
                <Label htmlFor="edit-time-delay" className="text-foreground">Launch Delay (sec)</Label>
                <Input
                  id="edit-time-delay"
                  type="number"
                  value={editProcessForm.time_delay}
                  onChange={(e) => setEditProcessForm({ ...editProcessForm, time_delay: e.target.value })}
                  className="border-border bg-card text-foreground"
                />
              </div>

              {/* Time to Init */}
              <div className="space-y-2">
                <Label htmlFor="edit-time-init" className="text-foreground">Init Timeout (sec)</Label>
                <Input
                  id="edit-time-init"
                  type="number"
                  value={editProcessForm.time_to_init}
                  onChange={(e) => setEditProcessForm({ ...editProcessForm, time_to_init: e.target.value })}
                  className="border-border bg-card text-foreground"
                />
              </div>

              {/* Relaunch Attempts */}
              <div className="space-y-2">
                <Label htmlFor="edit-relaunch" className="text-foreground">Relaunch Attempts</Label>
                <Input
                  id="edit-relaunch"
                  type="number"
                  value={editProcessForm.relaunch_attempts}
                  onChange={(e) => setEditProcessForm({ ...editProcessForm, relaunch_attempts: e.target.value })}
                  className="border-border bg-card text-foreground"
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
              <Label htmlFor="edit-autolaunch" className="text-foreground cursor-pointer">
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
                className="border-border bg-muted text-foreground hover:bg-input hover:text-foreground cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveProcess}
                className="bg-accent-cyan hover:bg-accent-cyan-hover text-foreground cursor-pointer"
              >
                {processDialogMode === 'create' ? 'Create Process' : 'Save Changes'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Process Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="border-border bg-muted text-foreground">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete Process</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to permanently delete "{editProcessForm.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-border bg-muted text-foreground hover:bg-input hover:text-foreground cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteProcess}
              className="bg-red-600 hover:bg-red-700 text-foreground cursor-pointer"
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

      {/* Remove Machine Dialog */}
      {machineToRemove && (
        <RemoveMachineDialog
          open={removeMachineDialogOpen}
          onOpenChange={setRemoveMachineDialogOpen}
          machineId={machineToRemove.id}
          machineName={machineToRemove.name}
          isOnline={machineToRemove.isOnline}
          hasActiveDeployments={checkMachineHasActiveDeployment(machineToRemove.id)}
          isRemoving={isRemovingMachine}
          onConfirmRemove={handleConfirmRemoveMachine}
        />
      )}
    </div>
  );
}
