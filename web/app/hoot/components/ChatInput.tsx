'use client';

import React, { useRef, useCallback, useState, useEffect, useId, useMemo } from 'react';
import { Send, Square, X, Loader2, AtSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  applyMention,
  filterMentionOptions,
  findActiveMentionToken,
  parseMentions,
} from '@/lib/hoot/mentions';
import { formatTargetLabel } from '@/lib/hoot/target';
import { MentionPopover, type MentionMachine } from './MentionPopover';

export interface PendingImage {
  url: string;
  mediaType: string;
  uploading: boolean;
  /** Local object URL for preview while uploading */
  previewUrl?: string;
}

/** Stable identity, so the mention memos don't recompute on every parent render. */
const NO_MENTION_OPTIONS: MentionMachine[] = [];

/**
 * Write `value` into the textarea as if it had been typed. React tracks a
 * controlled field's value on the node itself, so plain `node.value = …`
 * updates that tracker and the change is swallowed; going through the
 * prototype's setter leaves the tracker stale, and the dispatched input event
 * arrives at the parent as an ordinary `onChange`. That keeps ONE write path —
 * the composer never needs a setter prop of its own.
 */
function writeTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(textarea, value);
  else textarea.value = value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  onStop: () => void;
  pendingImages: PendingImage[];
  onPasteImage: (blob: Blob) => void;
  onRemoveImage: (index: number) => void;
  /**
   * Machines `@` can name in this chat. Empty (the default) leaves the composer
   * exactly as it was — no completion list, no chip — so a caller that hasn't
   * wired targeting yet is unaffected.
   */
  mentionOptions?: MentionMachine[];
}

export function ChatInput({
  input,
  isLoading,
  onInputChange,
  onSubmit,
  onStop,
  pendingImages,
  onPasteImage,
  onRemoveImage,
  mentionOptions = NO_MENTION_OPTIONS,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [composing, setComposing] = useState(false);
  const [highlight, setHighlight] = useState(0);
  /**
   * The `@` token the list was closed on: where it started, and what had been
   * typed into it. A boolean would re-open on the very next keystroke; the index
   * alone would outlive the token — the composer is not remounted between
   * messages, so an Escape at index 0 would silently suppress the NEXT message's
   * leading `@`. Holding the query too makes the dismissal lapse on its own.
   */
  const [dismissed, setDismissed] = useState<{ start: number; query: string } | null>(null);

  // useId's own delimiters are exotic (`«r0»`); the ids here are referenced by
  // aria-controls/aria-activedescendant, so keep them plainly selectable.
  const fieldId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const listboxId = `${fieldId}-mentions`;
  const optionDomId = useCallback(
    (machineId: string) => `${fieldId}-mention-${machineId}`,
    [fieldId],
  );

  // Close lightbox on Escape
  useEffect(() => {
    if (!expandedImage) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedImage(null);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [expandedImage]);

  // Auto-resize textarea to fit its content. Driven by `input` so it tracks
  // every value change — including programmatic ones like clearing on submit,
  // which fire no input event and would otherwise leave the box stuck tall.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '40px';
    textarea.style.height = `${Math.max(40, Math.min(textarea.scrollHeight, 200))}px`;
  }, [input]);

  const canSend =
    (input.trim() || pendingImages.some((i) => !i.uploading)) && !isLoading;

  const hasMentionOptions = mentionOptions.length > 0;

  // No list while an IME is composing: the candidate window owns the same keys
  // this would intercept, and a half-composed token is not a machine id.
  const mentionToken = useMemo(
    () =>
      hasMentionOptions && !composing && !isLoading
        ? findActiveMentionToken(input, caret)
        : null,
    [hasMentionOptions, composing, isLoading, input, caret],
  );

  const suggestions = useMemo(
    () => (mentionToken ? filterMentionOptions(mentionToken.query, mentionOptions) : []),
    [mentionToken, mentionOptions],
  );

  // The dismissal holds while the user types the SAME token on ("@kio" →
  // "@kios"), and lapses the moment the query stops extending it — a send
  // empties the box, a fresh `@` lands at the same index, and that one gets its
  // list. Derived, not cleared in an effect.
  const stillDismissed =
    dismissed !== null &&
    mentionToken !== null &&
    mentionToken.start === dismissed.start &&
    mentionToken.query.startsWith(dismissed.query);

  const mentionOpen = mentionToken !== null && suggestions.length > 0 && !stillDismissed;

  // Clamped on read rather than reset in an effect: the list shrinks as the
  // query narrows, and the highlight has to stay inside it.
  const activeOption = suggestions[Math.min(highlight, suggestions.length - 1)] ?? null;

  const mentionedIds = useMemo(
    () => (hasMentionOptions ? parseMentions(input, mentionOptions.map((m) => m.id)) : []),
    [hasMentionOptions, input, mentionOptions],
  );

  const syncCaret = useCallback((textarea: HTMLTextAreaElement) => {
    setCaret(textarea.selectionStart ?? textarea.value.length);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      syncCaret(e.target);
      setHighlight(0); // a changed query re-ranks the list
      onInputChange(e);
    },
    [onInputChange, syncCaret],
  );

  const insertMention = useCallback(
    (machineId: string) => {
      const textarea = textareaRef.current;
      if (!textarea || !mentionToken) return;
      const next = applyMention(input, mentionToken, machineId);
      writeTextareaValue(textarea, next.text);
      // Setting the value parks the caret at the end; put it back after the id
      // so typing carries on where the user was. Focus is still here — neither
      // the list nor a click on it ever takes it.
      textarea.setSelectionRange(next.caret, next.caret);
      setCaret(next.caret);
      setHighlight(0);
      setDismissed(null);
    },
    [input, mentionToken],
  );

  const handleMentionOpenChange = useCallback(
    (open: boolean) => {
      // The one close path: Radix reports Escape and pointer-downs outside
      // here. Closing has to be remembered against this `@`, because
      // `mentionOpen` is derived and would re-open on the next render.
      if (!open && mentionToken) {
        setDismissed({ start: mentionToken.start, query: mentionToken.query });
      }
    },
    [mentionToken],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // The completion list claims these keys BEFORE the Enter-submit branch:
      // while it is open, Enter completes a mention rather than sending.
      // Escape is deliberately absent: Radix's dismiss layer already consumes it
      // and reports the close through `onOpenChange`. A branch here would be
      // unfalsifiable — nothing observable changes when it is removed.
      if (mentionOpen) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const step = e.key === 'ArrowDown' ? 1 : -1;
          setHighlight((current) => {
            const from = Math.min(current, suggestions.length - 1);
            return (from + step + suggestions.length) % suggestions.length;
          });
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          if (activeOption) insertMention(activeOption.id);
          return;
        }
      }
      // An IME commits its candidate with Enter. Firefox reports the real key
      // while composing (Chrome masks it as `Process`), so without the flag that
      // commit would send a half-composed message.
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (canSend) {
          onSubmit(e as unknown as React.FormEvent);
        }
      }
    },
    [activeOption, canSend, insertMention, mentionOpen, onSubmit, suggestions.length],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) {
            onPasteImage(blob);
          }
          return;
        }
      }
      // If no image found, let default text paste happen
    },
    [onPasteImage],
  );

  return (
    <div className="border-t border-border px-4 py-3">
      {/* Lightbox overlay */}
      {expandedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-pointer"
          onClick={() => setExpandedImage(null)}
        >
          <button
            type="button"
            onClick={() => setExpandedImage(null)}
            className="absolute top-4 right-4 h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="h-5 w-5 text-white" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={expandedImage}
            alt="Expanded preview"
            className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <form onSubmit={onSubmit} className="max-w-3xl mx-auto">
        {/* Image preview strip */}
        {pendingImages.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {pendingImages.map((img, i) => (
              <div
                key={i}
                className="relative group h-12 w-12 rounded-md border border-border bg-secondary flex-shrink-0"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.previewUrl || img.url}
                  alt="Pending upload"
                  className="h-full w-full object-cover cursor-pointer rounded-md"
                  onClick={() => setExpandedImage(img.previewUrl || img.url)}
                />
                {img.uploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 className="h-4 w-4 text-white animate-spin" />
                  </div>
                )}
                {!img.uploading && (
                  <button
                    type="button"
                    onClick={() => onRemoveImage(i)}
                    aria-label="remove image"
                    className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    <X className="h-2.5 w-2.5 text-white" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* What the typed mentions will narrow this one turn to (D-H/D-I). */}
        {mentionedIds.length > 0 && (
          <div className="mb-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <AtSign className="h-3.5 w-3.5 shrink-0 text-accent-cyan" />
            <span className="truncate">this turn → {formatTargetLabel(mentionedIds)}</span>
          </div>
        )}

        <MentionPopover
          open={mentionOpen}
          onOpenChange={handleMentionOpenChange}
          options={suggestions}
          activeId={activeOption?.id ?? null}
          listboxId={listboxId}
          optionDomId={optionDomId}
          onSelectOption={insertMention}
        >
          <div className="flex gap-2 items-stretch" style={{ minHeight: '40px' }}>
            <textarea
              ref={textareaRef}
              data-chat-input
              value={input}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onSelect={(e) => syncCaret(e.currentTarget)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={(e) => {
                setComposing(false);
                syncCaret(e.currentTarget);
              }}
              onPaste={handlePaste}
              placeholder="ask about this machine..."
              rows={1}
              aria-label="chat message"
              // A textbox, not a combobox: nesting a combobox role in a form row
              // the axe gate scans is rejected outright.
              aria-autocomplete="list"
              aria-controls={mentionOpen ? listboxId : undefined}
              aria-activedescendant={
                mentionOpen && activeOption ? optionDomId(activeOption.id) : undefined
              }
              className="flex-1 resize-none rounded-lg border border-border bg-secondary px-4 py-2 text-sm leading-normal text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-cyan/50 focus:border-accent-cyan"
              disabled={isLoading}
            />

            {isLoading ? (
              <Button
                type="button"
                onClick={onStop}
                size="icon"
                aria-label="stop response"
                className="!h-auto w-10 rounded-lg flex-shrink-0"
              >
                <Square className="h-4 w-4 text-gray-900 fill-gray-900" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={!canSend}
                aria-label="send message"
                className="!h-auto w-10 rounded-lg disabled:opacity-50 flex-shrink-0"
              >
                <Send className="h-4 w-4 text-gray-900" />
              </Button>
            )}
          </div>
        </MentionPopover>
        <p className="mt-1.5 text-[11px] text-muted-foreground text-center">
          responses may be inaccurate. commands run directly on the selected machine.
        </p>
      </form>
    </div>
  );
}
