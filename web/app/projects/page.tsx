'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useSites } from '@/hooks/useFirestore';
import { useProjectDistributionManager } from '@/hooks/useProjectDistributions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, CheckCircle2, XCircle, Clock, Loader2, Trash2, X } from 'lucide-react';
import ProjectDistributionDialog from '@/components/ProjectDistributionDialog';
import { ManageSitesDialog } from '@/components/ManageSitesDialog';
import { CreateSiteDialog } from '@/components/CreateSiteDialog';
import { PageHeader } from '@/components/PageHeader';
import { AccountSettingsDialog } from '@/components/AccountSettingsDialog';
import DownloadButton from '@/components/DownloadButton';
import { toast } from 'sonner';

export default function ProjectsPage() {
  const { user, loading: authLoading, signOut, userSites, isAdmin } = useAuth();
  const { sites, loading: sitesLoading, createSite, renameSite, deleteSite } = useSites(userSites, isAdmin);
  const [currentSiteId, setCurrentSiteId] = useState<string>('');
  const [distributionDialogOpen, setDistributionDialogOpen] = useState(false);
  const [selectedDistributionId, setSelectedDistributionId] = useState<string | null>(null);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
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
      <PageHeader
        currentPage="Distribute Projects"
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
        onSiteCreated={(siteId) => setCurrentSiteId(siteId)}
      />

      {/* Main content */}
      <main className="mx-auto max-w-7xl p-3 md:p-4">
        <div className="mt-3 md:mt-2 mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white mb-1">Project Distributions</h2>
            <p className="text-sm md:text-base text-slate-400">
              Distribute project files (ZIPs, .toe files, etc.) across your machines
            </p>
          </div>

          <div className="flex-shrink-0">
            <Button
              onClick={() => setDistributionDialogOpen(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Distribution
            </Button>
          </div>
        </div>

        {/* Distribution Dialog */}
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

        {/* Quick Stats */}
        <div className="mb-6 grid gap-2 md:gap-4 grid-cols-2 md:grid-cols-4 animate-in fade-in duration-300">
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
        <div className="space-y-4 animate-in fade-in duration-300">
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

      {/* Account Settings Dialog */}
      <AccountSettingsDialog
        open={accountSettingsOpen}
        onOpenChange={setAccountSettingsOpen}
      />
    </div>
  );
}
