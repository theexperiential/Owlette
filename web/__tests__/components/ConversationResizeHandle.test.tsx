/// <reference types="@testing-library/jest-dom" />
/**
 * @jest-environment jsdom
 *
 * `ConversationResizeHandle` — the drag handle on the right edge of the hoot
 * conversation list.
 *
 * Two properties carry the feature. First, the bounds hold on every path into
 * the component (drag, arrows, Home/End, double-click reset), because the
 * caller renders whatever comes out of `onResize` immediately. Second, the split
 * between the channels: `onResize` fires as often as the interaction demands,
 * `onCommit` exactly once when it ends — that is what keeps a drag from writing
 * to Firestore on every pointermove.
 *
 * The keyboard surface is also the a11y contract: /hoot runs an axe gate, and a
 * focusable separator without aria-valuenow is a critical `aria-required-attr`
 * violation there.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { ConversationResizeHandle } from '@/app/hoot/components/ConversationResizeHandle';

const MIN = 200;
const MAX = 560;
const STEP = 16;
const DEFAULT = 300;

// jsdom ships no PointerEvent, so fireEvent.pointerDown would fall back to a
// bare Event and silently drop clientX / pointerId — the two fields a drag is
// made of. A MouseEvent subclass carries both.
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}
window.PointerEvent = TestPointerEvent as unknown as typeof window.PointerEvent;
window.HTMLElement.prototype.setPointerCapture = jest.fn();

function renderHandle(width = DEFAULT) {
  const onResize = jest.fn();
  const onCommit = jest.fn();
  render(
    <ConversationResizeHandle
      width={width}
      min={MIN}
      max={MAX}
      step={STEP}
      defaultWidth={DEFAULT}
      onResize={onResize}
      onCommit={onCommit}
    />,
  );
  const handle = screen.getByRole('separator', { name: 'resize conversation list' });
  return { handle, onResize, onCommit };
}

/** Every width `onResize` was handed, in order. */
const resizedTo = (onResize: jest.Mock) => onResize.mock.calls.map(([width]) => width);

describe('ConversationResizeHandle — accessibility', () => {
  it('is a focusable vertical separator carrying its current value and bounds', () => {
    const { handle } = renderHandle(320);

    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('aria-valuenow', '320');
    expect(handle).toHaveAttribute('aria-valuemin', String(MIN));
    expect(handle).toHaveAttribute('aria-valuemax', String(MAX));
    expect(handle).toHaveAttribute('tabindex', '0');
  });

  it('reports the in-flight width, not the last committed one', () => {
    // `width` is the committed pref and does not move until the interaction
    // ends, so reading it alone would leave a screen reader hearing nothing
    // through a run of arrow presses.
    const { handle } = renderHandle(300);

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '316');

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '332');
  });

  it('swallows the arrow keypress so the conversation list does not scroll', () => {
    const { handle } = renderHandle();
    // fireEvent returns false when the handler called preventDefault.
    expect(fireEvent.keyDown(handle, { key: 'ArrowRight' })).toBe(false);
  });

  it('leaves keys it does not own alone', () => {
    const { handle, onResize, onCommit } = renderHandle();

    expect(fireEvent.keyDown(handle, { key: 'Tab' })).toBe(true);
    fireEvent.keyUp(handle, { key: 'Tab' });

    expect(onResize).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('ConversationResizeHandle — keyboard', () => {
  it('nudges by one step per arrow press, left narrowing and right widening', () => {
    const { handle, onResize } = renderHandle(300);

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });

    expect(resizedTo(onResize)).toEqual([316, 300]);
  });

  it('takes a bigger bite with Shift held', () => {
    const { handle, onResize } = renderHandle(300);

    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });

    expect(resizedTo(onResize)).toEqual([380]);
  });

  it('accumulates repeats without waiting for the parent to re-render', () => {
    // A held arrow key auto-repeats faster than React re-renders, so the next
    // keydown must build on the last value emitted, not on the stale prop.
    const { handle, onResize } = renderHandle(300);

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    expect(resizedTo(onResize)).toEqual([316, 332, 348]);
  });

  it('commits once when the key comes up, not once per step', () => {
    const { handle, onResize, onCommit } = renderHandle(300);

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.keyUp(handle, { key: 'ArrowRight' });

    expect(onResize).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(332);
  });

  it('clamps at the minimum instead of walking past it', () => {
    const { handle, onResize, onCommit } = renderHandle(MIN + 4);

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.keyUp(handle, { key: 'ArrowLeft' });

    expect(resizedTo(onResize)).toEqual([MIN, MIN]);
    expect(onCommit).toHaveBeenCalledWith(MIN);
  });

  it('clamps at the maximum instead of walking past it', () => {
    const { handle, onResize, onCommit } = renderHandle(MAX - 4);

    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyUp(handle, { key: 'ArrowRight' });

    expect(resizedTo(onResize)).toEqual([MAX]);
    expect(onCommit).toHaveBeenCalledWith(MAX);
  });

  it('commits when focus leaves mid-keypress, which never delivers the keyup', () => {
    // Clicking into the chat while an arrow is held sends the keyup to the new
    // focus target. Without this the width is lost and the caller sits in its
    // resizing state — with the collapse animation off — for the rest of the
    // session.
    const { handle, onCommit } = renderHandle(300);

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.blur(handle);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(316);
  });

  it('does not commit again when the keyup arrives after a blur', () => {
    const { handle, onCommit } = renderHandle(300);

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.blur(handle);
    fireEvent.keyUp(handle, { key: 'ArrowRight' });

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('spends nothing on a blur with no interaction behind it', () => {
    const { handle, onCommit } = renderHandle(300);

    fireEvent.blur(handle);

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('jumps to the bounds with Home and End', () => {
    const { handle, onResize, onCommit } = renderHandle(320);

    fireEvent.keyDown(handle, { key: 'Home' });
    fireEvent.keyUp(handle, { key: 'Home' });
    fireEvent.keyDown(handle, { key: 'End' });
    fireEvent.keyUp(handle, { key: 'End' });

    expect(resizedTo(onResize)).toEqual([MIN, MAX]);
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenLastCalledWith(MAX);
  });
});

describe('ConversationResizeHandle — pointer drag', () => {
  it('tracks the pointer and commits the final width once', () => {
    const { handle, onResize, onCommit } = renderHandle(300);

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 440 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 460 });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 460 });

    expect(resizedTo(onResize)).toEqual([340, 360]);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(360);
  });

  it('captures the pointer so the drag survives leaving the handle', () => {
    const { handle } = renderHandle();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientX: 400 });
    expect(window.HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(7);
  });

  it('clamps a drag that overshoots either bound', () => {
    const { handle, onResize } = renderHandle(300);

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 4000 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 0 });

    expect(resizedTo(onResize)).toEqual([MAX, MIN]);
  });

  it('suppresses text selection for the duration of the drag', () => {
    const { handle } = renderHandle();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 400 });
    expect(document.body.style.userSelect).toBe('none');

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 400 });
    expect(document.body.style.userSelect).toBe('');
  });

  it('ignores a non-primary button, which never delivers a pointerup', () => {
    const { handle, onResize, onCommit } = renderHandle(300);

    fireEvent.pointerDown(handle, { button: 2, pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 460 });

    expect(onResize).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not spend a write on a click that moved nothing', () => {
    const { handle, onResize, onCommit } = renderHandle(300);

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 400 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 400 });

    expect(onResize).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('ends the drag and commits when the pointer is cancelled', () => {
    const { handle, onCommit } = renderHandle(300);

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 440 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(340);
    expect(document.body.style.userSelect).toBe('');
  });
});

describe('ConversationResizeHandle — double-click reset', () => {
  it('restores the default width and persists it in one go', () => {
    const { handle, onResize, onCommit } = renderHandle(480);

    fireEvent.doubleClick(handle);

    expect(resizedTo(onResize)).toEqual([DEFAULT]);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(DEFAULT);
  });
});
