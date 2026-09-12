/**
 * @jest-environment jsdom
 *
 * Regression tests for the hoot kill switch in `useMachines`.
 *
 * `Machine.cortexEnabled` was declared but never parsed out of the machine doc,
 * so it was always undefined. `HootPowerToggle` reads `cortexEnabled !== false`,
 * which meant the toggle always rendered "hoot active" and could never turn hoot
 * back ON for a machine whose doc had `cortexEnabled: false`.
 *
 * Absent must map to true, matching the server default in `isHootEnabled`
 * (`lib/hoot-utils.server.ts`).
 */
import { renderHook, act, waitFor } from '@testing-library/react';

// Override jest.setup.js's `{ db: null }` — the hook early-returns on null db
// and would skip the snapshot effect.
jest.mock('@/lib/firebase', () => ({ db: {} }));

type SnapshotDoc = { id: string; data: () => Record<string, unknown> };
type CollectionListener = (snap: {
  metadata: { fromCache: boolean };
  forEach: (cb: (doc: SnapshotDoc) => void) => void;
}) => void;

// Hook listeners keyed by slash-joined path: `sites/<id>/machines` is status,
// `config/<id>/machines` is the launch-mode/restart-schedule override.
const collectionListeners = new Map<string, CollectionListener>();
const unsubscribe = jest.fn();

jest.mock('firebase/firestore', () => ({
  Timestamp: class {},
  collection: jest.fn((_db: unknown, ...path: string[]) => ({
    __kind: 'collection' as const,
    __path: path.join('/'),
  })),
  doc: jest.fn((_db: unknown, ...path: string[]) => ({
    __kind: 'doc' as const,
    __path: path.join('/'),
  })),
  getDoc: jest.fn(async () => ({ exists: () => false })),
  onSnapshot: jest.fn((ref: { __kind: string; __path: string }, onNext: CollectionListener) => {
    // Register per-machine profile doc listeners so teardown works, but never
    // emit — these fixtures have no profile.
    if (ref.__kind === 'collection') collectionListeners.set(ref.__path, onNext);
    return unsubscribe;
  }),
}));

import { useMachines } from '@/hooks/useFirestore';

const SITE_ID = 'site1';
const NOW_MS = 1_760_000_000_000;
const NOW_SEC = Math.floor(NOW_MS / 1000);

/** Emit a machines-collection snapshot for the site under test. */
function emitMachines(docs: SnapshotDoc[]) {
  const listener = collectionListeners.get(`sites/${SITE_ID}/machines`);
  if (!listener) throw new Error('machines listener not registered');
  listener({
    metadata: { fromCache: false },
    forEach: (cb) => docs.forEach(cb),
  });
}

/** Online fixture — the kill switch is independent of heartbeat staleness. */
const machineDoc = (id: string, data: Record<string, unknown>): SnapshotDoc => ({
  id,
  data: () => ({ online: true, lastHeartbeat: NOW_SEC - 5, ...data }),
});

beforeEach(() => {
  collectionListeners.clear();
  unsubscribe.mockClear();
  jest.useFakeTimers();
  jest.setSystemTime(NOW_MS);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useMachines — cortexEnabled kill switch', () => {
  it('maps cortexEnabled:false to false, so the toggle can turn hoot back on', async () => {
    const { result } = renderHook(() => useMachines(SITE_ID));

    act(() => {
      emitMachines([machineDoc('kiosk-01', { cortexEnabled: false })]);
    });

    await waitFor(() => expect(result.current.machines).toHaveLength(1));
    expect(result.current.machines[0].cortexEnabled).toBe(false);
  });

  it('maps an absent cortexEnabled to true, matching the server default', async () => {
    const { result } = renderHook(() => useMachines(SITE_ID));

    act(() => {
      emitMachines([machineDoc('kiosk-01', {})]);
    });

    await waitFor(() => expect(result.current.machines).toHaveLength(1));
    expect(result.current.machines[0].cortexEnabled).toBe(true);
  });

  it('maps cortexEnabled:true to true', async () => {
    const { result } = renderHook(() => useMachines(SITE_ID));

    act(() => {
      emitMachines([machineDoc('kiosk-01', { cortexEnabled: true })]);
    });

    await waitFor(() => expect(result.current.machines).toHaveLength(1));
    expect(result.current.machines[0].cortexEnabled).toBe(true);
  });

  it('keeps machines independent and follows a later snapshot both ways', async () => {
    const { result } = renderHook(() => useMachines(SITE_ID));

    act(() => {
      emitMachines([
        machineDoc('kiosk-01', { cortexEnabled: false }),
        machineDoc('kiosk-02', {}),
      ]);
    });

    await waitFor(() => expect(result.current.machines).toHaveLength(2));
    expect(result.current.machines.map((m) => m.cortexEnabled)).toEqual([false, true]);

    // Re-enabling on the machine doc must reach the UI — the toggle reads this.
    act(() => {
      emitMachines([
        machineDoc('kiosk-01', { cortexEnabled: true }),
        machineDoc('kiosk-02', { cortexEnabled: false }),
      ]);
    });

    await waitFor(() =>
      expect(result.current.machines.map((m) => m.cortexEnabled)).toEqual([true, false]),
    );
  });
});
