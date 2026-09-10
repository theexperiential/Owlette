/**
 * @jest-environment jsdom
 *
 * `useChatShares` — the fetch-based owner of `/api/hoot/chats/{chatId}/shares`.
 *
 * Under test: the request shapes the route table in `lib/hoot/shareTypes.ts`
 * declares, the local list edits that keep the dialog honest without a refetch,
 * and problem+json surfacing — a 409 "nothing to share" or a 413 "too large" is
 * the only explanation the user gets, so the server's `detail` must survive.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { useChatShares } from '@/hooks/useChatShares';
import type { ChatShareSummary } from '@/lib/hoot/shareTypes';

const CHAT_ID = 'chat_1757000000000_ab12cd';
const SITE_ID = 'site-a';
const SHARES_URL = `/api/hoot/chats/${CHAT_ID}/shares`;

const OLDER: ChatShareSummary = {
  token: 'shr_AAAAAAAAAAAAAAAAAAAAAA11',
  createdAt: 1_756_000_000_000,
  expiresAt: 1_758_592_000_000,
  messageCount: 6,
};

const NEWER: ChatShareSummary = {
  token: 'shr_BBBBBBBBBBBBBBBBBBBBBB22',
  createdAt: 1_757_000_000_000,
  expiresAt: null,
  messageCount: 8,
};

function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useChatShares', () => {
  const fetchMock = jest.fn();
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('starts idle — nothing is fetched until list() is called', () => {
    const { result } = renderHook(() => useChatShares(CHAT_ID, SITE_ID));

    expect(result.current.shares).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.creating).toBe(false);
    expect(result.current.error).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('list', () => {
    it('gets the active links for the chat, scoped by siteId', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ shares: [NEWER, OLDER] }));

      const { result } = renderHook(() => useChatShares(CHAT_ID, SITE_ID));
      await act(async () => {
        await result.current.list();
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(`${SHARES_URL}?siteId=${SITE_ID}`);
      // A bare GET: no method, no body.
      expect(fetchMock.mock.calls[0][1]).toBeUndefined();
      expect(result.current.shares).toEqual([NEWER, OLDER]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('tolerates a response without a shares array', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));

      const { result } = renderHook(() => useChatShares(CHAT_ID, SITE_ID));
      await act(async () => {
        await result.current.list();
      });

      expect(result.current.shares).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('reports loading while the request is in flight', async () => {
      const pending = deferred<Response>();
      fetchMock.mockReturnValue(pending.promise);

      const { result } = renderHook(() => useChatShares(CHAT_ID, SITE_ID));
      let settled!: Promise<void>;
      act(() => {
        settled = result.current.list();
      });
      await waitFor(() => expect(result.current.loading).toBe(true));

      await act(async () => {
        pending.resolve(jsonResponse({ shares: [NEWER] }));
        await settled;
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.shares).toEqual([NEWER]);
    });

    it('surfaces the problem+json detail and stops loading', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          { title: 'forbidden', detail: 'this conversation is not yours to share' },
          { ok: false, status: 403 },
        ),
      );

      const { result } = renderHook(() => useChatShares(CHAT_ID, SITE_ID));
      await act(async () => {
        await result.current.list();
      });

      expect(result.current.error).toBe('this conversation is not yours to share');
      expect(result.current.shares).toEqual([]);
      expect(result.current.loading).toBe(false);
    });

    it('falls back to a generic message when the error body carries none', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }));

      const { result } = renderHook(() => useChatShares(CHAT_ID, SITE_ID));
      await act(async () => {
        await result.current.list();
      });

      expect(result.current.error).toBe('failed to load links');
    });

    it('is inert without a chatId or a siteId', async () => {
      const { result } = renderHook(() => useChatShares(CHAT_ID, ''));

      await act(async () => {
        await result.current.list();
      });
      await act(async () => {
        expect(await result.current.create(30)).toBeNull();
        expect(await result.current.revoke(NEWER.token)).toBe(false);
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.current.error).toBeNull();
    });

    it('drops the previous chat’s links when the chat changes', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ shares: [NEWER] }));

      const { result, rerender } = renderHook(
        ({ chatId }: { chatId: string }) => useChatShares(chatId, SITE_ID),
        { initialProps: { chatId: CHAT_ID } },
      );
      await act(async () => {
        await result.current.list();
      });
      expect(result.current.shares).toEqual([NEWER]);

      rerender({ chatId: 'chat_other' });
      expect(result.current.shares).toEqual([]);
    });
  });

  describe('create', () => {
    it('posts siteId + expiry, returns the share and prepends it to the list', async () => {
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? jsonResponse({ share: NEWER }, { status: 201 })
          : jsonResponse({ shares: [OLDER] }),
      );

      const { result } = renderHook(() => useChatShares(CHAT_ID, SITE_ID));
      await act(async () => {
        await result.current.list();
      });
      fetchMock.mockClear();

      let created: ChatShareSummary | null = null;
      await act(async () => {
        created = await result.current.create(7);
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(SHARES_URL);
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['content-type']).toBe(
        'application/json',
      );
      expect(JSON.parse(String(init.body))).toEqual({
        siteId: SITE_ID,
        expiresInDays: 7,
      });

      expect(created).toEqual(NEWER);
      // Newest first, and no refetch — the route answered with the row itself.
      expect(result.current.shares).toEqual([NEWER, OLDER]);
      expect(result.current.creating).toBe(false);
    });

    it('sends a null expiry for a link that never expires', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ share: NEWER }, { status: 201 }));

      const { result } = renderHook(() => useChatShares(CHAT_ID, SITE_ID));
      await act(async () => {
        await result.current.create(null);
      });

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(JSON.parse(String(init.body))).toEqual({
        siteId: SITE_ID,
        expiresInDays: null,
      });
    });

    it('reports creating while the request is in flight', async () => {
      const pending = deferred<Response>();
      fetchMock.mockReturnValue(pending.promise);

      const { result } = renderHook(() => useChatShares(CHAT_ID, SITE_ID));
      let settled!: Promise<ChatShareSummary | null>;
      act(() => {
        settled = result.current.create(30);
      });
      await waitFor(() => expect(result.current.creating).toBe(true));

      await act(async () => {
        pending.resolve(jsonResponse({ share: NEWER }, { status: 201 }));
        await settled;
      });
      expect(result.current.creating).toBe(false);
    });

    it('surfaces the 409 detail, returns null and leaves the list alone', async () => {
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? jsonResponse(
              { title: 'conflict', detail: 'nothing to share' },
              { ok: false, status: 409 },
            )
          : jsonResponse({ shares: [OLDER] }),
      );

      const { result } = renderHook(() => useChatShares(CHAT_ID, SITE_ID));
      await act(async () => {
        await result.current.list();
      });

      let created: ChatShareSummary | null = OLDER;
      await act(async () => {
        created = await result.current.create(30);
      });

      expect(created).toBeNull();
      expect(result.current.error).toBe('nothing to share');
      expect(result.current.shares).toEqual([OLDER]);
      expect(result.current.creating).toBe(false);
    });

    it('surfaces the `error` alias when the envelope carries no detail', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          { title: 'payload too large', error: 'snapshot is too large to share' },
          { ok: false, status: 413 },
        ),
      );

      const { result } = renderHook(() => useChatShares(CHAT_ID, SITE_ID));
      await act(async () => {
        await result.current.create(30);
      });

      expect(result.current.error).toBe('snapshot is too large to share');
    });
  });

  describe('revoke', () => {
    it('deletes the token and drops only that row', async () => {
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
        init?.method === 'DELETE'
          ? jsonResponse({ revoked: true })
          : jsonResponse({ shares: [NEWER, OLDER] }),
      );

      const { result } = renderHook(() => useChatShares(CHAT_ID, SITE_ID));
      await act(async () => {
        await result.current.list();
      });
      fetchMock.mockClear();

      let revoked = false;
      await act(async () => {
        revoked = await result.current.revoke(NEWER.token);
      });

      expect(revoked).toBe(true);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${SHARES_URL}/${NEWER.token}?siteId=${SITE_ID}`);
      expect(init.method).toBe('DELETE');
      expect(result.current.shares).toEqual([OLDER]);
      expect(result.current.error).toBeNull();
    });

    it('surfaces the detail, returns false and keeps the row on failure', async () => {
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
        init?.method === 'DELETE'
          ? jsonResponse({ detail: 'no such link on this conversation' }, { ok: false, status: 404 })
          : jsonResponse({ shares: [NEWER] }),
      );

      const { result } = renderHook(() => useChatShares(CHAT_ID, SITE_ID));
      await act(async () => {
        await result.current.list();
      });

      let revoked = true;
      await act(async () => {
        revoked = await result.current.revoke(NEWER.token);
      });

      expect(revoked).toBe(false);
      expect(result.current.error).toBe('no such link on this conversation');
      expect(result.current.shares).toEqual([NEWER]);
    });
  });
});
