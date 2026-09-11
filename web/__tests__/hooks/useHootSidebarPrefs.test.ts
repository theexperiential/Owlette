/**
 * @jest-environment jsdom
 *
 * `useHootSidebarPrefs` — the per-device prefs behind the hoot conversation
 * sidebar: whether it is open, which category groups are collapsed, and (new)
 * how wide the column is.
 *
 * The width is the reason this file exists. It rides the SAME
 * `users/{uid}/devicePrefs/global` doc as the other two, under
 * `cortexSidebarWidth`, and the hook is the only thing standing between a
 * stored number and the layout — so the bounds are asserted on hydration and on
 * every set, including for a value no UI of ours could have written. The
 * open/collapsed cases are here too: they are the behaviour a width change is
 * most likely to break, and they are what "remember that I collapsed it" means.
 */

import { act, renderHook, waitFor } from '@testing-library/react';

// jest.setup mocks `db` to null, which would short-circuit both hydration and
// every write and leave nothing under test.
jest.mock('@/lib/firebase', () => ({ db: {} }));

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'user-1' } }),
}));

const mockSetDoc = jest.fn().mockResolvedValue(undefined);
let mockStored: Record<string, unknown> | null = null;
// Holds the hydrating read open, for the tests that need to act while it is
// still in flight — the window a real drag can easily land in.
let mockReadGate: Promise<void> | null = null;

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getDoc: async () => {
    if (mockReadGate) await mockReadGate;
    return {
      exists: () => mockStored !== null,
      data: () => mockStored,
    };
  },
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}));

import {
  useHootSidebarPrefs,
  HOOT_SIDEBAR_DEFAULT_WIDTH,
  HOOT_SIDEBAR_MAX_WIDTH,
  HOOT_SIDEBAR_MIN_WIDTH,
} from '@/hooks/useHootSidebarPrefs';

const PREFS_PATH = 'users/user-1/devicePrefs/global';
const DEBOUNCE_MS = 400;

/** Mount with `stored` already on the doc and let the hydrating read settle. */
async function mountHydrated(stored: Record<string, unknown> | null) {
  mockStored = stored;
  const view = renderHook(() => useHootSidebarPrefs());
  await act(async () => {});
  return view;
}

/** Mount with the hydrating read still in flight; `land()` lets it resolve. */
function mountMidRead(stored: Record<string, unknown> | null) {
  mockStored = stored;
  let release = () => {};
  mockReadGate = new Promise<void>((resolve) => { release = resolve; });
  const view = renderHook(() => useHootSidebarPrefs());
  return {
    ...view,
    land: async () => {
      release();
      await act(async () => {});
    },
  };
}

/** The single merge write the debounce timer produces. */
function lastWrite(): Record<string, unknown> {
  const call = mockSetDoc.mock.calls[mockSetDoc.mock.calls.length - 1];
  expect(call[0]).toBe(PREFS_PATH);
  expect(call[2]).toEqual({ merge: true });
  return call[1] as Record<string, unknown>;
}

beforeEach(() => {
  mockStored = null;
  mockReadGate = null;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useHootSidebarPrefs — width hydration', () => {
  it('renders the default before anything is read, so SSR and the client agree', async () => {
    mockStored = { cortexSidebarWidth: 420 };
    const { result } = renderHook(() => useHootSidebarPrefs());

    // Synchronous first render: the stored value has not landed yet.
    expect(result.current.sidebarWidth).toBe(HOOT_SIDEBAR_DEFAULT_WIDTH);

    // Let the in-flight read settle inside act, or it lands after the test ends.
    await act(async () => {});
    expect(result.current.sidebarWidth).toBe(420);
  });

  it('hydrates an in-range stored width', async () => {
    const { result } = await mountHydrated({ cortexSidebarWidth: 420 });
    expect(result.current.sidebarWidth).toBe(420);
  });

  it('clamps a stored width above the maximum', async () => {
    const { result } = await mountHydrated({ cortexSidebarWidth: 5000 });
    expect(result.current.sidebarWidth).toBe(HOOT_SIDEBAR_MAX_WIDTH);
  });

  it('clamps a stored width below the minimum', async () => {
    const { result } = await mountHydrated({ cortexSidebarWidth: 12 });
    expect(result.current.sidebarWidth).toBe(HOOT_SIDEBAR_MIN_WIDTH);
  });

  it('falls back to the default for a non-numeric stored width', async () => {
    const { result } = await mountHydrated({ cortexSidebarWidth: '420' });
    expect(result.current.sidebarWidth).toBe(HOOT_SIDEBAR_DEFAULT_WIDTH);
  });

  it('falls back to the default for a NaN stored width', async () => {
    const { result } = await mountHydrated({ cortexSidebarWidth: Number.NaN });
    expect(result.current.sidebarWidth).toBe(HOOT_SIDEBAR_DEFAULT_WIDTH);
  });

  it('falls back to the default when the key is absent from an existing doc', async () => {
    const { result } = await mountHydrated({ cortexSidebarOpen: false });
    expect(result.current.sidebarWidth).toBe(HOOT_SIDEBAR_DEFAULT_WIDTH);
  });

  it('falls back to the default when the prefs doc does not exist', async () => {
    const { result } = await mountHydrated(null);
    expect(result.current.sidebarWidth).toBe(HOOT_SIDEBAR_DEFAULT_WIDTH);
  });

  it('writes nothing while hydrating', async () => {
    await mountHydrated({ cortexSidebarWidth: 420 });
    await act(async () => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});

describe('useHootSidebarPrefs — width writes', () => {
  it('persists under cortexSidebarWidth, debounced', async () => {
    const { result } = await mountHydrated(null);

    act(() => {
      result.current.setSidebarWidth(320);
    });
    // Local state leads; the write is still in the debounce window.
    expect(result.current.sidebarWidth).toBe(320);
    expect(mockSetDoc).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(lastWrite()).toEqual({ cortexSidebarWidth: 320 });
  });

  it('coalesces a burst of sets into one write carrying the last value', async () => {
    const { result } = await mountHydrated(null);

    act(() => {
      result.current.setSidebarWidth(300);
      result.current.setSidebarWidth(340);
      result.current.setSidebarWidth(380);
    });
    await act(async () => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(lastWrite()).toEqual({ cortexSidebarWidth: 380 });
  });

  it('clamps on set, so no caller can store an unusable width', async () => {
    const { result } = await mountHydrated(null);

    act(() => {
      result.current.setSidebarWidth(9999);
    });
    expect(result.current.sidebarWidth).toBe(HOOT_SIDEBAR_MAX_WIDTH);

    act(() => {
      result.current.setSidebarWidth(-40);
    });
    expect(result.current.sidebarWidth).toBe(HOOT_SIDEBAR_MIN_WIDTH);

    await act(async () => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(lastWrite()).toEqual({ cortexSidebarWidth: HOOT_SIDEBAR_MIN_WIDTH });
  });

  it('rounds a fractional width — a pointer can land on a half pixel', async () => {
    const { result } = await mountHydrated(null);

    act(() => {
      result.current.setSidebarWidth(320.6);
    });
    expect(result.current.sidebarWidth).toBe(321);
  });

  it('takes an updater, like the other setters on this hook', async () => {
    const { result } = await mountHydrated({ cortexSidebarWidth: 300 });

    act(() => {
      result.current.setSidebarWidth((prev) => prev + 16);
    });
    expect(result.current.sidebarWidth).toBe(316);
  });

  it('flushes a pending width on unmount', async () => {
    const { result, unmount } = await mountHydrated(null);

    act(() => {
      result.current.setSidebarWidth(288);
    });
    unmount();

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(lastWrite()).toEqual({ cortexSidebarWidth: 288 });
  });
});

describe('useHootSidebarPrefs — collapsed and grouped state still round-trip', () => {
  it('defaults to an open sidebar and no collapsed groups', async () => {
    const { result } = await mountHydrated(null);
    expect(result.current.sidebarOpen).toBe(true);
    expect(result.current.collapsedGroups).toEqual(new Set());
  });

  it('hydrates a collapsed sidebar from cortexSidebarOpen', async () => {
    const { result } = await mountHydrated({ cortexSidebarOpen: false });
    expect(result.current.sidebarOpen).toBe(false);
  });

  it('persists a collapse under cortexSidebarOpen', async () => {
    const { result } = await mountHydrated({ cortexSidebarOpen: true });

    act(() => {
      result.current.setSidebarOpen(false);
    });
    expect(result.current.sidebarOpen).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(lastWrite()).toEqual({ cortexSidebarOpen: false });
  });

  it('hydrates and persists collapsed category groups as an array', async () => {
    const { result } = await mountHydrated({ cortexCollapsedGroups: ['General'] });
    expect(result.current.collapsedGroups).toEqual(new Set(['General']));

    act(() => {
      result.current.setCollapsedGroups((prev) => new Set([...prev, 'Deployment']));
    });
    await act(async () => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(lastWrite()).toEqual({ cortexCollapsedGroups: ['General', 'Deployment'] });
  });

  it('merges a width change and a collapse into the same single write', async () => {
    const { result } = await mountHydrated(null);

    act(() => {
      result.current.setSidebarWidth(360);
      result.current.setSidebarOpen(false);
    });
    await act(async () => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(lastWrite()).toEqual({ cortexSidebarWidth: 360, cortexSidebarOpen: false });
  });

  it('leaves a collapse made before the read landed alone', async () => {
    const view = mountMidRead({ cortexSidebarOpen: true });

    act(() => {
      view.result.current.setSidebarOpen(false);
    });
    await view.land();

    expect(view.result.current.sidebarOpen).toBe(false);
  });

  it('hydrates all three keys together', async () => {
    const { result } = await mountHydrated({
      cortexSidebarOpen: false,
      cortexCollapsedGroups: ['General', 'Deployment'],
      cortexSidebarWidth: 512,
    });

    await waitFor(() => expect(result.current.sidebarWidth).toBe(512));
    expect(result.current.sidebarOpen).toBe(false);
    expect(result.current.collapsedGroups).toEqual(new Set(['General', 'Deployment']));
  });
});

describe('useHootSidebarPrefs — a read that lands mid-interaction', () => {
  // The getDoc is issued at mount and can resolve a drag or two later. Applying
  // it then would snap the column back on screen while the dragged width is
  // still on its way to Firestore — the two would disagree until the next load.
  it('keeps a width set while the read was in flight', async () => {
    const view = mountMidRead({ cortexSidebarWidth: 300 });

    act(() => {
      view.result.current.setSidebarWidth(400);
    });
    await view.land();

    expect(view.result.current.sidebarWidth).toBe(400);
  });

  it('still writes that width, so screen and doc agree', async () => {
    const view = mountMidRead({ cortexSidebarWidth: 300 });

    act(() => {
      view.result.current.setSidebarWidth(400);
    });
    await view.land();
    await act(async () => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(lastWrite()).toEqual({ cortexSidebarWidth: 400 });
  });

  it('still hydrates the keys the user has not touched', async () => {
    const view = mountMidRead({ cortexSidebarWidth: 300, cortexSidebarOpen: false });

    act(() => {
      view.result.current.setSidebarWidth(400);
    });
    await view.land();

    expect(view.result.current.sidebarWidth).toBe(400);
    expect(view.result.current.sidebarOpen).toBe(false);
  });
});

describe('useHootSidebarPrefs — hydrated', () => {
  // The caller holds the column's width transition off until this flips, so the
  // correction the read makes doesn't play as a slide on every visit.
  it('is false until the read lands', async () => {
    const view = mountMidRead({ cortexSidebarWidth: 300 });

    expect(view.result.current.hydrated).toBe(false);
    await view.land();
    expect(view.result.current.hydrated).toBe(true);
  });

  it('is true once a missing doc comes back, with nothing left to wait for', async () => {
    const { result } = await mountHydrated(null);
    expect(result.current.hydrated).toBe(true);
  });
});
