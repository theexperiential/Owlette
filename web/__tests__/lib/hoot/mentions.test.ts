/**
 * @jest-environment node
 *
 * `@machine` mentions (hoot multi-machine targeting, Wave 1). A mention narrows
 * ONE turn, so the parse is pinned against false positives in both directions:
 * prose and pasted shell must never target a machine, and a real mention must
 * survive punctuation and casing. The caret/insert math is pinned here too —
 * the composer (Wave 5) owns no parsing of its own.
 */

import {
  applyMention,
  filterMentionOptions,
  findActiveMentionToken,
  parseMentions,
  type MentionToken,
} from '@/lib/hoot/mentions';

const SITE_IDS = ['kiosk-1', 'kiosk-10', 'Lobby_TD', 'media.server-01'];

/** Fenced blocks are easier to read assembled than escaped inside a template. */
const lines = (...rows: string[]) => rows.join('\n');

describe('parseMentions', () => {
  it('resolves a mention at the start of the text and after whitespace', () => {
    expect(parseMentions('@kiosk-1 restart touchdesigner', SITE_IDS)).toEqual(['kiosk-1']);
    expect(parseMentions('please restart @kiosk-1', SITE_IDS)).toEqual(['kiosk-1']);
  });

  it('prefers the longest known id (kiosk-10 over kiosk-1)', () => {
    expect(parseMentions('@kiosk-10 status', SITE_IDS)).toEqual(['kiosk-10']);
    expect(parseMentions('@kiosk-1 status', SITE_IDS)).toEqual(['kiosk-1']);
  });

  it('prefers the longest id even when the shorter one ends at a dot boundary', () => {
    // The only collision the boundary rule alone cannot settle: a dot both
    // closes a mention and lives inside a hostname.
    expect(parseMentions('@kiosk-1.local please', ['kiosk-1', 'kiosk-1.local'])).toEqual([
      'kiosk-1.local',
    ]);
  });

  it('matches case-insensitively and returns the canonical id the site uses', () => {
    expect(parseMentions('@KIOSK-10 and @lobby_td', SITE_IDS)).toEqual(['kiosk-10', 'Lobby_TD']);
  });

  it('requires a boundary after the id, so a longer unknown id never matches', () => {
    expect(parseMentions('@kiosk-100 is not a machine', SITE_IDS)).toEqual([]);
    expect(parseMentions('@kiosk-1x', SITE_IDS)).toEqual([]);
  });

  it('accepts closing punctuation as the boundary', () => {
    expect(parseMentions('restart @kiosk-1.', SITE_IDS)).toEqual(['kiosk-1']);
    expect(parseMentions('(@kiosk-10) and @Lobby_TD;', SITE_IDS)).toEqual(['kiosk-10', 'Lobby_TD']);
    expect(parseMentions('see @kiosk-1] note', SITE_IDS)).toEqual(['kiosk-1']);
  });

  it('keeps dots inside an id, since a dot also closes a mention', () => {
    expect(parseMentions('reboot @media.server-01, please', SITE_IDS)).toEqual(['media.server-01']);
    expect(parseMentions('@media.server-01.', SITE_IDS)).toEqual(['media.server-01']);
  });

  it('ignores an @ that does not start the text or follow whitespace or (', () => {
    expect(parseMentions('mail dylan@kiosk-1 about it', SITE_IDS)).toEqual([]);
    expect(parseMentions('reboot-@kiosk-1', SITE_IDS)).toEqual([]);
    expect(parseMentions('options [@kiosk-1]', SITE_IDS)).toEqual([]);
  });

  it('returns the union of several mentions, deduped, in order of first appearance', () => {
    expect(
      parseMentions('@kiosk-10 then @Lobby_TD and @kiosk-10 again, plus @kiosk-1', SITE_IDS),
    ).toEqual(['kiosk-10', 'Lobby_TD', 'kiosk-1']);
  });

  it('ignores unknown ids (D-H: unmatched @text is plain text)', () => {
    expect(parseMentions('@printer-9 @kiosk-99 hello', SITE_IDS)).toEqual([]);
  });

  it('ignores PowerShell @(...) and @splat', () => {
    expect(parseMentions("$list = @('a','b')", SITE_IDS)).toEqual([]);
    expect(parseMentions('Start-Process @splat', SITE_IDS)).toEqual([]);
    expect(parseMentions("$p = @(1,2); restart @kiosk-1", SITE_IDS)).toEqual(['kiosk-1']);
  });

  it('skips inline code spans', () => {
    expect(parseMentions('run `@kiosk-1` on the box', SITE_IDS)).toEqual([]);
    expect(parseMentions('``a @kiosk-1 b`` outside', SITE_IDS)).toEqual([]);
    expect(parseMentions('`@kiosk-1` but really @kiosk-10', SITE_IDS)).toEqual(['kiosk-10']);
  });

  it('treats an unmatched backtick as literal text, not a span', () => {
    expect(parseMentions('the ` key, then @kiosk-1', SITE_IDS)).toEqual(['kiosk-1']);
  });

  it('skips fenced blocks and resumes after them', () => {
    const text = lines(
      'here is the script:',
      '```powershell',
      "Start-Process @splat -ComputerName @kiosk-1",
      '```',
      'now do it on @kiosk-10',
    );
    expect(parseMentions(text, SITE_IDS)).toEqual(['kiosk-10']);
  });

  it('skips a tilde fence and an unclosed fence (a half-typed paste)', () => {
    expect(parseMentions(lines('~~~', '@kiosk-1', '~~~', '@kiosk-10'), SITE_IDS)).toEqual([
      'kiosk-10',
    ]);
    expect(parseMentions(lines('@kiosk-10', '```', '@kiosk-1'), SITE_IDS)).toEqual(['kiosk-10']);
  });

  it('returns nothing for empty text or a site with no machines', () => {
    expect(parseMentions('', SITE_IDS)).toEqual([]);
    expect(parseMentions('@kiosk-1', [])).toEqual([]);
    expect(parseMentions('@kiosk-1', ['', '  '])).toEqual([]);
  });
});

/**
 * The parse also runs server-side on whatever a client sends (D-I), on a route
 * with no message-length cap, so a crafted message must not be able to sit on
 * the event loop. Both shapes below used to be quadratic: unmatched backtick
 * runs each rescanned to the end of the text, and every `@` scanned the whole
 * list of code ranges. The budget is deliberately loose — it is there to catch
 * a return to quadratic (seconds), not to measure anything.
 */
describe('parseMentions on pathological input', () => {
  const BUDGET_MS = 1000;

  const elapsed = (run: () => void): number => {
    const started = performance.now();
    run();
    return performance.now() - started;
  };

  it('stays fast when no backtick run ever closes', () => {
    // 1,600 runs of increasing length: none of them matches another.
    const runs = Array.from({ length: 1600 }, (_, i) => '`'.repeat(i + 1)).join(' ');
    const text = `${runs} @kiosk-1 wake up`;

    let mentions: string[] = [];
    const ms = elapsed(() => {
      mentions = parseMentions(text, SITE_IDS);
    });

    // Unmatched runs are literal text, so the mention after them still counts.
    expect(mentions).toEqual(['kiosk-1']);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('stays fast on a message that is mostly code spans and mentions', () => {
    const text = '`c` @kiosk-1 '.repeat(40_000);

    let mentions: string[] = [];
    const ms = elapsed(() => {
      mentions = parseMentions(text, SITE_IDS);
    });

    expect(mentions).toEqual(['kiosk-1']);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('survives more code spans than an argument list can carry', () => {
    // `push(...spans)` throws past ~100k arguments — on the client that would
    // be every keystroke in the composer, not just the send.
    const text = '`c` '.repeat(130_000);

    expect(parseMentions(`${text} @kiosk-1`, SITE_IDS)).toEqual(['kiosk-1']);
  });

  it('stays fast for the composer, which re-parses on every keystroke', () => {
    const runs = Array.from({ length: 1600 }, (_, i) => '`'.repeat(i + 1)).join(' ');
    const text = `${runs} @kio`;

    let token: MentionToken | null = null;
    const ms = elapsed(() => {
      token = findActiveMentionToken(text, text.length);
    });

    expect(token).toEqual({ start: text.length - 4, end: text.length, query: 'kio' });
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe('findActiveMentionToken', () => {
  it('opens on a bare @ with an empty query', () => {
    expect(findActiveMentionToken('restart @', 9)).toEqual({ start: 8, end: 9, query: '' });
  });

  it('reports what has been typed so far', () => {
    expect(findActiveMentionToken('restart @kio', 12)).toEqual({ start: 8, end: 12, query: 'kio' });
  });

  it('extends past the caret over the rest of the token, so a mid-token edit leaves no tail', () => {
    // 'restart @kiosk more', caret between 'kio' and 'sk'.
    expect(findActiveMentionToken('restart @kiosk more', 12)).toEqual({
      start: 8,
      end: 14,
      query: 'kio',
    });
  });

  it('opens after ( but not after a word character', () => {
    expect(findActiveMentionToken('(@kio', 5)).toEqual({ start: 1, end: 5, query: 'kio' });
    expect(findActiveMentionToken('mail dylan@kio', 14)).toBeNull();
  });

  it('returns null when the caret is not in a mention', () => {
    expect(findActiveMentionToken('restart kio', 11)).toBeNull();
    expect(findActiveMentionToken('', 0)).toBeNull();
  });

  it('returns null inside code, where a mention would not parse', () => {
    expect(findActiveMentionToken('`run @kio`', 9)).toBeNull();
    expect(findActiveMentionToken(lines('```', '@kio'), 8)).toBeNull();
  });

  it('gives up on a run longer than any machine id', () => {
    const text = `@${'a'.repeat(70)}`;
    expect(findActiveMentionToken(text, text.length)).toBeNull();
  });

  it('clamps a caret outside the text', () => {
    expect(findActiveMentionToken('@kio', 99)).toEqual({ start: 0, end: 4, query: 'kio' });
    expect(findActiveMentionToken('@kio', -1)).toBeNull();
  });
});

describe('filterMentionOptions', () => {
  const options = [
    { id: 'media.server-01', online: true, hootEnabled: true },
    { id: 'backup-kiosk', online: false, hootEnabled: true },
    { id: 'kiosk-1', online: true, hootEnabled: true },
    { id: 'kiosk-10', online: true, hootEnabled: false },
  ];

  it('puts prefix matches before substring matches, keeping the given order within each', () => {
    expect(filterMentionOptions('kiosk', options).map((o) => o.id)).toEqual([
      'kiosk-1',
      'kiosk-10',
      'backup-kiosk',
    ]);
  });

  it('matches case-insensitively and carries the row through', () => {
    expect(filterMentionOptions('KIOSK-10', options)).toEqual([
      { id: 'kiosk-10', online: true, hootEnabled: false },
    ]);
  });

  it('returns the options in order for an empty query', () => {
    expect(filterMentionOptions('   ', options).map((o) => o.id)).toEqual(options.map((o) => o.id));
  });

  it('caps at the limit (8 by default)', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `kiosk-${i}` }));
    expect(filterMentionOptions('', many)).toHaveLength(8);
    expect(filterMentionOptions('kiosk', many, 3).map((o) => o.id)).toEqual([
      'kiosk-0',
      'kiosk-1',
      'kiosk-2',
    ]);
  });

  it('returns nothing when the query matches no id', () => {
    expect(filterMentionOptions('projector', options)).toEqual([]);
  });
});

describe('applyMention', () => {
  const tokenAt = (text: string, caret: number): MentionToken => {
    const token = findActiveMentionToken(text, caret);
    if (!token) throw new Error(`no mention token in ${JSON.stringify(text)} at ${caret}`);
    return token;
  };

  it('inserts "@<id> " and leaves the caret after the space', () => {
    const text = 'restart @kio';
    const result = applyMention(text, tokenAt(text, 12), 'kiosk-10');
    expect(result.text).toBe('restart @kiosk-10 ');
    expect(result.caret).toBe(18);
    expect(result.text.slice(0, result.caret)).toBe('restart @kiosk-10 ');
  });

  it('does not add a second space when completing mid-sentence', () => {
    const text = 'ping @kio now';
    const result = applyMention(text, tokenAt(text, 9), 'kiosk-10');
    expect(result.text).toBe('ping @kiosk-10 now');
    expect(result.text.slice(result.caret)).toBe('now');
  });

  it('replaces the whole half-edited token, not just the typed prefix', () => {
    const text = 'restart @kiosk more';
    const result = applyMention(text, tokenAt(text, 12), 'kiosk-10');
    expect(result.text).toBe('restart @kiosk-10 more');
    expect(result.text.slice(result.caret)).toBe('more');
  });

  it('round-trips: what it inserts is what parseMentions reads back', () => {
    const text = 'check @lob and @kio';
    const first = applyMention(text, tokenAt(text, 10), 'Lobby_TD');
    const second = applyMention(first.text, tokenAt(first.text, first.text.length), 'kiosk-1');
    expect(parseMentions(second.text, SITE_IDS)).toEqual(['Lobby_TD', 'kiosk-1']);
  });
});
