/// <reference types="@testing-library/jest-dom" />
/**
 * @jest-environment jsdom
 *
 * ShareChatDialog — the consent surface for publishing a conversation.
 *
 * The assertion that matters most is the negative control in "the preview": the
 * dialog runs the SAME `buildShareSnapshot` the API runs, so a tool call's
 * output — hostnames, paths, log lines — must be absent from what the owner is
 * shown, not merely collapsed behind a summary. If that ever passes by accident
 * the preview has stopped being the page, and the promise the copy makes
 * ("read the preview before you share") is worthless.
 *
 * The hook is mocked: request shapes are `__tests__/hooks/useChatShares.test.ts`.
 *
 * Clipboard: `userEvent.setup()` installs user-event's clipboard stub on
 * `navigator` (jsdom has none) and swaps in a fresh one after every test, so
 * `navigator.clipboard.readText()` reads back what the dialog wrote. jsdom has
 * no `ClipboardItem` either — the tests that need one add it, and afterEach
 * takes it away again.
 */

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UIMessage } from 'ai';
import { TooltipProvider } from '@/components/ui/tooltip';
import { shareUrl, type ChatShareSummary } from '@/lib/hoot/shareTypes';
import { toast } from '@/lib/toast';
import { ShareChatDialog } from '@/app/hoot/components/ShareChatDialog';

// jsdom ships no ResizeObserver; Radix's select positioning constructs one.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Radix Select drives its trigger with pointer capture and scrolls the active
// item into view — neither exists in jsdom.
window.HTMLElement.prototype.scrollIntoView = jest.fn();
window.HTMLElement.prototype.hasPointerCapture = jest.fn();
window.HTMLElement.prototype.setPointerCapture = jest.fn();
window.HTMLElement.prototype.releasePointerCapture = jest.fn();

// react-markdown 10 is ESM-only and jest leaves node_modules untransformed, so
// the real renderer cannot load under this runtime. A passthrough is all the
// preview assertions need: markdown rendering is not what is on trial here —
// which text reaches the DOM at all is.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: string }) => children ?? null,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));

jest.mock('@/lib/toast', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

/**
 * Mutable stand-in for the hook's state. `revoke` edits it in place; the
 * component's own `revokingToken` state change re-renders and reads it back,
 * which is exactly how the real hook's row removal reaches the list.
 */
const mockShareState: {
  shares: ChatShareSummary[];
  loading: boolean;
  creating: boolean;
  error: string | null;
} = { shares: [], loading: false, creating: false, error: null };

const mockList = jest.fn();
const mockCreate = jest.fn();
const mockRevoke = jest.fn();
/** Every `(chatId, siteId)` the component handed the hook, in render order. */
const mockUseChatSharesArgs: [string, string][] = [];

jest.mock('@/hooks/useChatShares', () => ({
  useChatShares: (chatId: string, siteId: string) => {
    mockUseChatSharesArgs.push([chatId, siteId]);
    return {
      shares: mockShareState.shares,
      loading: mockShareState.loading,
      creating: mockShareState.creating,
      error: mockShareState.error,
      list: mockList,
      create: mockCreate,
      revoke: mockRevoke,
    };
  },
}));

const CHAT_ID = 'chat_1757000000000_ab12cd';
const SITE_ID = 'site-a';
const TOOL_OUTPUT_SECRET = 'STUDIO-01 10.0.4.17 Access violation at 0x7ffd';
const TOOL_INPUT_SECRET = 'C:/shows/secret-client-project.toe';

const NEWER: ChatShareSummary = {
  token: 'shr_BBBBBBBBBBBBBBBBBBBBBB22',
  createdAt: 1_757_000_000_000,
  expiresAt: null,
  messageCount: 2,
};

const OLDER_EXPIRES_AT = 1_758_592_000_000;

const OLDER: ChatShareSummary = {
  token: 'shr_AAAAAAAAAAAAAAAAAAAAAA11',
  createdAt: 1_756_000_000_000,
  expiresAt: OLDER_EXPIRES_AT,
  messageCount: 1,
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString();
}

/** A row's visible created stamp: date and time to the minute, lowercased. */
function formatCreated(ms: number): string {
  return new Date(ms)
    .toLocaleString(undefined, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    .toLowerCase();
}

/** A row's button names carry date and time to the second (same-minute links must differ). */
function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** jsdom's Blob predates `Blob.text()`. */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** jsdom ships none today; kept so afterEach restores whatever was really there. */
const ORIGINAL_CLIPBOARD_ITEM = Object.getOwnPropertyDescriptor(window, 'ClipboardItem');

interface RecordedClipboardItem {
  data: Record<string, Promise<Blob>>;
}

/**
 * The smallest `ClipboardItem` the dialog can build. It keeps what it was given
 * and never reads it — which is what a browser that refuses the write up front
 * does, and the case that could leave a rejected item unhandled. Returns every
 * item constructed, in order.
 */
function stubClipboardItem(): RecordedClipboardItem[] {
  const built: RecordedClipboardItem[] = [];
  class RecordingClipboardItem implements RecordedClipboardItem {
    constructor(public data: Record<string, Promise<Blob>>) {
      built.push(this);
    }
  }
  Object.defineProperty(window, 'ClipboardItem', {
    value: RecordingClipboardItem,
    configurable: true,
    writable: true,
  });
  return built;
}

/** The notice beside the link box. Always in the tree, so it is a live region before it speaks. */
async function expectCopiedNotice() {
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('copied to clipboard'),
  );
}

type Part = UIMessage['parts'][number];

function msg(id: string, role: UIMessage['role'], parts: unknown[]): UIMessage {
  return { id, role, parts: parts as Part[] } as UIMessage;
}

/** One image (left out), one tool call carrying secrets (collapsed), two texts. */
const MESSAGES: UIMessage[] = [
  msg('u1', 'user', [
    { type: 'text', text: 'why did the deployment fail?' },
    { type: 'file', mediaType: 'image/png', url: 'https://storage.example/1.png' },
  ]),
  msg('a1', 'assistant', [
    {
      type: 'tool-checkLogs',
      toolCallId: 'tool-1',
      state: 'output-available',
      input: { path: TOOL_INPUT_SECRET },
      output: { detail: TOOL_OUTPUT_SECRET },
    },
    { type: 'text', text: 'the installer exited with a retryable warning.' },
  ]),
];

type DialogProps = React.ComponentProps<typeof ShareChatDialog>;

function dialogTree(overrides: Partial<DialogProps> = {}) {
  return (
    <TooltipProvider>
      <ShareChatDialog
        open
        onOpenChange={jest.fn()}
        chatId={CHAT_ID}
        siteId={SITE_ID}
        title="deployment triage"
        targetLabel="STUDIO-01"
        messages={MESSAGES}
        {...overrides}
      />
    </TooltipProvider>
  );
}

function renderDialog(overrides: Partial<DialogProps> = {}) {
  const onOpenChange = jest.fn();
  const user = userEvent.setup();
  const view = render(dialogTree({ onOpenChange, ...overrides }));
  return { user, onOpenChange, ...view };
}

describe('ShareChatDialog', () => {
  beforeEach(() => {
    mockShareState.shares = [];
    mockShareState.loading = false;
    mockShareState.creating = false;
    mockShareState.error = null;
    mockUseChatSharesArgs.length = 0;
    mockList.mockResolvedValue(undefined);
    // Both mutators mirror what the real hook does to its own list, so the
    // component's re-render surfaces the change exactly as it would in the app.
    mockCreate.mockImplementation(async () => {
      mockShareState.shares = [NEWER, ...mockShareState.shares];
      return NEWER;
    });
    mockRevoke.mockImplementation(async (token: string) => {
      mockShareState.shares = mockShareState.shares.filter((s) => s.token !== token);
      return true;
    });
  });

  afterEach(() => {
    if (ORIGINAL_CLIPBOARD_ITEM) {
      Object.defineProperty(window, 'ClipboardItem', ORIGINAL_CLIPBOARD_ITEM);
    } else {
      Reflect.deleteProperty(window, 'ClipboardItem');
    }
    // Spies only — jest 29 leaves the module-level jest.fn() mocks alone.
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('names the chat and its machine, and counts what is dropped — once opened', async () => {
    const { user } = renderDialog();

    await screen.findByRole('dialog');
    expect(screen.getByText('share this conversation')).toBeInTheDocument();
    expect(
      screen.getByText(
        /anyone with the link can read it\. it's a snapshot — later messages are not included\./,
      ),
    ).toBeInTheDocument();

    // The inventories are reference material, folded away until asked for.
    expect(screen.queryByText("your messages and hoot's replies, as text")).toBeNull();
    await user.click(screen.getByRole('button', { name: 'more' }));

    expect(screen.getByText("your messages and hoot's replies, as text")).toBeInTheDocument();
    expect(screen.getByText('the title "deployment triage"')).toBeInTheDocument();
    expect(screen.getByText('the machine name "STUDIO-01"')).toBeInTheDocument();
    // One tool call in the fixture, one image.
    expect(
      screen.getByText('tool calls as one line each — name and outcome (1 collapsed)'),
    ).toBeInTheDocument();
    expect(screen.getByText('images and screenshots (1 left out)')).toBeInTheDocument();
    expect(screen.getByText('tool inputs and outputs')).toBeInTheDocument();
    expect(screen.getByText('system messages')).toBeInTheDocument();

    // The warning is the whole reason the preview is there — and it is never
    // folded away with the inventories.
    expect(
      screen.getByText(
        "hoot's replies can quote machine details — hostnames, file paths, log lines. read the preview before you share.",
      ),
    ).toBeInTheDocument();
  });

  it('folds the inventories away again, and says which way it goes', async () => {
    const { user } = renderDialog();

    const more = await screen.findByRole('button', { name: 'more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');

    await user.click(more);
    const less = screen.getByRole('button', { name: 'less' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('tool inputs and outputs')).toBeInTheDocument();

    await user.click(less);
    await waitFor(() => expect(screen.queryByText('tool inputs and outputs')).toBeNull());
    expect(screen.getByRole('button', { name: 'more' })).toBeInTheDocument();
  });

  it('reopens folded, whatever the last visit left open', async () => {
    const { user, rerender } = renderDialog();

    await user.click(await screen.findByRole('button', { name: 'more' }));
    expect(screen.getByText('tool inputs and outputs')).toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <ShareChatDialog
          open={false}
          onOpenChange={jest.fn()}
          chatId={CHAT_ID}
          siteId={SITE_ID}
          title="deployment triage"
          targetLabel="STUDIO-01"
          messages={MESSAGES}
        />
      </TooltipProvider>,
    );
    rerender(
      <TooltipProvider>
        <ShareChatDialog
          open
          onOpenChange={jest.fn()}
          chatId={CHAT_ID}
          siteId={SITE_ID}
          title="deployment triage"
          targetLabel="STUDIO-01"
          messages={MESSAGES}
        />
      </TooltipProvider>,
    );

    expect(await screen.findByRole('button', { name: 'more' })).toBeInTheDocument();
    expect(screen.queryByText('tool inputs and outputs')).toBeNull();
  });

  it('omits the machine-name line for a chat with no target', async () => {
    renderDialog({ targetLabel: null });

    await screen.findByRole('dialog');
    expect(screen.queryByText(/the machine name/)).toBeNull();
  });

  it('previews the conversation text and the tool NAME — never the tool output', async () => {
    renderDialog();

    const preview = await screen.findByRole('region', { name: 'share preview' });
    expect(preview).toHaveTextContent('why did the deployment fail?');
    expect(preview).toHaveTextContent('the installer exited with a retryable warning.');
    // Collapsed to name + outcome, which is what SharedConversation renders.
    expect(preview).toHaveTextContent('ran checkLogs');
    expect(preview).toHaveTextContent('completed');

    // The negative control: neither the tool's input nor its output may appear
    // anywhere in the dialog, preview included.
    expect(preview).not.toHaveTextContent(TOOL_OUTPUT_SECRET);
    expect(document.body).not.toHaveTextContent(TOOL_OUTPUT_SECRET);
    expect(document.body).not.toHaveTextContent(TOOL_INPUT_SECRET);
  });

  it('lets a keyboard reader focus the preview', async () => {
    renderDialog();

    // The preview is the dialog's only scroll region and holds nothing
    // focusable, so without a tab stop of its own a keyboard-only reader cannot
    // scroll it at all (axe: scrollable-region-focusable).
    const preview = await screen.findByRole('region', { name: 'share preview' });
    expect(preview).toHaveAttribute('tabindex', '0');
  });

  it('loads the active links when it opens, and not while it is closed', async () => {
    const { rerender } = renderDialog({ open: false });
    expect(mockList).not.toHaveBeenCalled();

    rerender(dialogTree());

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));
    expect(mockUseChatSharesArgs[0]).toEqual([CHAT_ID, SITE_ID]);
  });

  describe('create', () => {
    it('defaults to 30 days', async () => {
      const { user } = renderDialog();

      const expirySelect = await screen.findByRole('combobox', { name: 'link expires in' });
      expect(expirySelect).toHaveTextContent('30 days');

      await user.click(screen.getByRole('button', { name: 'create link' }));
      expect(mockCreate).toHaveBeenCalledWith(30);
    });

    it('sends the expiry the operator picked', async () => {
      const { user } = renderDialog();

      await user.click(await screen.findByRole('combobox', { name: 'link expires in' }));
      await user.click(await screen.findByRole('option', { name: '7 days' }));
      await user.click(screen.getByRole('button', { name: 'create link' }));

      expect(mockCreate).toHaveBeenCalledWith(7);
    });

    it('sends a null expiry for "never (until revoked)"', async () => {
      const { user } = renderDialog();

      await user.click(await screen.findByRole('combobox', { name: 'link expires in' }));
      await user.click(await screen.findByRole('option', { name: 'never (until revoked)' }));
      await user.click(screen.getByRole('button', { name: 'create link' }));

      expect(mockCreate).toHaveBeenCalledWith(null);
    });

    it('shows the new link, an open target and a toast', async () => {
      const { user } = renderDialog();

      await user.click(await screen.findByRole('button', { name: 'create link' }));

      const input = await screen.findByRole('textbox', { name: 'share link' });
      expect(input).toHaveValue(shareUrl(window.location.origin, NEWER.token));
      expect((input as HTMLInputElement).value).toContain(NEWER.token);
      expect(input).toHaveAttribute('readonly');

      const openLink = screen.getByRole('link', { name: 'open' });
      expect(openLink).toHaveAttribute('href', shareUrl(window.location.origin, NEWER.token));
      expect(openLink).toHaveAttribute('target', '_blank');
      expect(openLink).toHaveAttribute('rel', 'noopener noreferrer');

      // The box keeps its own copy button beside the auto-copy.
      expect(screen.getByRole('button', { name: 'copy to clipboard' })).toBeInTheDocument();

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('link created and copied to clipboard'),
      );
    });

    it('shows no link and no toast when the create fails', async () => {
      mockCreate.mockResolvedValue(null);
      mockShareState.error = 'nothing to share';
      const { user } = renderDialog();

      await user.click(await screen.findByRole('button', { name: 'create link' }));

      expect(screen.queryByRole('textbox', { name: 'share link' })).toBeNull();
      expect(toast.success).not.toHaveBeenCalled();
      // The server's own words, inline.
      expect(screen.getByRole('alert')).toHaveTextContent('nothing to share');
    });

    it('refuses an empty conversation', async () => {
      renderDialog({ messages: [] });

      await screen.findByRole('dialog');
      expect(screen.getByRole('button', { name: 'create link' })).toBeDisabled();
      expect(screen.getByText('nothing to share yet')).toBeInTheDocument();
    });

    it('is disabled while a create is in flight', async () => {
      mockShareState.creating = true;
      renderDialog();

      await screen.findByRole('dialog');
      expect(screen.getByRole('button', { name: 'create link' })).toBeDisabled();
    });
  });

  describe('copying the new link', () => {
    it('copies it with writeText where ClipboardItem is missing, and says so', async () => {
      // The precondition that makes this the fallback path.
      expect(window.ClipboardItem).toBeUndefined();
      const { user } = renderDialog();

      await user.click(await screen.findByRole('button', { name: 'create link' }));

      await expectCopiedNotice();
      expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
      expect(await navigator.clipboard.readText()).toBe(
        shareUrl(window.location.origin, NEWER.token),
      );
      expect(toast.success).toHaveBeenCalledWith('link created and copied to clipboard');
    });

    it('starts the write inside the click, before the link exists', async () => {
      const items = stubClipboardItem();
      let resolveCreate: (share: ChatShareSummary | null) => void = () => undefined;
      mockCreate.mockImplementation(
        () =>
          new Promise<ChatShareSummary | null>((resolve) => {
            resolveCreate = resolve;
          }),
      );
      const { user } = renderDialog();
      const write = jest.spyOn(navigator.clipboard, 'write');

      await user.click(await screen.findByRole('button', { name: 'create link' }));

      // The server has not answered, and the write has already begun — the only
      // way it keeps the click's user activation in Safari.
      expect(screen.queryByRole('textbox', { name: 'share link' })).toBeNull();
      expect(write).toHaveBeenCalledTimes(1);
      expect(items).toHaveLength(1);
      expect(write.mock.calls[0][0]).toEqual([items[0]]);

      await act(async () => resolveCreate(NEWER));

      const blob = await items[0].data['text/plain'];
      expect(blob.type).toBe('text/plain');
      expect(await readBlobText(blob)).toBe(shareUrl(window.location.origin, NEWER.token));
      await expectCopiedNotice();
      expect(toast.success).toHaveBeenCalledWith('link created and copied to clipboard');
    });

    it('claims nothing when the clipboard refuses both ways', async () => {
      stubClipboardItem();
      const { user } = renderDialog();
      const refused = new DOMException('clipboard refused', 'NotAllowedError');
      const write = jest.spyOn(navigator.clipboard, 'write').mockRejectedValue(refused);
      const writeText = jest.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(refused);

      await user.click(await screen.findByRole('button', { name: 'create link' }));

      const url = shareUrl(window.location.origin, NEWER.token);
      expect(await screen.findByRole('textbox', { name: 'share link' })).toHaveValue(url);
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('link created'));
      expect(write).toHaveBeenCalledTimes(1);
      // The fallback was tried, with the link, once the link existed.
      expect(writeText).toHaveBeenCalledWith(url);
      expect(screen.queryByText('copied to clipboard')).toBeNull();
      expect(toast.success).not.toHaveBeenCalledWith('link created and copied to clipboard');
    });

    it('writes nothing, and leaks no rejection, when the create fails', async () => {
      // The pending item is left unread — a browser refusing the write up
      // front — so its rejection, once create() comes back empty, is the
      // dialog's to handle. jest fails the running test on an unhandled
      // rejection, so settling the queue below is the assertion.
      stubClipboardItem();
      mockCreate.mockResolvedValue(null);
      mockShareState.error = 'nothing to share';
      const { user } = renderDialog();
      jest
        .spyOn(navigator.clipboard, 'write')
        .mockRejectedValue(new DOMException('clipboard refused', 'NotAllowedError'));
      const writeText = jest.spyOn(navigator.clipboard, 'writeText');

      await user.click(await screen.findByRole('button', { name: 'create link' }));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(writeText).not.toHaveBeenCalled();
      expect(await navigator.clipboard.readText()).toBe('');
      expect(screen.queryByRole('textbox', { name: 'share link' })).toBeNull();
      expect(screen.queryByText('copied to clipboard')).toBeNull();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('lets the notice go after a few seconds, and keeps the link', async () => {
      jest.useFakeTimers({ advanceTimers: true });
      const { user } = renderDialog();

      await user.click(await screen.findByRole('button', { name: 'create link' }));
      await expectCopiedNotice();

      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.getByRole('status')).toHaveTextContent('copied to clipboard');

      act(() => {
        jest.advanceTimersByTime(3000);
      });
      expect(screen.queryByText('copied to clipboard')).toBeNull();
      expect(screen.getByRole('textbox', { name: 'share link' })).toBeInTheDocument();
    });

    it('drops the notice with the link when that link is revoked', async () => {
      const { user } = renderDialog();

      await user.click(await screen.findByRole('button', { name: 'create link' }));
      await expectCopiedNotice();

      await user.click(
        screen.getByRole('button', {
          name: `revoke link created ${formatDateTime(NEWER.createdAt)}`,
        }),
      );

      await waitFor(() =>
        expect(screen.queryByRole('textbox', { name: 'share link' })).toBeNull(),
      );
      expect(screen.queryByText('copied to clipboard')).toBeNull();
    });

    it('drops the notice when the dialog is reopened', async () => {
      const { user, rerender } = renderDialog();

      await user.click(await screen.findByRole('button', { name: 'create link' }));
      await expectCopiedNotice();

      rerender(dialogTree({ open: false }));
      rerender(dialogTree());

      await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole('textbox', { name: 'share link' })).toBeNull();
      expect(screen.queryByText('copied to clipboard')).toBeNull();
    });
  });

  describe('active links', () => {
    it('says so when there are none', async () => {
      renderDialog();

      await screen.findByRole('dialog');
      expect(screen.getByText('no active links')).toBeInTheDocument();
    });

    it('shows when each link was made, when it dies and how much it carries', async () => {
      mockShareState.shares = [NEWER, OLDER];
      renderDialog();

      await screen.findByRole('dialog');
      // The created stamp carries the time as well as the date; expiry stays a date.
      expect(formatCreated(NEWER.createdAt)).toMatch(/\d:\d{2}/);
      expect(
        screen.getByText(`created ${formatCreated(NEWER.createdAt)} · never expires · 2 messages`),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          `created ${formatCreated(OLDER.createdAt)} · expires ${formatDate(OLDER_EXPIRES_AT)} · 1 message`,
        ),
      ).toBeInTheDocument();
    });

    it("gives every row a copy button, named for its link, that copies that row's URL", async () => {
      mockShareState.shares = [NEWER, OLDER];
      const { user } = renderDialog();

      const copyNewer = await screen.findByRole('button', {
        name: `copy link created ${formatDateTime(NEWER.createdAt).toLowerCase()}`,
      });
      const copyOlder = screen.getByRole('button', {
        name: `copy link created ${formatDateTime(OLDER.createdAt).toLowerCase()}`,
      });
      expect(copyNewer).not.toBe(copyOlder);

      await user.click(copyOlder);
      expect(await navigator.clipboard.readText()).toBe(
        shareUrl(window.location.origin, OLDER.token),
      );

      await user.click(copyNewer);
      expect(await navigator.clipboard.readText()).toBe(
        shareUrl(window.location.origin, NEWER.token),
      );
    });

    it('revokes one row and leaves the other standing', async () => {
      mockShareState.shares = [NEWER, OLDER];
      const { user } = renderDialog();

      const revokeNewer = await screen.findByRole('button', {
        name: `revoke link created ${formatDateTime(NEWER.createdAt)}`,
      });
      await user.click(revokeNewer);

      expect(mockRevoke).toHaveBeenCalledWith(NEWER.token);
      await waitFor(() =>
        expect(
          screen.queryByRole('button', {
            name: `revoke link created ${formatDateTime(NEWER.createdAt)}`,
          }),
        ).toBeNull(),
      );
      expect(
        screen.getByRole('button', {
          name: `revoke link created ${formatDateTime(OLDER.createdAt)}`,
        }),
      ).toBeInTheDocument();
      expect(toast.success).toHaveBeenCalledWith('link revoked');
    });

    it('clears the link box when the link it holds is revoked', async () => {
      const { user } = renderDialog();

      await user.click(await screen.findByRole('button', { name: 'create link' }));
      await screen.findByRole('textbox', { name: 'share link' });

      await user.click(
        await screen.findByRole('button', {
          name: `revoke link created ${formatDateTime(NEWER.createdAt)}`,
        }),
      );

      await waitFor(() =>
        expect(screen.queryByRole('textbox', { name: 'share link' })).toBeNull(),
      );
    });

    it('keeps the row and shows the reason when a revoke fails', async () => {
      mockShareState.shares = [OLDER];
      mockRevoke.mockImplementation(async () => {
        mockShareState.error = 'no such link on this conversation';
        return false;
      });
      const { user } = renderDialog();

      const revokeButton = await screen.findByRole('button', {
        name: `revoke link created ${formatDateTime(OLDER.createdAt)}`,
      });
      await user.click(revokeButton);

      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(
          'no such link on this conversation',
        ),
      );
      expect(revokeButton).toBeInTheDocument();
      expect(toast.success).not.toHaveBeenCalled();
    });
  });
});
