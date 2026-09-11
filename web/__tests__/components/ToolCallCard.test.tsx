/// <reference types="@testing-library/jest-dom" />
/**
 * @jest-environment jsdom
 *
 * ToolCallCard — the inline card for one hoot tool call. Its expand toggle is a
 * Radix Collapsible trigger, so the input/output panel slides open and shut in
 * every state and tier. What is on trial here is the toggle contract: it says
 * whether it is open (aria-expanded + data-state), a collapsed card keeps the
 * payload out of the DOM, and nothing the card already did — approve/deny, the
 * cancel button beside the toggle, the screenshot — moved behind the collapse.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToolCallCard } from '@/app/hoot/components/ToolCallCard';

type CardProps = React.ComponentProps<typeof ToolCallCard>;

const INPUT_MARKER = 'C:/shows/lobby-wall.toe';

function renderCard(props: CardProps) {
  const user = userEvent.setup();
  // The input/output headers carry CopyButtons, whose tooltips need the
  // provider the app mounts once at the layout level.
  const view = render(
    <TooltipProvider>
      <ToolCallCard {...props} />
    </TooltipProvider>,
  );
  return { user, ...view };
}

/** The expand toggle — the only control whose name carries the tool name. */
function toggleFor(toolName: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(toolName) });
}

/** The panel the toggle controls, found the way assistive tech finds it. */
function panelOf(toggle: HTMLElement): HTMLElement {
  const id = toggle.getAttribute('aria-controls');
  if (!id) throw new Error('toggle has no aria-controls');
  const panel = document.getElementById(id);
  if (!panel) throw new Error(`no element with id ${id}`);
  return panel;
}

function expectCollapsed(toggle: HTMLElement) {
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).toHaveAttribute('data-state', 'closed');
  expect(screen.queryByText('input')).toBeNull();
  expect(screen.queryByText(new RegExp(INPUT_MARKER))).toBeNull();
}

const STATES: [string, CardProps][] = [
  [
    'a running tier-2 call',
    { toolName: 'restart_process', args: { path: INPUT_MARKER }, isLoading: true },
  ],
  [
    'a completed tier-1 call',
    {
      toolName: 'get_system_info',
      args: { path: INPUT_MARKER },
      result: { hostname: 'STUDIO-01', os: 'Windows 11 Pro' },
    },
  ],
  [
    'a failed call',
    { toolName: 'get_system_info', args: { path: INPUT_MARKER }, result: { error: 'agent timed out' } },
  ],
  [
    'a denied tier-3 call',
    { toolName: 'run_powershell', args: { path: INPUT_MARKER }, approvalState: 'denied' },
  ],
  [
    'a tier-3 call awaiting approval',
    {
      toolName: 'run_powershell',
      args: { path: INPUT_MARKER },
      approvalState: 'requested',
      onApprove: () => {},
      onDeny: () => {},
    },
  ],
];

describe('ToolCallCard', () => {
  describe.each(STATES)('%s', (_label, props) => {
    it('starts collapsed, with the payload out of the DOM', () => {
      renderCard(props);
      expectCollapsed(toggleFor(props.toolName));
    });

    it('opens and closes from the toggle, mounting the input only while open', async () => {
      const { user } = renderCard(props);
      const toggle = toggleFor(props.toolName);

      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(toggle).toHaveAttribute('data-state', 'open');
      const panel = panelOf(toggle);
      expect(within(panel).getByText('input')).toBeInTheDocument();
      expect(panel).toHaveTextContent(INPUT_MARKER);

      await user.click(toggle);
      expectCollapsed(toggle);
    });
  });

  it('shows the output of a completed call only while open', async () => {
    const { user } = renderCard({
      toolName: 'get_system_info',
      args: {},
      result: { hostname: 'STUDIO-01' },
    });
    const toggle = toggleFor('get_system_info');
    // The tier chip rides inside the toggle.
    expect(toggle).toHaveTextContent('Tier 1');
    expect(screen.queryByText('output')).toBeNull();

    await user.click(toggle);
    const panel = panelOf(toggle);
    expect(within(panel).getByText('output')).toBeInTheDocument();
    expect(panel).toHaveTextContent('"hostname": "STUDIO-01"');
    // No args, no input block.
    expect(within(panel).queryByText('input')).toBeNull();

    await user.click(toggle);
    expect(screen.queryByText('output')).toBeNull();
    expect(screen.queryByText(/STUDIO-01/)).toBeNull();
  });

  it("shows a failed call's error only while open", async () => {
    const { user } = renderCard({
      toolName: 'get_system_info',
      args: {},
      result: { error: 'agent timed out' },
    });
    const toggle = toggleFor('get_system_info');
    expect(screen.queryByText(/agent timed out/)).toBeNull();

    await user.click(toggle);
    expect(panelOf(toggle)).toHaveTextContent('"error": "agent timed out"');

    await user.click(toggle);
    expect(screen.queryByText(/agent timed out/)).toBeNull();
  });

  describe('a tier-3 call awaiting approval', () => {
    function renderAwaiting() {
      const onApprove = jest.fn();
      const onDeny = jest.fn();
      const view = renderCard({
        toolName: 'run_powershell',
        args: { command: 'hostname' },
        approvalState: 'requested',
        approvalTargetLabel: 'STUDIO-01',
        onApprove,
        onDeny,
      });
      return { onApprove, onDeny, ...view };
    }

    it('keeps the approval banner outside the collapse, open or shut', async () => {
      const { user } = renderAwaiting();
      const toggle = toggleFor('run_powershell');
      expect(toggle).toHaveTextContent('Tier 3');
      expect(toggle).toHaveTextContent('awaiting approval');
      expect(screen.getByText(/hoot wants to run the privileged/)).toHaveTextContent(
        'hoot wants to run the privileged run_powershell tool on STUDIO-01.',
      );
      expect(screen.getByRole('button', { name: 'approve' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'deny' })).toBeEnabled();

      await user.click(toggle);
      const panel = panelOf(toggle);
      expect(panel).toHaveTextContent('"command": "hostname"');
      expect(within(panel).queryByRole('button', { name: 'approve' })).toBeNull();
      expect(screen.getByText(/hoot wants to run the privileged/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'approve' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'deny' })).toBeEnabled();
    });

    it('approves once, then locks both buttons', async () => {
      const { user, onApprove, onDeny } = renderAwaiting();
      await user.click(toggleFor('run_powershell'));

      await user.click(screen.getByRole('button', { name: 'approve' }));
      expect(onApprove).toHaveBeenCalledTimes(1);
      expect(onDeny).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'approve' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'deny' })).toBeDisabled();
    });

    it('denies once, then locks both buttons', async () => {
      const { user, onApprove, onDeny } = renderAwaiting();

      await user.click(screen.getByRole('button', { name: 'deny' }));
      expect(onDeny).toHaveBeenCalledTimes(1);
      expect(onApprove).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'approve' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'deny' })).toBeDisabled();
    });
  });

  describe('the cancel button on a running call', () => {
    it('sits beside the toggle, never inside it, and cancels without toggling', async () => {
      const onCancel = jest.fn();
      const { user } = renderCard({
        toolName: 'restart_process',
        args: { path: INPUT_MARKER },
        isLoading: true,
        onCancel,
      });
      const toggle = toggleFor('restart_process');
      const cancel = screen.getByRole('button', { name: 'cancel' });

      // Nested interactive controls are an axe violation the hoot pages gate on.
      expect(toggle).not.toContainElement(cancel);
      expect(cancel.parentElement).toBe(toggle.parentElement);

      await user.click(cancel);
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('is disabled while a cancel is in flight', () => {
      renderCard({
        toolName: 'restart_process',
        args: {},
        isLoading: true,
        onCancel: () => {},
        cancelPending: true,
      });
      expect(screen.getByRole('button', { name: 'cancel' })).toBeDisabled();
    });
  });

  it('keeps the toggle as the first button of the card root the video script finds', () => {
    renderCard({
      toolName: 'restart_process',
      args: {},
      isLoading: true,
      onCancel: () => {},
    });
    const toggle = toggleFor('restart_process');
    // e2e/videos/12-cortex.video.ts locates the card by these classes and
    // clicks its first button to open it.
    const card = toggle.closest('div.rounded-lg.border.overflow-hidden');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getAllByRole('button')[0]).toBe(toggle);
  });

  it('shows a screenshot with the card collapsed, and leaves the base64 out of the output', async () => {
    const { user } = renderCard({
      toolName: 'capture_screenshot',
      args: {},
      result: { url: 'https://storage.example/shot.jpg', base64: 'QkFTRTY0QkxPQg==', width: 1920 },
    });
    const toggle = toggleFor('capture_screenshot');

    const image = screen.getByRole('img', { name: 'Screenshot' });
    expect(image).toHaveAttribute('src', 'https://storage.example/shot.jpg');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    const panel = panelOf(toggle);
    expect(panel).toHaveTextContent('"width": 1920');
    expect(panel).not.toHaveTextContent('QkFTRTY0QkxPQg==');
    expect(screen.getByRole('img', { name: 'Screenshot' })).toBe(image);
  });
});
