/// <reference types="@testing-library/jest-dom" />
/**
 * @jest-environment jsdom
 *
 * ChatWindow — scoped to "edit & resend" on a user message: the pencil opens a
 * box holding the message, the caret waits after the text, Enter, Shift+Enter
 * and Escape keep their meanings, and the box grows with its text. jsdom lays
 * nothing out, so the growth runs against modelled metrics, and that the box's
 * column spans the whole row is not asserted at all.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UIMessage } from 'ai';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChatWindow } from '@/app/hoot/components/ChatWindow';

// react-markdown 10 is ESM-only and jest leaves node_modules untransformed, so
// the real renderer cannot load under this runtime. Markdown is not on trial.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: string }) => children ?? null,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'op-uid', email: 'op@example.com', displayName: 'op' } }),
}));

// The window keeps itself scrolled to the newest message; jsdom has no layout.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

const USER_TEXT = 'Run the PowerShell command hostname on this machine using the run_powershell tool.';

type Part = UIMessage['parts'][number];

function msg(id: string, role: UIMessage['role'], parts: unknown[]): UIMessage {
  return { id, role, parts: parts as Part[] } as UIMessage;
}

const MESSAGES: UIMessage[] = [
  msg('u1', 'user', [{ type: 'text', text: USER_TEXT }]),
  msg('a1', 'assistant', [{ type: 'text', text: 'the hostname is STUDIO-01.' }]),
];

function renderChat(overrides: Partial<React.ComponentProps<typeof ChatWindow>> = {}) {
  const onEditMessage = jest.fn();
  const user = userEvent.setup();
  const view = render(
    <TooltipProvider>
      <ChatWindow messages={MESSAGES} isLoading={false} onEditMessage={onEditMessage} {...overrides} />
    </TooltipProvider>,
  );
  return { user, onEditMessage, ...view };
}

async function openEdit() {
  const rendered = renderChat();
  await rendered.user.click(screen.getByRole('button', { name: 'edit message' }));
  const box = screen.getByRole('textbox', { name: 'edit message' }) as HTMLTextAreaElement;
  return { ...rendered, box };
}

describe('ChatWindow edit & resend', () => {
  it('opens a focused box holding the message, with the caret after the text', async () => {
    const { box } = await openEdit();

    expect(box).toHaveValue(USER_TEXT);
    expect(box).toHaveFocus();
    expect(box.selectionStart).toBe(USER_TEXT.length);
    expect(box.selectionEnd).toBe(USER_TEXT.length);
    // The pencil steps aside while its message is being edited.
    expect(screen.queryByRole('button', { name: 'edit message' })).toBeNull();
  });

  it('types where the caret waits — after the text, not before it', async () => {
    const { user, box } = await openEdit();

    await user.keyboard(' now');
    expect(box).toHaveValue(`${USER_TEXT} now`);
  });

  it('sends the trimmed text on Enter and closes the box', async () => {
    const { user, box, onEditMessage } = await openEdit();

    await user.clear(box);
    await user.type(box, '  run hostname again  ');
    await user.keyboard('{Enter}');

    expect(onEditMessage).toHaveBeenCalledTimes(1);
    expect(onEditMessage).toHaveBeenCalledWith('u1', 'run hostname again');
    expect(screen.queryByRole('textbox', { name: 'edit message' })).toBeNull();
  });

  it('inserts a newline on Shift+Enter instead of sending', async () => {
    const { user, box, onEditMessage } = await openEdit();

    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(onEditMessage).not.toHaveBeenCalled();
    expect(box).toBeInTheDocument();
    expect(box).toHaveValue(`${USER_TEXT}\n`);
  });

  it('cancels on Escape without sending, and puts the message back', async () => {
    const { user, onEditMessage } = await openEdit();

    await user.keyboard('{Escape}');

    expect(onEditMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'edit message' })).toBeNull();
    expect(screen.getByText(USER_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'edit message' })).toBeInTheDocument();
  });

  it('cancels from the cancel button without sending', async () => {
    const { user, onEditMessage } = await openEdit();

    await user.click(screen.getByRole('button', { name: 'cancel' }));

    expect(onEditMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'edit message' })).toBeNull();
  });

  it('sends the trimmed text from the save & resend button', async () => {
    const { user, box, onEditMessage } = await openEdit();

    await user.type(box, '   ');
    await user.click(screen.getByRole('button', { name: 'save & resend' }));

    expect(onEditMessage).toHaveBeenCalledWith('u1', USER_TEXT);
  });

  it('will not send whitespace-only text, by button or by Enter', async () => {
    const { user, box, onEditMessage } = await openEdit();
    const save = screen.getByRole('button', { name: 'save & resend' });
    expect(save).toBeEnabled();

    await user.clear(box);
    await user.type(box, '   ');
    expect(save).toBeDisabled();

    await user.keyboard('{Enter}');
    expect(onEditMessage).not.toHaveBeenCalled();
    expect(box).toBeInTheDocument();

    await user.type(box, 'x');
    expect(save).toBeEnabled();
  });

  describe('the box height', () => {
    // A 24px line, 12px of padding above and below, a 3-row floor, and a 1px
    // border that offsetHeight counts and clientHeight does not.
    const LINE_PX = 24;
    const PAD_PX = 24;
    const BORDER_PX = 2;
    const heightFor = (lines: number) => `${Math.max(3, lines) * LINE_PX + PAD_PX + BORDER_PX}px`;

    // Runs on a measuring read taken with the box collapsed, which is when a
    // browser lays the conversation out one box-growth shorter.
    let onCollapsedMeasure: (() => void) | undefined;

    beforeEach(() => {
      Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
        configurable: true,
        get(this: HTMLTextAreaElement) {
          const content = Math.max(3, this.value.split('\n').length) * LINE_PX + PAD_PX;
          const height = parseFloat(this.style.height);
          if (Number.isNaN(height)) {
            onCollapsedMeasure?.();
            return content;
          }
          // A box already taller than its text measures its own inner height,
          // so one that is not collapsed first can never shrink.
          return Math.max(content, height - BORDER_PX);
        },
      });
      Object.defineProperty(HTMLTextAreaElement.prototype, 'offsetHeight', {
        configurable: true,
        get(this: HTMLTextAreaElement) {
          return this.clientHeight + BORDER_PX;
        },
      });
    });

    afterEach(() => {
      onCollapsedMeasure = undefined;
      Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'scrollHeight');
      Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'offsetHeight');
    });

    it('opens at its text height, borders included', async () => {
      const { box } = await openEdit();
      expect(box.style.height).toBe(heightFor(1));
    });

    it('grows with each new line and shrinks when they go', async () => {
      const { user, box } = await openEdit();

      await user.keyboard('{Shift>}{Enter}{Enter}{Enter}{Enter}{/Shift}');
      expect(box.style.height).toBe(heightFor(5));

      await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}');
      expect(box.style.height).toBe(heightFor(1));
    });

    it('leaves the conversation where it was while it measures', async () => {
      const { user, box } = await openEdit();
      // The chat's scroll container, resting at its bottom: the collapse
      // costs it two rows of travel for that layout.
      const scroller = box.closest('.overflow-y-auto') as HTMLElement;
      scroller.scrollTop = 600;
      onCollapsedMeasure = () => {
        scroller.scrollTop = Math.min(scroller.scrollTop, 600 - 2 * LINE_PX);
      };

      await user.keyboard('x');

      expect(scroller.scrollTop).toBe(600);
    });
  });

  describe('the pencil', () => {
    it('is offered on user messages only', () => {
      renderChat();
      expect(screen.getAllByRole('button', { name: 'edit message' })).toHaveLength(1);
    });

    it('is hidden while a response streams', () => {
      renderChat({ isLoading: true });
      expect(screen.queryByRole('button', { name: 'edit message' })).toBeNull();
    });

    it('is hidden when the view cannot edit', () => {
      renderChat({ onEditMessage: undefined });
      expect(screen.queryByRole('button', { name: 'edit message' })).toBeNull();
    });
  });
});
