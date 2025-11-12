/**
 * MachineListView Component
 *
 * Table display of machines with expandable process rows.
 * Hidden on mobile, toggleable with card view on desktop.
 *
 * Features:
 * - Tabular layout with sortable columns
 * - Expandable rows for process details
 * - Process controls (autolaunch, edit, kill)
 * - Create new process button
 * - Memoized table header for performance
 *
 * Used by: Dashboard page for list view display
 */

'use client';

import React, { memo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { MachineContextMenu } from '@/components/MachineContextMenu';
import { ChevronDown, ChevronUp, Pencil, Square, Plus } from 'lucide-react';
import type { Machine, Process } from '@/hooks/useFirestore';

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
        <TableHead className="text-slate-200" style={{ willChange: 'auto' }}>Last Heartbeat</TableHead>
        <TableHead className="text-slate-200 w-8" style={{ willChange: 'auto' }}></TableHead>
      </TableRow>
    </TableHeader>
  );
});

MemoizedTableHeader.displayName = 'MemoizedTableHeader';

interface MachineListViewProps {
  machines: Machine[];
  expandedMachines: Set<string>;
  currentSiteId: string;
  onToggleExpanded: (machineId: string) => void;
  onEditProcess: (machineId: string, process: Process) => void;
  onCreateProcess: (machineId: string) => void;
  onKillProcess: (machineId: string, processId: string, processName: string) => void;
  onToggleAutolaunch: (machineId: string, processId: string, newValue: boolean, processName: string, exePath: string) => void;
  onRemoveMachine: (machineId: string, machineName: string, isOnline: boolean) => void;
}

export function MachineListView({
  machines,
  expandedMachines,
  currentSiteId,
  onToggleExpanded,
  onEditProcess,
  onCreateProcess,
  onKillProcess,
  onToggleAutolaunch,
  onRemoveMachine,
}: MachineListViewProps) {
  const handleRowClick = (machineId: string, canExpand: boolean) => {
    // Don't toggle if user is selecting text
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }

    if (canExpand) {
      onToggleExpanded(machineId);
    }
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
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
                      <div className="text-xs text-slate-400 truncate max-w-[200px]" title={machine.metrics.cpu.name || 'Unknown CPU'}>
                        {machine.metrics.cpu.name || 'Unknown CPU'}
                      </div>
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
                      <div className="text-xs text-slate-400 truncate max-w-[200px]" title={machine.metrics.gpu.name}>
                        {machine.metrics.gpu.name}
                      </div>
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
                <TableCell className="text-slate-400 text-xs">
                  {new Date(machine.lastHeartbeat * 1000).toLocaleString()}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <MachineContextMenu
                    machineId={machine.machineId}
                    machineName={machine.machineId}
                    siteId={currentSiteId}
                    isOnline={machine.online}
                    onRemoveMachine={() => onRemoveMachine(machine.machineId, machine.machineId, machine.online)}
                  />
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
                                  <Badge className={`text-xs flex-shrink-0 select-none ${!machine.online ? 'bg-slate-600 hover:bg-slate-700' : process.status === 'RUNNING' ? 'bg-green-600 hover:bg-green-700' : process.status === 'INACTIVE' ? 'bg-slate-600 hover:bg-slate-700' : 'bg-yellow-600 hover:bg-yellow-700'}`}>
                                    {!machine.online ? 'UNKNOWN' : process.status}
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
                                    onCheckedChange={(checked) => onToggleAutolaunch(machine.machineId, process.id, checked, process.name, process.exe_path)}
                                    className="cursor-pointer"
                                  />
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => onEditProcess(machine.machineId, process)}
                                  className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 hover:border-slate-600 hover:text-white cursor-pointer"
                                >
                                  <Pencil className="h-3 w-3 mr-1" />
                                  Edit
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => onKillProcess(machine.machineId, process.id, process.name)}
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
                              onClick={() => onCreateProcess(machine.machineId)}
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
                            onClick={() => onCreateProcess(machine.machineId)}
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
  );
}
