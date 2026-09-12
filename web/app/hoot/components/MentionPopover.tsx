'use client';

import React from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** A machine `@` can name, with the status the list spells out as text. */
export interface MentionMachine {
  id: string;
  online: boolean;
  hootEnabled: boolean;
}

interface MentionPopoverProps {
  open: boolean;
  /** Radix closes on Escape or a pointer-down outside; the composer owns reopening. */
  onOpenChange: (open: boolean) => void;
  options: readonly MentionMachine[];
  /** The row the arrow keys sit on — mirrored by the composer's `aria-activedescendant`. */
  activeId: string | null;
  listboxId: string;
  optionDomId: (machineId: string) => string;
  onSelectOption: (machineId: string) => void;
  /** The composer row, used as the anchor so the list hangs off the input. */
  children: React.ReactNode;
}

/**
 * Focus never enters the list: the composer drives it with
 * `aria-activedescendant` while the caret stays in the textarea, so a
 * completion doesn't interrupt typing.
 */
function keepFocusInComposer(event: Event): void {
  event.preventDefault();
}

/**
 * Why an id is worth flagging before it is mentioned. Mentioning one of these
 * refuses the whole turn rather than skipping it (D-B), so the reason shows up
 * in the list instead of in an error. Offline first, matching the order
 * `resolveHootTargets` refuses in.
 */
function statusLabel(machine: MentionMachine): string | null {
  if (!machine.online) return 'offline';
  if (!machine.hootEnabled) return 'hoot off';
  return null;
}

/**
 * The `@machine` completion list, anchored to the composer rather than to a
 * trigger of its own — a `PopoverTrigger` would be a second tab stop in a row
 * that already has the send button.
 */
export function MentionPopover({
  open,
  onOpenChange,
  options,
  activeId,
  listboxId,
  optionDomId,
  onSelectOption,
  children,
}: MentionPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        aria-label="machines to mention"
        onOpenAutoFocus={keepFocusInComposer}
        onCloseAutoFocus={keepFocusInComposer}
        // Capped against the viewport, not just the composer: the 390px gate
        // fails on any horizontal overflow.
        className="w-[min(18rem,calc(100vw-2rem))] border-border bg-secondary p-1"
      >
        {/*
          Named in its own right: axe's aria-input-field-name (serious, wcag2a)
          covers role="listbox", and the label on the dialog around it does not
          name a descendant.

          Tall enough for the 8-row cap `filterMentionOptions` applies, so it
          never becomes a scroll region. scrollable-region-focusable (serious,
          wcag2a) exempts a combobox popup, and this is not one — the composer
          stays a textbox — and the only thing that satisfies it is a tab stop on
          the list itself (`tabindex="-1"` does NOT: axe requires tabindex >= 0).
          A dead tab stop beside the send button is worse than a fixed height.
        */}
        <ul
          role="listbox"
          id={listboxId}
          aria-label="machines to mention"
          className="max-h-72 overflow-y-auto"
        >
          {options.map((machine) => {
            const status = statusLabel(machine);
            const active = machine.id === activeId;
            return (
              <li
                key={machine.id}
                id={optionDomId(machine.id)}
                role="option"
                aria-selected={active}
                // A mousedown here would blur the textarea and drop the caret
                // the completion is about to write at.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelectOption(machine.id)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground',
                  active && 'bg-accent',
                )}
              >
                <span className="truncate">{machine.id}</span>
                {status && <span className="shrink-0 text-xs text-muted-foreground">{status}</span>}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
