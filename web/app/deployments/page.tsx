'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useSites } from '@/hooks/useFirestore';
import { useDeploymentManager } from '@/hooks/useDeployments';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ChevronRight, Plus, Download, CheckCircle2, XCircle, Clock, Loader2, Settings, ChevronDown, Trash2, X } from 'lucide-react';
import Image from 'next/image';
import DeploymentDialog from '@/components/DeploymentDialog';
import { ManageSitesDialog } from '@/components/ManageSitesDialog';
import { CreateSiteDialog } from '@/components/CreateSiteDialog';
import { toast } from 'sonner';

export default function DeploymentsPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { sites, loading: sitesLoading, createSite, renameSite, deleteSite } = useSites();
  const [currentSiteId, setCurrentSiteId] = useState<string>('');
  const [deployDialogOpen, setDeployDialogOpen] = useState(false);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const router = useRouter();

  const {
    deployments,
    deploymentsLoading,
    templates,
    templatesLoading,
    createDeployment,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    cancelDeployment,
    deleteDeployment,
  } = useDeploymentManager(currentSiteId);

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
      case 'cancelled':
        return <XCircle className="h-5 w-5 text-orange-500" />;
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
      cancelled: 'bg-orange-600 hover:bg-orange-700',
      in_progress: 'bg-blue-600 hover:bg-blue-700',
      partial: 'bg-yellow-600 hover:bg-yellow-700',
      pending: 'bg-slate-600 hover:bg-slate-700',
      downloading: 'bg-cyan-600 hover:bg-cyan-700',
      installing: 'bg-purple-600 hover:bg-purple-700',
    };

    return (
      <Badge className={`select-none ${colors[status] || colors.pending}`}>
        {status.replace('_', ' ')}
      </Badge>
    );
  };

  const selectedDeployment = deployments.find(d => d.id === selectedDeploymentId);

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
                    <span className="text-lg">Deploy Software</span>
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
                  onRenameSite={renameSite}
                  onDeleteSite={async (siteId) => {
                    await deleteSite(siteId);
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
        <div className="mt-3 md:mt-2 mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white mb-1">Software Deployments</h2>
            <p className="text-sm md:text-base text-slate-400">
              Deploy software installers across your machines
            </p>
          </div>

          <div className="flex-shrink-0">
            <DeploymentDialog
              open={deployDialogOpen}
              onOpenChange={setDeployDialogOpen}
              siteId={currentSiteId}
              templates={templates}
              onCreateDeployment={createDeployment}
              onCreateTemplate={createTemplate}
              onUpdateTemplate={updateTemplate}
              onDeleteTemplate={deleteTemplate}
            />
          </div>
        </div>

        {/* Quick Stats */}
        <div className="mb-6 grid gap-2 md:gap-4 grid-cols-2 md:grid-cols-4">
          <Card className="border-slate-800 bg-slate-900">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-200">Total Deployments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{deployments.length}</div>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-200">In Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {deployments.filter(d => d.status === 'in_progress').length}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-200">Completed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {deployments.filter(d => d.status === 'completed').length}
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

        {/* Deployments List */}
        <div className="space-y-4">
          {deploymentsLoading ? (
            <Card className="border-slate-800 bg-slate-900">
              <CardContent className="p-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-slate-400" />
                <p className="mt-2 text-slate-400">Loading deployments...</p>
              </CardContent>
            </Card>
          ) : deployments.length === 0 ? (
            <Card className="border-slate-800 bg-slate-900">
              <CardHeader>
                <CardTitle className="text-white">No Deployments Yet</CardTitle>
                <CardDescription className="text-slate-400">
                  Create your first deployment to install software across your machines
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => setDeployDialogOpen(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  New Deployment
                </Button>
              </CardContent>
            </Card>
          ) : (
            deployments.map((deployment) => (
              <Card
                key={deployment.id}
                className="border-slate-800 bg-slate-900 cursor-pointer hover:border-slate-700 transition-colors"
                onClick={() => setSelectedDeploymentId(deployment.id === selectedDeploymentId ? null : deployment.id)}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(deployment.status)}
                      <div className="space-y-2">
                        <CardTitle className="text-white select-text">{deployment.name}</CardTitle>
                        <CardDescription className="text-slate-400 select-text">
                          {deployment.installer_name}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(deployment.status)}
                      <span className="text-xs text-slate-500">
                        {new Date(deployment.createdAt).toLocaleString()}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await deleteDeployment(deployment.id);
                          } catch (error: any) {
                            console.error('Failed to delete deployment:', error);
                          }
                        }}
                        className="h-7 px-2 text-slate-400 hover:text-red-400 hover:bg-red-950/30 cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {selectedDeploymentId === deployment.id && (
                  <CardContent className="space-y-4 border-t border-slate-800 pt-4">
                    <div className="grid gap-3 text-sm">
                      <div>
                        <div className="text-slate-400 mb-1">Installer URL:</div>
                        <div className="text-white select-text break-all">{deployment.installer_url}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 mb-1">Silent Flags:</div>
                        <div className="text-white select-text break-all">{deployment.silent_flags || 'None'}</div>
                      </div>
                      {deployment.verify_path && (
                        <div>
                          <div className="text-slate-400 mb-1">Verify Path:</div>
                          <div className="text-white select-text break-all">{deployment.verify_path}</div>
                        </div>
                      )}
                    </div>

                    <div>
                      <h4 className="text-sm font-medium text-white mb-2">Target Machines ({deployment.targets.length})</h4>
                      <div className="space-y-2">
                        {deployment.targets.map((target) => (
                          <div key={target.machineId} className="flex items-center justify-between p-2 rounded bg-slate-800">
                            <span className="text-white select-text">{target.machineId}</span>
                            <div className="flex items-center gap-2">
                              {target.progress !== undefined && (target.status === 'downloading' || target.status === 'installing') && (
                                <span className="text-xs text-slate-400">{target.progress}%</span>
                              )}
                              {getStatusBadge(target.status)}
                              {(target.status === 'pending' || target.status === 'downloading' || target.status === 'installing') && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={async () => {
                                    try {
                                      await cancelDeployment(deployment.id, target.machineId, deployment.installer_name);
                                      // Status will update automatically via Firestore listener
                                    } catch (error: any) {
                                      console.error('Failed to cancel deployment:', error);
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
    </div>
  );
}
