/**
 * MachineCardView Component
 *
 * Grid display of machines as cards showing metrics and processes.
 * Always shown on mobile, toggleable with list view on desktop.
 *
 * Features:
 * - Machine status (online/offline)
 * - System metrics (CPU, Memory, Disk, GPU)
 * - Expandable process list
 * - Process controls (autolaunch, edit, kill)
 * - Create new process button
 *
 * Used by: Dashboard page for card view display
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MachineContextMenu } from '@/components/MachineContextMenu';
import { ChevronDown, ChevronUp, Pencil, Square, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { formatTemperature, getTemperatureColorClass } from '@/lib/temperatureUtils';
import type { Machine, Process } from '@/hooks/useFirestore';

interface MachineCardViewProps {
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

export function MachineCardView({
  machines,
  expandedMachines,
  currentSiteId,
  onToggleExpanded,
  onEditProcess,
  onCreateProcess,
  onKillProcess,
  onToggleAutolaunch,
  onRemoveMachine,
}: MachineCardViewProps) {
  const { userPreferences } = useAuth();

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {machines.map((machine) => (
        <Card key={machine.machineId} className="border-slate-800 bg-slate-900">
          <CardHeader className="pb-3 md:pb-6">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base md:text-lg text-white select-text">{machine.machineId}</CardTitle>
              <div className="flex items-center gap-2">
                <Badge className={`select-none text-xs ${machine.online ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                  {machine.online ? 'Online' : 'Offline'}
                </Badge>
                <MachineContextMenu
                  machineId={machine.machineId}
                  machineName={machine.machineId}
                  siteId={currentSiteId}
                  isOnline={machine.online}
                  onRemoveMachine={() => onRemoveMachine(machine.machineId, machine.machineId, machine.online)}
                />
              </div>
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
                  <span className="text-white flex-shrink-0 ml-auto">
                    {machine.metrics.cpu.percent}%
                    {machine.metrics.cpu.temperature !== undefined && (
                      <span className={`ml-2 ${getTemperatureColorClass(machine.metrics.cpu.temperature)}`}>
                        {formatTemperature(machine.metrics.cpu.temperature, userPreferences.temperatureUnit)}
                      </span>
                    )}
                  </span>
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
                    {machine.metrics.gpu.temperature !== undefined && (
                      <span className={`ml-2 ${getTemperatureColorClass(machine.metrics.gpu.temperature)}`}>
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
            <Collapsible open={expandedMachines.has(machine.machineId)} onOpenChange={() => onToggleExpanded(machine.machineId)}>
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
                        <Badge className={`text-xs flex-shrink-0 select-none ${!machine.online ? 'bg-slate-600 hover:bg-slate-700' : process.status === 'RUNNING' ? 'bg-green-600 hover:bg-green-700' : process.status === 'INACTIVE' ? 'bg-slate-600 hover:bg-slate-700' : 'bg-yellow-600 hover:bg-yellow-700'}`}>
                          {!machine.online ? 'UNKNOWN' : process.status}
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
                            onCheckedChange={(checked) => onToggleAutolaunch(machine.machineId, process.id, checked, process.name, process.exe_path)}
                            className="cursor-pointer"
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onEditProcess(machine.machineId, process)}
                          className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 hover:border-slate-600 hover:text-white cursor-pointer p-2"
                          title="Edit"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onKillProcess(machine.machineId, process.id, process.name)}
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
                      onClick={() => onCreateProcess(machine.machineId)}
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
                onClick={() => onCreateProcess(machine.machineId)}
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
  );
}
