/**
 * ProcessDialog Component
 *
 * Dual-purpose dialog for creating new processes or editing existing ones.
 * Displays a comprehensive form for all process configuration options.
 *
 * Used by: Dashboard page for process management
 */

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

export interface ProcessFormData {
  name: string;
  exe_path: string;
  file_path: string;
  cwd: string;
  priority: string;
  visibility: string;
  time_delay: string;
  time_to_init: string;
  relaunch_attempts: string;
  autolaunch: boolean;
}

interface ProcessDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  form: ProcessFormData;
  onFormChange: (form: ProcessFormData) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}

export function ProcessDialog({
  open,
  mode,
  form,
  onFormChange,
  onClose,
  onSave,
  onDelete,
}: ProcessDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="border-slate-700 bg-slate-800 text-white max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-white">
            {mode === 'create' ? 'New Process' : 'Edit Process'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {mode === 'create'
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
              value={form.name}
              onChange={(e) => onFormChange({ ...form, name: e.target.value })}
              className="border-slate-700 bg-slate-900 text-white"
            />
          </div>

          {/* Executable Path */}
          <div className="space-y-2">
            <Label htmlFor="edit-exe-path" className="text-white">Executable Path</Label>
            <Input
              id="edit-exe-path"
              value={form.exe_path}
              onChange={(e) => onFormChange({ ...form, exe_path: e.target.value })}
              className="border-slate-700 bg-slate-900 text-white"
              placeholder="C:/Program Files/..."
            />
          </div>

          {/* File Path / Cmd Args */}
          <div className="space-y-2">
            <Label htmlFor="edit-file-path" className="text-white">File Path / Command Arguments</Label>
            <Input
              id="edit-file-path"
              value={form.file_path}
              onChange={(e) => onFormChange({ ...form, file_path: e.target.value })}
              className="border-slate-700 bg-slate-900 text-white"
              placeholder="Optional"
            />
          </div>

          {/* Working Directory */}
          <div className="space-y-2">
            <Label htmlFor="edit-cwd" className="text-white">Working Directory</Label>
            <Input
              id="edit-cwd"
              value={form.cwd}
              onChange={(e) => onFormChange({ ...form, cwd: e.target.value })}
              className="border-slate-700 bg-slate-900 text-white"
              placeholder="Optional"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            {/* Priority */}
            <div className="space-y-2">
              <Label htmlFor="edit-priority" className="text-white">Task Priority</Label>
              <Select
                value={form.priority}
                onValueChange={(value) => onFormChange({ ...form, priority: value })}
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
                value={form.visibility}
                onValueChange={(value) => onFormChange({ ...form, visibility: value })}
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
                value={form.time_delay}
                onChange={(e) => onFormChange({ ...form, time_delay: e.target.value })}
                className="border-slate-700 bg-slate-900 text-white"
              />
            </div>

            {/* Time to Init */}
            <div className="space-y-2">
              <Label htmlFor="edit-time-init" className="text-white">Init Timeout (sec)</Label>
              <Input
                id="edit-time-init"
                type="number"
                value={form.time_to_init}
                onChange={(e) => onFormChange({ ...form, time_to_init: e.target.value })}
                className="border-slate-700 bg-slate-900 text-white"
              />
            </div>

            {/* Relaunch Attempts */}
            <div className="space-y-2">
              <Label htmlFor="edit-relaunch" className="text-white">Relaunch Attempts</Label>
              <Input
                id="edit-relaunch"
                type="number"
                value={form.relaunch_attempts}
                onChange={(e) => onFormChange({ ...form, relaunch_attempts: e.target.value })}
                className="border-slate-700 bg-slate-900 text-white"
              />
            </div>
          </div>

          {/* Autolaunch */}
          <div className="flex items-center space-x-2">
            <Switch
              id="edit-autolaunch"
              checked={form.autolaunch}
              onCheckedChange={(checked) => onFormChange({ ...form, autolaunch: checked })}
            />
            <Label htmlFor="edit-autolaunch" className="text-white cursor-pointer">
              Enable Autolaunch
            </Label>
          </div>
        </div>
        <DialogFooter className="flex items-center">
          {mode === 'edit' && (
            <Button
              variant="ghost"
              onClick={onDelete}
              className="text-red-400 hover:text-red-300 hover:bg-red-950/30 cursor-pointer"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button
              variant="outline"
              onClick={onClose}
              className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700 hover:text-white cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={onSave}
              className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
            >
              {mode === 'create' ? 'Create Process' : 'Save Changes'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
