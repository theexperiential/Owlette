/**
 * MachineCardView Component
 *
 * Grid display of machines as cards showing metrics and processes.
 * Always shown on mobile, toggleable with list view on desktop.
 *
 * Features:
 * - Machine status (online/offline)
 * - System metrics (CPU, Memory, Disk, GPU) with sparkline charts
 * - Expandable process list
 * - Process controls (autolaunch, edit, kill)
 * - Create new process button
 * - Click sparklines to open detail panel
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
import { SparklineChart } from '@/components/charts';
import { ChevronDown, ChevronUp, Pencil, Square, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { formatTemperature, getTemperatureColorClass } from '@/lib/temperatureUtils';
import { getUsageColorClass, getUsageRingClass } from '@/lib/usageColorUtils';
import { useAllSparklineData } from '@/hooks/useSparklineData';
import type { Machine, Process } from '@/hooks/useFirestore';
import type { MetricType } from '@/components/charts';

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
  onMetricClick?: (machineId: string, metricType: MetricType) => void;
}

/**
 * Individual machine card with sparkline support
 * Separated to allow hooks inside the map
 */
interface MachineCardProps {
  machine: Machine;
  isExpanded: boolean;
  currentSiteId: string;
  userPreferences: { temperatureUnit: 'C' | 'F' };
  onToggleExpanded: () => void;
  onEditProcess: (process: Process) => void;
  onCreateProcess: () => void;
  onKillProcess: (processId: string, processName: string) => void;
  onToggleAutolaunch: (processId: string, newValue: boolean, processName: string, exePath: string) => void;
  onRemoveMachine: () => void;
  onMetricClick?: (metricType: MetricType) => void;
}

function MachineCard({
  machine,
  isExpanded,
  currentSiteId,
  userPreferences,
  onToggleExpanded,
  onEditProcess,
  onCreateProcess,
  onKillProcess,
  onToggleAutolaunch,
  onRemoveMachine,
  onMetricClick,
}: MachineCardProps) {
  // Fetch sparkline data for this machine
  const sparklineData = useAllSparklineData(currentSiteId, machine.machineId);

  return (
    <Card className="border-slate-800 bg-slate-900">
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
              onRemoveMachine={onRemoveMachine}
            />
          </div>
        </div>
        <CardDescription className="text-xs md:text-sm text-slate-400 select-none hidden md:block">
          Last heartbeat: {new Date(machine.lastHeartbeat * 1000).toLocaleString()}
        </CardDescription>
      </CardHeader>
      {machine.metrics && (
        <CardContent className="space-y-1.5 select-none pt-0 pb-4">
          {/* CPU Metric */}
          {machine.metrics.cpu && (
            <div
              className={`relative rounded-lg overflow-hidden cursor-pointer hover:ring-1 transition-all group ${getUsageRingClass(machine.metrics.cpu.percent)}`}
              onClick={onMetricClick ? () => onMetricClick('cpu') : undefined}
            >
              {/* Sparkline background */}
              <div className="absolute inset-0 opacity-80">
                <SparklineChart data={sparklineData.cpu} color="cpu" height={52} loading={sparklineData.loading} />
              </div>
              {/* Left accent bar - color based on usage */}
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${getUsageColorClass(machine.metrics.cpu.percent)}`} />
              {/* Content */}
              <div className="relative z-10 flex items-center justify-between px-3 py-2.5 pl-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm font-semibold text-white">CPU</span>
                  <span className="text-xs text-slate-400 truncate hidden sm:block" title={machine.metrics.cpu.name || 'Unknown'}>
                    {machine.metrics.cpu.name || 'Unknown'}
                  </span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-lg font-bold text-white tabular-nums">{machine.metrics.cpu.percent}%</span>
                  {machine.metrics.cpu.temperature !== undefined && (
                    <span className={`text-sm font-medium ${getTemperatureColorClass(machine.metrics.cpu.temperature)}`}>
                      {formatTemperature(machine.metrics.cpu.temperature, userPreferences.temperatureUnit)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Memory Metric */}
          <div
            className={`relative rounded-lg overflow-hidden cursor-pointer hover:ring-1 transition-all group ${getUsageRingClass(machine.metrics.memory?.percent ?? 0)}`}
            onClick={onMetricClick ? () => onMetricClick('memory') : undefined}
          >
            {/* Sparkline background */}
            <div className="absolute inset-0 opacity-80">
              <SparklineChart data={sparklineData.memory} color="memory" height={52} loading={sparklineData.loading} />
            </div>
            {/* Left accent bar - color based on usage */}
            <div className={`absolute left-0 top-0 bottom-0 w-1 ${getUsageColorClass(machine.metrics.memory?.percent ?? 0)}`} />
            {/* Content */}
            <div className="relative z-10 flex items-center justify-between px-3 py-2.5 pl-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white">Memory</span>
                {machine.metrics.memory?.used_gb !== undefined && machine.metrics.memory?.total_gb !== undefined && (
                  <span className="text-xs text-slate-400 hidden sm:block">
                    {machine.metrics.memory.used_gb.toFixed(1)} / {machine.metrics.memory.total_gb.toFixed(1)} GB
                  </span>
                )}
              </div>
              <span className="text-lg font-bold text-white tabular-nums">{machine.metrics.memory?.percent}%</span>
            </div>
          </div>

          {/* Disk Metric */}
          <div
            className={`relative rounded-lg overflow-hidden cursor-pointer hover:ring-1 transition-all group ${getUsageRingClass(machine.metrics.disk?.percent ?? 0)}`}
            onClick={onMetricClick ? () => onMetricClick('disk') : undefined}
          >
            {/* Sparkline background */}
            <div className="absolute inset-0 opacity-80">
              <SparklineChart data={sparklineData.disk} color="disk" height={52} loading={sparklineData.loading} />
            </div>
            {/* Left accent bar - color based on usage */}
            <div className={`absolute left-0 top-0 bottom-0 w-1 ${getUsageColorClass(machine.metrics.disk?.percent ?? 0)}`} />
            {/* Content */}
            <div className="relative z-10 flex items-center justify-between px-3 py-2.5 pl-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white">Disk</span>
                {machine.metrics.disk?.used_gb !== undefined && machine.metrics.disk?.total_gb !== undefined && (
                  <span className="text-xs text-slate-400 hidden sm:block">
                    {machine.metrics.disk.used_gb.toFixed(1)} / {machine.metrics.disk.total_gb.toFixed(1)} GB
                  </span>
                )}
              </div>
              <span className="text-lg font-bold text-white tabular-nums">{machine.metrics.disk?.percent}%</span>
            </div>
          </div>

          {/* GPU Metric */}
          {machine.metrics.gpu && (
            <div
              className={`relative rounded-lg overflow-hidden cursor-pointer hover:ring-1 transition-all group ${getUsageRingClass(machine.metrics.gpu.usage_percent ?? 0)}`}
              onClick={onMetricClick ? () => onMetricClick('gpu') : undefined}
            >
              {/* Sparkline background */}
              {sparklineData.gpu.length > 0 && (
                <div className="absolute inset-0 opacity-80">
                  <SparklineChart data={sparklineData.gpu} color="gpu" height={52} loading={sparklineData.loading} />
                </div>
              )}
              {/* Left accent bar - color based on usage */}
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${getUsageColorClass(machine.metrics.gpu.usage_percent ?? 0)}`} />
              {/* Content */}
              <div className="relative z-10 flex items-center justify-between px-3 py-2.5 pl-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm font-semibold text-white">GPU</span>
                  <span className="text-xs text-slate-400 truncate hidden sm:block" title={machine.metrics.gpu.name}>
                    {machine.metrics.gpu.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-lg font-bold text-white tabular-nums">{machine.metrics.gpu.usage_percent}%</span>
                  {machine.metrics.gpu.vram_used_gb !== undefined && machine.metrics.gpu.vram_total_gb && (
                    <span className="text-xs text-slate-400 hidden md:block">
                      {machine.metrics.gpu.vram_used_gb.toFixed(1)}/{machine.metrics.gpu.vram_total_gb.toFixed(1)}GB
                    </span>
                  )}
                  {machine.metrics.gpu.temperature !== undefined && (
                    <span className={`text-sm font-medium ${getTemperatureColorClass(machine.metrics.gpu.temperature)}`}>
                      {formatTemperature(machine.metrics.gpu.temperature, userPreferences.temperatureUnit)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      )}

      {/* Expandable Process List */}
      {machine.processes && machine.processes.length > 0 && (
        <Collapsible open={isExpanded} onOpenChange={onToggleExpanded}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full border-t border-slate-800 rounded-none hover:bg-slate-800/30 cursor-pointer">
              <div className="flex items-center justify-between w-full select-none">
                <span className="text-slate-400 text-sm">
                  {machine.processes.length} Process{machine.processes.length > 1 ? 'es' : ''}
                </span>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-300" /> : <ChevronDown className="h-4 w-4 text-slate-300" />}
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
                        onCheckedChange={(checked) => onToggleAutolaunch(process.id, checked, process.name, process.exe_path)}
                        className="cursor-pointer"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onEditProcess(process)}
                      className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 hover:border-slate-600 hover:text-white cursor-pointer p-2"
                      title="Edit"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onKillProcess(process.id, process.name)}
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
                  onClick={onCreateProcess}
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
            onClick={onCreateProcess}
            className="w-full bg-slate-800 border-slate-700 text-blue-400 hover:bg-blue-900 hover:border-blue-800 hover:text-blue-200 cursor-pointer"
          >
            <Plus className="h-3 w-3 mr-1" />
            New Process
          </Button>
        </div>
      )}
    </Card>
  );
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
  onMetricClick,
}: MachineCardViewProps) {
  const { userPreferences } = useAuth();

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {machines.map((machine) => (
        <MachineCard
          key={machine.machineId}
          machine={machine}
          isExpanded={expandedMachines.has(machine.machineId)}
          currentSiteId={currentSiteId}
          userPreferences={userPreferences}
          onToggleExpanded={() => onToggleExpanded(machine.machineId)}
          onEditProcess={(process) => onEditProcess(machine.machineId, process)}
          onCreateProcess={() => onCreateProcess(machine.machineId)}
          onKillProcess={(processId, processName) => onKillProcess(machine.machineId, processId, processName)}
          onToggleAutolaunch={(processId, newValue, processName, exePath) =>
            onToggleAutolaunch(machine.machineId, processId, newValue, processName, exePath)
          }
          onRemoveMachine={() => onRemoveMachine(machine.machineId, machine.machineId, machine.online)}
          onMetricClick={onMetricClick ? (metricType) => onMetricClick(machine.machineId, metricType) : undefined}
        />
      ))}
    </div>
  );
}
