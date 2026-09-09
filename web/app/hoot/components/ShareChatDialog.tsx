'use client';

/**
 * Publish a conversation as a read-only link.
 *
 * The preview is not a mock-up: it runs `buildShareSnapshot` — the same builder
 * the API runs on the persisted chat — through `SharedConversation`, the same
 * renderer `/share/{token}` uses. What the owner reads here is what a reader
 * gets, which is the point: assistant TEXT can quote hostnames, paths and log
 * lines even though tool inputs and outputs never leave the machine.
 *
 * Every request goes through `useChatShares`; nothing here touches Firestore.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UIMessage } from 'ai';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormError } from '@/components/ui/form-error';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SharedConversation } from '@/components/hoot/SharedConversation';
import { buildShareSnapshot } from '@/lib/hoot/shareSnapshot';
import {
  DEFAULT_SHARE_EXPIRY_DAYS,
  SHARE_EXPIRY_OPTIONS_DAYS,
  shareUrl,
  type ChatShareSummary,
  type ShareExpiry,
  type ShareExpiryDays,
} from '@/lib/hoot/shareTypes';
import { useChatShares } from '@/hooks/useChatShares';
import { toast } from '@/lib/toast';
import { CopyButton } from './CopyButton';

/** Radix Select speaks strings; `null` (never expires) needs a value of its own. */
const NEVER_VALUE = 'never';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString();
}

function messageCountLabel(count: number): string {
  return `${count} message${count === 1 ? '' : 's'}`;
}

interface ShareChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatId: string;
  siteId: string;
  title: string;
  /** Machine name, or "All Machines" for a site-wide chat. `null` when unknown. */
  targetLabel: string | null;
  messages: UIMessage[];
}

export function ShareChatDialog({
  open,
  onOpenChange,
  chatId,
  siteId,
  title,
  targetLabel,
  messages,
}: ShareChatDialogProps) {
  const { shares, loading, creating, error, list, create, revoke } = useChatShares(
    chatId,
    siteId,
  );
  const [expiry, setExpiry] = useState<string>(String(DEFAULT_SHARE_EXPIRY_DAYS));
  const [created, setCreated] = useState<ChatShareSummary | null>(null);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);

  // The dialog stays mounted with the chat view, so `messages` keeps changing as
  // a turn streams — building the snapshot unconditionally would rebuild it once
  // per token. Only an open dialog needs the preview or the counts.
  const snapshot = useMemo(
    () => buildShareSnapshot({ title, targetLabel, messages: open ? messages : [] }),
    [open, title, targetLabel, messages],
  );

  useEffect(() => {
    if (!open) return;
    // Reopening starts clean: a link created in a previous visit is already in
    // "active links", and leaving it in the box would read as a fresh one.
    setCreated(null);
    setExpiry(String(DEFAULT_SHARE_EXPIRY_DAYS));
    void list();
  }, [open, list]);

  const handleCreate = useCallback(async () => {
    const expiresInDays: ShareExpiry =
      expiry === NEVER_VALUE ? null : (Number(expiry) as ShareExpiryDays);
    const share = await create(expiresInDays);
    if (!share) return;
    setCreated(share);
    toast.success('link created');
  }, [create, expiry]);

  const handleRevoke = useCallback(
    async (token: string) => {
      setRevokingToken(token);
      try {
        if (!(await revoke(token))) return;
        // Revoking the link still shown in the box must clear it — a dead URL
        // beside a copy button is worse than no URL at all.
        setCreated((prev) => (prev?.token === token ? null : prev));
        toast.success('link revoked');
      } finally {
        setRevokingToken(null);
      }
    },
    [revoke],
  );

  const isEmpty = snapshot.messages.length === 0;
  // Only reachable after a click, so `window` is always there.
  const createdUrl = created ? shareUrl(window.location.origin, created.token) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>share this conversation</DialogTitle>
          <DialogDescription>
            anyone with the link can read it. it&apos;s a snapshot — later messages are
            not included.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <section>
            <h3 className="mb-1.5 text-xs font-medium text-foreground">what&apos;s included</h3>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>your messages and hoot&apos;s replies, as text</li>
              <li>the title &quot;{snapshot.title}&quot;</li>
              {targetLabel !== null && <li>the machine name &quot;{targetLabel}&quot;</li>}
              <li>
                tool calls as one line each — name and outcome (
                {snapshot.collapsedToolCalls} collapsed)
              </li>
            </ul>
          </section>
          <section>
            <h3 className="mb-1.5 text-xs font-medium text-foreground">
              what&apos;s not included
            </h3>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>images and screenshots ({snapshot.omitted.images} left out)</li>
              <li>tool inputs and outputs</li>
              <li>system messages</li>
            </ul>
          </section>
        </div>

        <p className="text-xs text-yellow-500">
          hoot&apos;s replies can quote machine details — hostnames, file paths, log lines.
          read the preview before you share.
        </p>

        <div
          role="region"
          aria-label="share preview"
          className="max-h-[40vh] overflow-y-auto rounded-md border border-border bg-background p-3"
        >
          <SharedConversation messages={snapshot.messages} variant="preview" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">link expires in</span>
          <Select value={expiry} onValueChange={setExpiry}>
            <SelectTrigger size="sm" aria-label="link expires in" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHARE_EXPIRY_OPTIONS_DAYS.map((days) => (
                <SelectItem key={days} value={String(days)}>
                  {days} days
                </SelectItem>
              ))}
              <SelectItem value={NEVER_VALUE}>never (until revoked)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {createdUrl && (
          <div className="flex items-center gap-2">
            <Input
              readOnly
              aria-label="share link"
              value={createdUrl}
              className="font-mono text-xs"
            />
            <CopyButton value={createdUrl} iconSize="sm" />
            <Button variant="link" size="sm" asChild>
              <a href={createdUrl} target="_blank" rel="noopener noreferrer">
                open
              </a>
            </Button>
          </div>
        )}

        <FormError message={error} />

        <section className="border-t border-border pt-3">
          <h3 className="mb-1.5 text-xs font-medium text-foreground">active links</h3>
          {loading ? (
            <p className="text-xs text-muted-foreground">loading links…</p>
          ) : shares.length === 0 ? (
            <p className="text-xs text-muted-foreground">no active links</p>
          ) : (
            <ul className="space-y-1">
              {shares.map((share) => {
                const createdOn = formatDate(share.createdAt);
                return (
                  <li
                    key={share.token}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      created {createdOn} ·{' '}
                      {share.expiresAt === null
                        ? 'never expires'
                        : `expires ${formatDate(share.expiresAt)}`}{' '}
                      · {messageCountLabel(share.messageCount)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`revoke link created ${createdOn}`}
                      disabled={revokingToken === share.token}
                      onClick={() => void handleRevoke(share.token)}
                    >
                      revoke
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <DialogFooter className="sm:items-center">
          {isEmpty && (
            <span className="text-xs text-muted-foreground sm:mr-auto">
              nothing to share yet
            </span>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            cancel
          </Button>
          <Button onClick={() => void handleCreate()} disabled={creating || isEmpty}>
            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
            create link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
