'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatShareSummary, ShareExpiry } from '@/lib/hoot/shareTypes';

/**
 * The single owner of every `/api/hoot/chats/{chatId}/shares` request.
 *
 * Fetch-based, never a Firestore listener: a share's persistence lives behind
 * the route (`shareStore.server.ts`) so that publishing a snapshot stays a
 * server decision — the client is not trusted to decide what a link exposes.
 * The route table this codes to is `lib/hoot/shareTypes.ts`.
 *
 * `list` is explicit rather than an on-mount effect: the share dialog is
 * mounted with the chat view and only wants the owner's links once it opens.
 */

interface ApiProblem {
  detail?: string;
  title?: string;
  error?: string;
  message?: string;
}

/**
 * Best message out of a problem+json body. `detail` and `error` are the two
 * fields `apiError` fills with the real text ("nothing to share", "snapshot too
 * large"); `title` is only the generic status label, so it comes after them.
 */
async function problemMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as ApiProblem;
  return body.detail || body.error || body.title || body.message || fallback;
}

function sharesPath(chatId: string): string {
  return `/api/hoot/chats/${encodeURIComponent(chatId)}/shares`;
}

const EMPTY_SHARES: ChatShareSummary[] = [];

export interface UseChatSharesResult {
  /** Active links, newest first — as the route returns them. */
  shares: ChatShareSummary[];
  /** A `list()` is in flight. */
  loading: boolean;
  /** A `create()` is in flight. */
  creating: boolean;
  /** Last failure's server-supplied text; cleared when the next call starts. */
  error: string | null;
  /** Never rejects — a failed load lands in `error` and empties the list. */
  list: () => Promise<void>;
  /** The new share on success, `null` on failure (see `error`). */
  create: (expiresInDays: ShareExpiry) => Promise<ChatShareSummary | null>;
  /** `true` when the link is gone; the row is dropped from `shares`. */
  revoke: (token: string) => Promise<boolean>;
}

export function useChatShares(
  chatId: string | null | undefined,
  siteId: string | null | undefined,
): UseChatSharesResult {
  const [shares, setShares] = useState<ChatShareSummary[]>(EMPTY_SHARES);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monotonic request token. Bumped when the chat/site changes and by every
  // `list()`, so a late response can never overwrite a newer list — or push the
  // hook back into a loading state after the state it described was discarded.
  // `create`/`revoke` read it without bumping: they must not invalidate a list.
  const requestSeq = useRef(0);

  useEffect(() => {
    // A different chat (or site) is a different set of links. Invalidate what is
    // in flight and drop what belonged to the previous one, errors included.
    requestSeq.current += 1;
    setShares(EMPTY_SHARES);
    setError(null);
    setLoading(false);
    setCreating(false);
  }, [chatId, siteId]);

  const list = useCallback(async (): Promise<void> => {
    if (!chatId || !siteId) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${sharesPath(chatId)}?siteId=${encodeURIComponent(siteId)}`,
      );
      if (!res.ok) throw new Error(await problemMessage(res, 'failed to load links'));
      const data = (await res.json()) as { shares?: ChatShareSummary[] };
      if (seq !== requestSeq.current) return;
      setShares(data.shares ?? EMPTY_SHARES);
      setLoading(false);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setShares(EMPTY_SHARES);
      setError(err instanceof Error ? err.message : 'failed to load links');
      setLoading(false);
    }
  }, [chatId, siteId]);

  const create = useCallback(
    async (expiresInDays: ShareExpiry): Promise<ChatShareSummary | null> => {
      if (!chatId || !siteId) return null;
      const seq = requestSeq.current;
      setCreating(true);
      setError(null);
      try {
        const res = await fetch(sharesPath(chatId), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ siteId, expiresInDays }),
        });
        if (!res.ok) throw new Error(await problemMessage(res, 'failed to create link'));
        const { share } = (await res.json()) as { share: ChatShareSummary };
        if (seq !== requestSeq.current) return null;
        // Prepend rather than refetch: the route answers with the row itself,
        // and the list it belongs in is ordered newest first.
        setShares((prev) => [share, ...prev]);
        setCreating(false);
        return share;
      } catch (err) {
        if (seq !== requestSeq.current) return null;
        setError(err instanceof Error ? err.message : 'failed to create link');
        setCreating(false);
        return null;
      }
    },
    [chatId, siteId],
  );

  const revoke = useCallback(
    async (token: string): Promise<boolean> => {
      if (!chatId || !siteId) return false;
      const seq = requestSeq.current;
      setError(null);
      try {
        const res = await fetch(
          `${sharesPath(chatId)}/${encodeURIComponent(token)}?siteId=${encodeURIComponent(siteId)}`,
          { method: 'DELETE' },
        );
        if (!res.ok) throw new Error(await problemMessage(res, 'failed to revoke link'));
        if (seq !== requestSeq.current) return false;
        setShares((prev) => prev.filter((share) => share.token !== token));
        return true;
      } catch (err) {
        if (seq !== requestSeq.current) return false;
        setError(err instanceof Error ? err.message : 'failed to revoke link');
        return false;
      }
    },
    [chatId, siteId],
  );

  return { shares, loading, creating, error, list, create, revoke };
}
