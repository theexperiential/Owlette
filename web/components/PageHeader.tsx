'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ChevronRight, Settings, ChevronDown, LogOut, Shield } from 'lucide-react';
import Image from 'next/image';
import { getUserInitials } from '@/lib/userUtils';

interface Site {
  id: string;
  name: string;
}

interface PageHeaderProps {
  currentPage: 'Dashboard' | 'Deploy Software' | 'Distribute Projects';
  sites?: Site[];
  currentSiteId?: string;
  onSiteChange?: (siteId: string) => void;
  onManageSites?: () => void;
  actionButton?: React.ReactNode;
  onAccountSettings?: () => void;
}

export function PageHeader({
  currentPage,
  sites = [],
  currentSiteId,
  onSiteChange,
  onManageSites,
  actionButton,
  onAccountSettings,
}: PageHeaderProps) {
  const router = useRouter();
  const { user, signOut, isAdmin } = useAuth();

  return (
    <header className="border-b border-slate-800 bg-slate-900">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-3">
          {/* App Logo and Name */}
          <div className="flex items-center gap-3">
            <Image src="/owlette-icon.png" alt="Owlette" width={32} height={32} />
            <h1 className="text-xl font-bold text-white">Owlette</h1>
          </div>

          {/* Site Selector */}
          {sites.length > 0 && currentSiteId && onSiteChange && (
            <>
              <ChevronRight className="h-4 w-4 text-slate-600" />
              <div className="flex items-stretch border border-slate-700 bg-slate-800 rounded-md overflow-hidden">
                <Select value={currentSiteId} onValueChange={onSiteChange}>
                  <SelectTrigger className="w-[200px] border-0 bg-transparent text-white font-semibold cursor-pointer">
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

                {onManageSites && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onManageSites}
                    className="h-auto px-2 text-slate-400 hover:text-white hover:bg-slate-700 cursor-pointer border-l border-slate-700"
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </>
          )}

          {/* Breadcrumb separator */}
          <ChevronRight className="h-4 w-4 text-slate-600" />

          {/* Navigation Menu - Breadcrumb style */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-10 px-3 border-slate-700 bg-slate-800 text-sm text-white hover:text-white hover:bg-slate-800 cursor-pointer">
                <span>{currentPage}</span>
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-slate-700 bg-slate-800 w-80">
              <DropdownMenuItem
                onClick={() => router.push('/dashboard')}
                className="text-white focus:bg-slate-700 focus:text-white cursor-pointer py-4 px-4 flex flex-col items-start gap-1"
              >
                <span className="font-semibold text-base">Dashboard</span>
                <span className="text-sm text-slate-400 font-normal">
                  Monitor machines, view status, and manage processes across your sites
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => router.push('/deployments')}
                className="text-white focus:bg-slate-700 focus:text-white cursor-pointer py-4 px-4 flex flex-col items-start gap-1"
              >
                <span className="font-semibold text-base">Deploy Software</span>
                <span className="text-sm text-slate-400 font-normal">
                  Install software across multiple machines simultaneously
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => router.push('/projects')}
                className="text-white focus:bg-slate-700 focus:text-white cursor-pointer py-4 px-4 flex flex-col items-start gap-1"
              >
                <span className="font-semibold text-base">Distribute Projects</span>
                <span className="text-sm text-slate-400 font-normal">
                  Share TouchDesigner projects and files to managed machines
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-4">
          {/* Optional action button (e.g., Download, New Deployment) */}
          {actionButton}

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 h-auto py-2 px-3 hover:bg-slate-800 cursor-pointer">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-blue-600 text-white text-sm font-medium">
                    {user ? getUserInitials(user) : '?'}
                  </AvatarFallback>
                </Avatar>
                {user?.displayName && (
                  <span className="text-sm text-white hidden md:inline">{user.displayName}</span>
                )}
                <ChevronDown className="h-4 w-4 text-slate-400" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 border-slate-700 bg-slate-800">
              <div className="px-2 py-3 text-sm">
                {user?.displayName && (
                  <p className="font-medium text-white mb-1">{user.displayName}</p>
                )}
                <p className="text-xs text-slate-400 truncate">{user?.email}</p>
              </div>
              <DropdownMenuSeparator className="bg-slate-700" />
              {isAdmin && (
                <DropdownMenuItem
                  onClick={() => router.push('/admin/installers')}
                  className="text-white focus:bg-slate-700 focus:text-white cursor-pointer"
                >
                  <Shield className="mr-2 h-4 w-4" />
                  Admin Panel
                </DropdownMenuItem>
              )}
              {onAccountSettings && (
                <DropdownMenuItem
                  onClick={onAccountSettings}
                  className="text-white focus:bg-slate-700 focus:text-white cursor-pointer"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  Account Settings
                </DropdownMenuItem>
              )}
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
      </div>
    </header>
  );
}
