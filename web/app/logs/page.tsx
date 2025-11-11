'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useSites } from '@/hooks/useFirestore';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/PageHeader';
import { collection, query, orderBy, limit, getDocs, where, startAfter, Query, DocumentData, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Filter, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface LogEvent {
  id: string;
  timestamp: Timestamp;
  action: string;
  level: string;
  machineId: string;
  machineName: string;
  processName?: string;
  details?: string;
  userId?: string;
}

const LOGS_PER_PAGE = 50;

// Action type labels for filtering
const ACTION_TYPES = [
  { value: 'all', label: 'All Actions' },
  { value: 'process_started', label: 'Process Started' },
  { value: 'process_killed', label: 'Process Killed' },
  { value: 'process_crash', label: 'Process Crashed' },
  { value: 'process_start_failed', label: 'Start Failed' },
  { value: 'command_executed', label: 'Command Executed' },
];

// Level badges styling
const getLevelBadge = (level: string) => {
  switch (level.toLowerCase()) {
    case 'error':
      return <Badge variant="destructive" className="text-xs">Error</Badge>;
    case 'warning':
      return <Badge variant="default" className="bg-yellow-600 text-xs">Warning</Badge>;
    case 'info':
      return <Badge variant="default" className="bg-blue-600 text-xs">Info</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{level}</Badge>;
  }
};

// Format action for display
const formatAction = (action: string) => {
  return action
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

export default function LogsPage() {
  const router = useRouter();
  const { user, loading, isAdmin, userSites } = useAuth();
  const { sites, loading: sitesLoading } = useSites(userSites, isAdmin);
  const [currentSiteId, setCurrentSiteId] = useState<string>('');
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [lastDoc, setLastDoc] = useState<DocumentData | null>(null);
  const [firstDoc, setFirstDoc] = useState<DocumentData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);

  // Filters
  const [filterAction, setFilterAction] = useState<string>('all');
  const [filterMachine, setFilterMachine] = useState<string>('all');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Redirect if not logged in
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // Set current site when sites load (restore from localStorage if available)
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

  // Fetch logs when site or filters change
  useEffect(() => {
    if (currentSiteId) {
      fetchLogs();
    }
  }, [currentSiteId, filterAction, filterMachine, filterLevel]);

  const fetchLogs = async (direction: 'next' | 'prev' | 'reset' = 'reset') => {
    if (!currentSiteId || !db) return;

    setLogsLoading(true);

    try {
      const logsRef = collection(db, 'sites', currentSiteId, 'logs');

      // Build query with filters
      let q: Query = query(logsRef, orderBy('timestamp', 'desc'));

      // Apply filters
      if (filterAction !== 'all') {
        q = query(q, where('action', '==', filterAction));
      }
      if (filterMachine !== 'all') {
        q = query(q, where('machineId', '==', filterMachine));
      }
      if (filterLevel !== 'all') {
        q = query(q, where('level', '==', filterLevel));
      }

      // Add pagination
      if (direction === 'next' && lastDoc) {
        q = query(q, startAfter(lastDoc), limit(LOGS_PER_PAGE + 1));
      } else if (direction === 'prev' && firstDoc) {
        // For previous page, we need to reverse the order
        q = query(logsRef, orderBy('timestamp', 'asc'));
        if (filterAction !== 'all') q = query(q, where('action', '==', filterAction));
        if (filterMachine !== 'all') q = query(q, where('machineId', '==', filterMachine));
        if (filterLevel !== 'all') q = query(q, where('level', '==', filterLevel));
        q = query(q, startAfter(firstDoc), limit(LOGS_PER_PAGE + 1));
      } else {
        q = query(q, limit(LOGS_PER_PAGE + 1));
      }

      const snapshot = await getDocs(q);
      const docsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as LogEvent));

      // Handle reverse order for previous page
      if (direction === 'prev') {
        docsData.reverse();
      }

      // Check if there are more pages
      const hasMoreData = docsData.length > LOGS_PER_PAGE;
      setHasMore(hasMoreData);

      // Remove the extra document used for pagination check
      const displayLogs = hasMoreData ? docsData.slice(0, LOGS_PER_PAGE) : docsData;

      setLogs(displayLogs);

      // Set pagination markers
      if (displayLogs.length > 0) {
        setFirstDoc(snapshot.docs[0]);
        setLastDoc(snapshot.docs[Math.min(LOGS_PER_PAGE - 1, snapshot.docs.length - 1)]);
      }

      // Update page navigation
      if (direction === 'next') {
        setCurrentPage(prev => prev + 1);
        setHasPrevious(true);
      } else if (direction === 'prev') {
        setCurrentPage(prev => Math.max(1, prev - 1));
        setHasPrevious(currentPage > 2);
      } else {
        setCurrentPage(1);
        setHasPrevious(false);
      }

    } catch (error) {
      console.error('Error fetching logs:', error);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleNextPage = () => {
    fetchLogs('next');
  };

  const handlePrevPage = () => {
    fetchLogs('prev');
  };

  const resetFilters = () => {
    setFilterAction('all');
    setFilterMachine('all');
    setFilterLevel('all');
  };

  // Get unique machines for filter
  const uniqueMachines = Array.from(new Set(logs.map(log => log.machineId)));

  if (loading || sitesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 pb-8">
      <PageHeader
        currentPage="Logs"
        sites={sites}
        currentSiteId={currentSiteId}
        onSiteChange={handleSiteChange}
      />

      {/* Main content */}
      <main className="mx-auto max-w-7xl p-3 md:p-4">
        <div className="mt-3 md:mt-2 mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white mb-1">Event Logs</h2>
            <p className="text-sm md:text-base text-slate-400">Monitor process events and system activities</p>
          </div>
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2 flex-shrink-0"
          >
            <Filter className="w-4 h-4" />
            {showFilters ? 'Hide Filters' : 'Show Filters'}
          </Button>
        </div>

        {/* Filters */}
        {showFilters && (
          <Card className="p-4 bg-slate-900 border-slate-800 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-slate-200 text-sm mb-2">Action Type</Label>
                <Select value={filterAction} onValueChange={setFilterAction}>
                  <SelectTrigger className="bg-slate-800 border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-slate-200 text-sm mb-2">Machine</Label>
                <Select value={filterMachine} onValueChange={setFilterMachine}>
                  <SelectTrigger className="bg-slate-800 border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Machines</SelectItem>
                    {uniqueMachines.map(machine => (
                      <SelectItem key={machine} value={machine}>
                        {machine}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-slate-200 text-sm mb-2">Level</Label>
                <Select value={filterLevel} onValueChange={setFilterLevel}>
                  <SelectTrigger className="bg-slate-800 border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Levels</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="error">Error</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-slate-200 text-sm mb-2">&nbsp;</Label>
                <Button
                  variant="outline"
                  onClick={resetFilters}
                  className="w-full gap-2"
                >
                  <X className="w-4 h-4" />
                  Reset Filters
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Logs List */}
        <Card className="bg-slate-900 border-slate-800">
          <div className="divide-y divide-slate-800">
            {logsLoading ? (
              <div className="p-8 text-center text-slate-400">
                Loading logs...
              </div>
            ) : logs.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                No logs found for this site
              </div>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className="p-4 hover:bg-slate-800/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {getLevelBadge(log.level)}
                        <span className="text-slate-100 font-medium">
                          {formatAction(log.action)}
                        </span>
                      </div>
                      <div className="text-sm text-slate-400 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Machine:</span>
                          <span className="text-slate-300">{log.machineName}</span>
                        </div>
                        {log.processName && (
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500">Process:</span>
                            <span className="text-slate-300">{log.processName}</span>
                          </div>
                        )}
                        {log.details && (
                          <div className="flex items-start gap-2">
                            <span className="text-slate-500">Details:</span>
                            <span className="text-slate-300 whitespace-pre-wrap">{log.details}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right text-sm text-slate-400 whitespace-nowrap">
                      {log.timestamp?.toDate().toLocaleString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Pagination */}
        {!logsLoading && logs.length > 0 && (
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-400">
              Page {currentPage}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handlePrevPage}
                disabled={!hasPrevious}
                className="gap-2"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                onClick={handleNextPage}
                disabled={!hasMore}
                className="gap-2"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
