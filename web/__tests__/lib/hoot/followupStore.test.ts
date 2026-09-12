/** @jest-environment node */

/**
 * Unit tests for `web/lib/hoot/followupStore.server.ts`.
 *
 * Pins the three contracts Task 4.2 (tools) and 4.3 (UI) build on: what
 * `scheduleFollowup` writes, that `cancelFollowup` is owner-gated AND loses
 * cleanly to a sweep that already claimed the doc, and the query
 * `listChatFollowups` issues (the shape the composite index is cut for).
 *
 * Plus the two readers the sweep fires through: the target a doc was scheduled
 * against, and whether it has a single command an early fire may watch.
 */

import type { Firestore } from 'firebase-admin/firestore';

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__SERVER_TS__' },
  // `@/lib/firestoreTime.server` does `value instanceof Timestamp`, so the
  // binding must exist even though the fixtures use Dates.
  Timestamp: class Timestamp {},
}));

import {
  FOLLOWUPS_COLLECTION,
  cancelFollowup,
  listChatFollowups,
  scheduleFollowup,
  scheduledTarget,
  watchedMachineId,
  type FollowupDoc,
} from '@/lib/hoot/followupStore.server';

/** Follow-up docs by id; transactions read and write through this map. */
const followups = new Map<string, Record<string, unknown>>();

const added = jest.fn();
const where = jest.fn();
const orderBy = jest.fn();
const limit = jest.fn();

let listResult: string[] = [];
let nextId = 1;

function docRef(id: string) {
  return {
    id,
    update: jest.fn(async (patch: Record<string, unknown>) => {
      followups.set(id, { ...(followups.get(id) ?? {}), ...patch });
    }),
  };
}

const query = {
  where: jest.fn((...args: unknown[]) => {
    where(...args);
    return query;
  }),
  orderBy: jest.fn((...args: unknown[]) => {
    orderBy(...args);
    return query;
  }),
  limit: jest.fn((...args: unknown[]) => {
    limit(...args);
    return query;
  }),
  get: jest.fn(async () => ({
    docs: listResult.map((id) => ({ id, data: () => followups.get(id) })),
  })),
};

const transaction = {
  get: jest.fn(async (ref: { id: string }) => ({
    exists: followups.has(ref.id),
    data: () => followups.get(ref.id),
  })),
  update: jest.fn((ref: { id: string }, patch: Record<string, unknown>) => {
    followups.set(ref.id, { ...(followups.get(ref.id) ?? {}), ...patch });
  }),
};

const db = {
  collection: jest.fn((name: string) => {
    if (name !== FOLLOWUPS_COLLECTION) throw new Error(`unexpected collection: ${name}`);
    return {
      ...query,
      doc: jest.fn((id: string) => docRef(id)),
      add: jest.fn(async (data: Record<string, unknown>) => {
        const id = `fu-${nextId++}`;
        added(data);
        followups.set(id, { ...data });
        return docRef(id);
      }),
    };
  }),
  runTransaction: jest.fn(
    async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
  ),
} as unknown as Firestore;

function scheduled(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chatId: 'chat-1',
    siteId: 'node-pa',
    machineId: 'lobby-01',
    userId: 'user-1',
    note: 'check whether the render finished',
    runAt: new Date(Date.now() + 10 * 60_000),
    status: 'scheduled',
    createdAt: '__SERVER_TS__',
    ...overrides,
  };
}

beforeEach(() => {
  followups.clear();
  listResult = [];
  nextId = 1;
  jest.clearAllMocks();
});

describe('scheduleFollowup', () => {
  it('writes a scheduled doc and returns its id and instant', async () => {
    const runAt = new Date(Date.now() + 5 * 60_000);

    const result = await scheduleFollowup(db, {
      chatId: 'chat-1',
      siteId: 'node-pa',
      target: { machineIds: ['lobby-01'] },
      userId: 'user-1',
      note: 'check whether the render finished',
      runAt,
    });

    expect(result).toEqual({ id: 'fu-1', runAt });
    expect(added).toHaveBeenCalledWith({
      chatId: 'chat-1',
      siteId: 'node-pa',
      targetMachineIds: ['lobby-01'],
      machineId: 'lobby-01',
      userId: 'user-1',
      note: 'check whether the render finished',
      runAt,
      status: 'scheduled',
      createdAt: '__SERVER_TS__',
    });
  });

  it('records a subset target under a legacy machineId that cannot widen', async () => {
    // The legacy field is what a sweep on an older instance reads (a rollback, a
    // half-finished deploy). Left as the site sentinel, a follow-up scheduled in
    // a two-machine chat would fire across the WHOLE site; the target's first
    // machine makes the worst case a narrowing, never a widening.
    await scheduleFollowup(db, {
      chatId: 'chat-1',
      siteId: 'node-pa',
      target: { machineIds: ['kiosk-02', 'kiosk-03'] },
      userId: 'user-1',
      note: 'check both walls again',
      runAt: new Date(),
    });

    expect(added).toHaveBeenCalledWith(
      expect.objectContaining({
        targetMachineIds: ['kiosk-02', 'kiosk-03'],
        machineId: 'kiosk-02',
      }),
    );
  });

  it('records a site-wide target as the dynamic null plus the sentinel', async () => {
    // `null` stays null so a machine added later joins the follow-up (D-D), and
    // the sentinel keeps an old sweep firing site-wide, exactly as asked.
    await scheduleFollowup(db, {
      chatId: 'chat-1',
      siteId: 'node-pa',
      target: { machineIds: null },
      userId: 'user-1',
      note: 'sweep the fleet again',
      runAt: new Date(),
    });

    expect(added).toHaveBeenCalledWith(
      expect.objectContaining({ targetMachineIds: null, machineId: '__site__' }),
    );
  });

  it('refuses an empty target rather than writing one that reads as site-wide', async () => {
    // `[]` has no legacy encoding: `machineId` would have to be the sentinel, so
    // an empty selection would come back as every machine in the site.
    await expect(
      scheduleFollowup(db, {
        chatId: 'chat-1',
        siteId: 'node-pa',
        target: { machineIds: [] },
        userId: 'user-1',
        note: 'check back',
        runAt: new Date(),
      }),
    ).rejects.toThrow(/empty machine set/);

    expect(added).not.toHaveBeenCalled();
  });

  it('stores watchCommandId only when one was given', async () => {
    await scheduleFollowup(db, {
      chatId: 'chat-1',
      siteId: 'node-pa',
      target: { machineIds: ['lobby-01'] },
      userId: 'user-1',
      note: 'report when the install lands',
      runAt: new Date(),
      watchCommandId: 'cmd-42',
    });

    // Firestore rejects nested undefined, so the field is absent when unset —
    // the exact-shape assertion above covers that case.
    expect(added).toHaveBeenCalledWith(expect.objectContaining({ watchCommandId: 'cmd-42' }));
  });

  it('records the scheduling turn\'s tier ceiling, and omits it when there is none', async () => {
    // The ceiling is what stops a capped turn (a chat-scoped API key is held to
    // tier 1) from promising itself the owner's reach at fire time. Absent is
    // the legacy shape the sweep reads as "no recorded ceiling".
    const base = {
      chatId: 'chat-1',
      siteId: 'node-pa',
      target: { machineIds: ['lobby-01'] },
      userId: 'user-1',
      note: 'check back on the install',
      runAt: new Date(),
    };

    await scheduleFollowup(db, { ...base, maxToolTier: 1 });
    await scheduleFollowup(db, base);

    expect(added.mock.calls[0][0]).toMatchObject({ maxToolTier: 1 });
    expect(added.mock.calls[1][0]).not.toHaveProperty('maxToolTier');
  });
});

describe('cancelFollowup', () => {
  it('cancels a scheduled follow-up for its owner', async () => {
    followups.set('fu-1', scheduled());

    const outcome = await cancelFollowup(db, 'fu-1', { userId: 'user-1' });

    expect(outcome).toBe('cancelled');
    expect(followups.get('fu-1')?.status).toBe('cancelled');
  });

  it('refuses another user, leaving the follow-up scheduled', async () => {
    followups.set('fu-1', scheduled());

    const outcome = await cancelFollowup(db, 'fu-1', { userId: 'someone-else' });

    expect(outcome).toBe('forbidden');
    expect(followups.get('fu-1')?.status).toBe('scheduled');
  });

  it('reports a missing follow-up', async () => {
    expect(await cancelFollowup(db, 'fu-gone', { userId: 'user-1' })).toBe('not_found');
  });

  it('loses to a sweep that already claimed the follow-up', async () => {
    // The sweep's flip out of `scheduled` is the claim; cancelling after it
    // would leave a dispatched turn with a cancelled record behind it.
    followups.set('fu-1', scheduled({ status: 'fired' }));

    const outcome = await cancelFollowup(db, 'fu-1', { userId: 'user-1' });

    expect(outcome).toBe('not_scheduled');
    expect(followups.get('fu-1')?.status).toBe('fired');
  });
});

describe('listChatFollowups', () => {
  it('queries one chat\'s scheduled follow-ups, soonest first', async () => {
    followups.set('fu-1', scheduled({ runAt: new Date(1_700_000_000_000) }));
    listResult = ['fu-1'];

    const result = await listChatFollowups(db, 'chat-1');

    expect(where).toHaveBeenCalledWith('chatId', '==', 'chat-1');
    expect(where).toHaveBeenCalledWith('status', '==', 'scheduled');
    expect(orderBy).toHaveBeenCalledWith('runAt', 'asc');
    expect(limit).toHaveBeenCalledWith(50);
    expect(result).toEqual([
      {
        id: 'fu-1',
        chatId: 'chat-1',
        siteId: 'node-pa',
        machineId: 'lobby-01',
        userId: 'user-1',
        note: 'check whether the render finished',
        runAtMs: 1_700_000_000_000,
        status: 'scheduled',
      },
    ]);
  });

  it('honours an explicit status and limit', async () => {
    await listChatFollowups(db, 'chat-1', { status: 'failed', limit: 5 });

    expect(where).toHaveBeenCalledWith('status', '==', 'failed');
    expect(limit).toHaveBeenCalledWith(5);
  });

  it('surfaces watchCommandId and turnError when present', async () => {
    followups.set(
      'fu-1',
      scheduled({ status: 'failed', watchCommandId: 'cmd-42', turnError: 'chat_deleted' }),
    );
    listResult = ['fu-1'];

    const [summary] = await listChatFollowups(db, 'chat-1', { status: 'failed' });

    expect(summary).toMatchObject({ watchCommandId: 'cmd-42', turnError: 'chat_deleted' });
  });
});

/** A stored doc, typed — the two readers take the document, not the summary. */
function storedDoc(overrides: Partial<FollowupDoc> = {}): FollowupDoc {
  return {
    chatId: 'chat-1',
    siteId: 'node-pa',
    machineId: 'lobby-01',
    userId: 'user-1',
    note: 'check whether the render finished',
    runAt: new Date(),
    status: 'scheduled',
    createdAt: '__SERVER_TS__',
    ...overrides,
  };
}

describe('scheduledTarget', () => {
  it('reads the recorded set, not the narrowing legacy field beside it', () => {
    // The legacy `machineId` is the first of the set (never-widen). Reading it
    // instead of the list would fire a two-machine promise on one machine.
    expect(
      scheduledTarget(
        storedDoc({ targetMachineIds: ['lobby-01', 'lobby-02'], machineId: 'lobby-01' }),
      ),
    ).toEqual({ machineIds: ['lobby-01', 'lobby-02'] });
  });

  it('keeps a recorded site-wide target dynamic', () => {
    // `null` is a recorded value, not a missing one, so a machine added since
    // scheduling joins the fire (D-D).
    expect(
      scheduledTarget(storedDoc({ targetMachineIds: null, machineId: '__site__' })),
    ).toEqual({ machineIds: null });
  });

  it('falls back to the legacy machineId on a doc written before targets', () => {
    expect(scheduledTarget(storedDoc())).toEqual({ machineIds: ['lobby-01'] });
    expect(scheduledTarget(storedDoc({ machineId: '__site__' }))).toEqual({ machineIds: null });
  });
});

describe('watchedMachineId', () => {
  it('names the machine to watch for a single-machine follow-up', () => {
    expect(
      watchedMachineId(
        storedDoc({ targetMachineIds: ['lobby-02'], machineId: 'lobby-02', watchCommandId: 'c1' }),
      ),
    ).toBe('lobby-02');
  });

  it('reads the legacy machineId when no target was recorded', () => {
    expect(watchedMachineId(storedDoc({ watchCommandId: 'c1' }))).toBe('lobby-01');
  });

  it('refuses to watch one command on behalf of a multi-machine follow-up', () => {
    // The gate that matters: the legacy field would hand back `lobby-01` here,
    // firing the turn the moment ONE of the two machines finished.
    expect(
      watchedMachineId(
        storedDoc({
          targetMachineIds: ['lobby-01', 'lobby-02'],
          machineId: 'lobby-01',
          watchCommandId: 'c1',
        }),
      ),
    ).toBeNull();
  });

  it('refuses a site-wide follow-up, recorded or legacy', () => {
    expect(
      watchedMachineId(
        storedDoc({ targetMachineIds: null, machineId: '__site__', watchCommandId: 'c1' }),
      ),
    ).toBeNull();
    expect(watchedMachineId(storedDoc({ machineId: '__site__', watchCommandId: 'c1' }))).toBeNull();
  });

  it('is null when there is no command to watch at all', () => {
    expect(watchedMachineId(storedDoc())).toBeNull();
  });
});
