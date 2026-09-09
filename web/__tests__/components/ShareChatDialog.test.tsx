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
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

function renderDialog(overrides: Partial<React.ComponentProps<typeof ShareChatDialog>> = {}) {
  const onOpenChange = jest.fn();
  const user = userEvent.setup();
  const view = render(
    <TooltipProvider>
      <ShareChatDialog
        open
        onOpenChange={onOpenChange}
        chatId={CHAT_ID}
        siteId={SITE_ID}
        title="deployment triage"
        targetLabel="STUDIO-01"
        messages={MESSAGES}
        {...overrides}
      />
    </TooltipProvider>,
  );
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

  it('names the chat and its machine, and counts what is dropped', async () => {
    renderDialog();

    await screen.findByRole('dialog');
    expect(screen.getByText('share this conversation')).toBeInTheDocument();
    expect(
      screen.getByText(
        "anyone with the link can read it. it's a snapshot — later messages are not included.",
      ),
    ).toBeInTheDocument();

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

    // The warning is the whole reason the preview is there.
    expect(
      screen.getByText(
        "hoot's replies can quote machine details — hostnames, file paths, log lines. read the preview before you share.",
      ),
    ).toBeInTheDocument();
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

  it('loads the active links when it opens, and not while it is closed', async () => {
    const { rerender } = renderDialog({ open: false });
    expect(mockList).not.toHaveBeenCalled();

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

      expect(toast.success).toHaveBeenCalledWith('link created');
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
      expect(
        screen.getByText(`created ${formatDate(NEWER.createdAt)} · never expires · 2 messages`),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          `created ${formatDate(OLDER.createdAt)} · expires ${formatDate(OLDER_EXPIRES_AT)} · 1 message`,
        ),
      ).toBeInTheDocument();
    });

    it('revokes one row and leaves the other standing', async () => {
      mockShareState.shares = [NEWER, OLDER];
      const { user } = renderDialog();

      const revokeNewer = await screen.findByRole('button', {
        name: `revoke link created ${formatDate(NEWER.createdAt)}`,
      });
      await user.click(revokeNewer);

      expect(mockRevoke).toHaveBeenCalledWith(NEWER.token);
      await waitFor(() =>
        expect(
          screen.queryByRole('button', {
            name: `revoke link created ${formatDate(NEWER.createdAt)}`,
          }),
        ).toBeNull(),
      );
      expect(
        screen.getByRole('button', {
          name: `revoke link created ${formatDate(OLDER.createdAt)}`,
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
          name: `revoke link created ${formatDate(NEWER.createdAt)}`,
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
        name: `revoke link created ${formatDate(OLDER.createdAt)}`,
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
