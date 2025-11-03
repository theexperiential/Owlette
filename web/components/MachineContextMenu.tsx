'use client';

import React from 'react';
import { MoreVertical, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface MachineContextMenuProps {
  machineId: string;
  machineName: string;
  siteId: string;
  isOnline: boolean;
  onRemoveMachine: () => void;
}

export function MachineContextMenu({
  machineId,
  machineName,
  siteId,
  isOnline,
  onRemoveMachine,
}: MachineContextMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-slate-700 cursor-pointer"
          onClick={(e) => {
            // Prevent row click event from firing
            e.stopPropagation();
          }}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-slate-700 bg-slate-800 w-48">
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onRemoveMachine();
          }}
          className="text-red-400 focus:bg-red-950/30 focus:text-red-300 cursor-pointer"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Remove Machine
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
