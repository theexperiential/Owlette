'use client';

/**
 * Per-device persistence for the Hoot sidebar's `sidebarOpen`,
 * `collapsedGroups` and `sidebarWidth`, stored on the shared per-device prefs
 * doc (`users/{uid}/devicePrefs/global`) as `cortexSidebarOpen` /
 * `cortexCollapsedGroups` / `cortexSidebarWidth`.
 *
 * Hydrated once on mount; after that local state is the source of truth and
 * writes are debounced. The setters take a value or an updater, so they drop
 * straight in for `useState`.
 *
 * A pref the user has already set this session is NOT overwritten by the
 * hydrating read: that read is issued at mount and can land mid-interaction,
 * where applying its stale value would visibly undo a drag whose own write is
 * still sitting in the debounce window.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';

const DEBOUNCE_MS = 400;

/** Below this the conversation rows stop being readable. */
export const HOOT_SIDEBAR_MIN_WIDTH = 200;
export const HOOT_SIDEBAR_MAX_WIDTH = 560;
/**
 * Starting width, and the double-click reset. Wider than the column's
 * long-standing `w-64` (256px): at that width a generated conversation title —
 * six words, by the categorize prompt — truncated within the first two or three.
 */
export const HOOT_SIDEBAR_DEFAULT_WIDTH = 300;

/**
 * Total by design: a stale doc, a hand-edited value or a NaN must never render
 * an unusable column, so anything that isn't a finite number becomes the
 * default and everything else is clamped into the bounds.
 */
function clampWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return HOOT_SIDEBAR_DEFAULT_WIDTH;
  return Math.min(HOOT_SIDEBAR_MAX_WIDTH, Math.max(HOOT_SIDEBAR_MIN_WIDTH, Math.round(value)));
}

type SetState<T> = (value: T | ((prev: T) => T)) => void;

export interface HootSidebarPrefs {
  sidebarOpen: boolean;
  setSidebarOpen: SetState<boolean>;
  collapsedGroups: Set<string>;
  setCollapsedGroups: SetState<Set<string>>;
  /** Desktop conversation-list width in px, always within the bounds above. */
  sidebarWidth: number;
  setSidebarWidth: SetState<number>;
  /**
   * The stored prefs have been applied, or there were none to apply. The caller
   * uses it to hold the column's width transition off until then — hydration
   * corrects the width a few hundred ms in, and animating that correction plays
   * as a slide on every visit.
   */
  hydrated: boolean;
}

export function useHootSidebarPrefs(): HootSidebarPrefs {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [sidebarOpen, setSidebarOpenState] = useState(true);
  const [collapsedGroups, setCollapsedGroupsState] = useState<Set<string>>(new Set());
  // Starts at the default so the server and client markup agree; hydration
  // corrects it on mount.
  const [sidebarWidth, setSidebarWidthState] = useState(HOOT_SIDEBAR_DEFAULT_WIDTH);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  // No user and no db means no read is coming, so there is nothing left to wait
  // for — the caller must not sit on a permanently pre-hydration layout.
  const hydrated = prefsLoaded || !db || !uid;

  // Let the setters read current state without being re-created. Updated in
  // effects — writing refs during render is disallowed.
  const sidebarOpenRef = useRef(sidebarOpen);
  const collapsedRef = useRef(collapsedGroups);
  const widthRef = useRef(sidebarWidth);
  const uidRef = useRef<string | null>(uid);
  useEffect(() => { sidebarOpenRef.current = sidebarOpen; }, [sidebarOpen]);
  useEffect(() => { collapsedRef.current = collapsedGroups; }, [collapsedGroups]);
  useEffect(() => { widthRef.current = sidebarWidth; }, [sidebarWidth]);
  useEffect(() => { uidRef.current = uid; }, [uid]);

  const pendingRef = useRef<Record<string, unknown>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Doc keys the user has set this session — hydration leaves these alone.
  const touchedRef = useRef(new Set<string>());

  const flush = useCallback(() => {
    const currentUid = uidRef.current;
    const updates = pendingRef.current;
    pendingRef.current = {};
    if (!db || !currentUid || Object.keys(updates).length === 0) return;
    setDoc(doc(db, 'users', currentUid, 'devicePrefs', 'global'), updates, { merge: true }).catch(
      (err) => console.error('Failed to persist hoot sidebar prefs:', err),
    );
  }, []);

  const schedulePersist = useCallback(
    (patch: Record<string, unknown>) => {
      if (!db || !uidRef.current) return;
      Object.assign(pendingRef.current, patch);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flush();
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  // Hydrate once. setState sits in the async callback, not the effect body, to
  // stay clear of the cascading-render lint rule.
  useEffect(() => {
    if (!db || !uid) return;
    let cancelled = false;
    getDoc(doc(db, 'users', uid, 'devicePrefs', 'global'))
      .then((snap) => {
        if (cancelled) return;
        const touched = touchedRef.current;
        if (snap.exists()) {
          const data = snap.data() as {
            cortexSidebarOpen?: unknown;
            cortexCollapsedGroups?: unknown;
            cortexSidebarWidth?: unknown;
          };
          if (!touched.has('cortexSidebarOpen') && typeof data.cortexSidebarOpen === 'boolean') {
            setSidebarOpenState(data.cortexSidebarOpen);
          }
          if (!touched.has('cortexCollapsedGroups') && Array.isArray(data.cortexCollapsedGroups)) {
            setCollapsedGroupsState(new Set(data.cortexCollapsedGroups as string[]));
          }
          // Presence, not type, gates this one: a stored value of the wrong type
          // still means "a width was saved", and clampWidth answers the default.
          if (!touched.has('cortexSidebarWidth') && data.cortexSidebarWidth !== undefined) {
            setSidebarWidthState(clampWidth(data.cortexSidebarWidth));
          }
        }
        setPrefsLoaded(true);
      })
      .catch((err) => {
        console.error('Failed to read hoot sidebar prefs:', err);
        // A failed read still ends the wait — local state is all there is.
        if (!cancelled) setPrefsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // Flush any pending write on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        flush();
      }
    };
  }, [flush]);

  const setSidebarOpen = useCallback<SetState<boolean>>(
    (value) => {
      const next = typeof value === 'function'
        ? (value as (p: boolean) => boolean)(sidebarOpenRef.current)
        : value;
      sidebarOpenRef.current = next;
      touchedRef.current.add('cortexSidebarOpen');
      setSidebarOpenState(next);
      schedulePersist({ cortexSidebarOpen: next });
    },
    [schedulePersist],
  );

  const setCollapsedGroups = useCallback<SetState<Set<string>>>(
    (value) => {
      const next = typeof value === 'function'
        ? (value as (p: Set<string>) => Set<string>)(collapsedRef.current)
        : value;
      collapsedRef.current = next;
      touchedRef.current.add('cortexCollapsedGroups');
      setCollapsedGroupsState(next);
      schedulePersist({ cortexCollapsedGroups: Array.from(next) });
    },
    [schedulePersist],
  );

  const setSidebarWidth = useCallback<SetState<number>>(
    (value) => {
      const raw = typeof value === 'function'
        ? (value as (p: number) => number)(widthRef.current)
        : value;
      // Clamped here as well as in the drag handle: the bounds have to hold for
      // every caller, not only the one that owns the pointer.
      const next = clampWidth(raw);
      widthRef.current = next;
      touchedRef.current.add('cortexSidebarWidth');
      setSidebarWidthState(next);
      schedulePersist({ cortexSidebarWidth: next });
    },
    [schedulePersist],
  );

  return {
    sidebarOpen,
    setSidebarOpen,
    collapsedGroups,
    setCollapsedGroups,
    sidebarWidth,
    setSidebarWidth,
    hydrated,
  };
}
