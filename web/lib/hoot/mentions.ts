/**
 * `@machine` mentions for the hoot composer — parsing, completion and insertion.
 *
 * A mention narrows ONE turn to the machines it names, leaving the chat's own
 * selection alone, so the parse has to be conservative: a false positive would
 * silently retarget a turn the user meant for every ticked machine. Hence the
 * rules below (D-H), all of which exist to keep ordinary prose and pasted shell
 * from reading as targeting:
 *
 * - `@` opens a mention only at the start of the text or after whitespace or
 *   `(`, so `dylan@example.com` and a mid-word `@` never match.
 * - Only ids the site actually has can match, longest first — `@kiosk-10` must
 *   not resolve to `kiosk-1` with a stray `0` behind it.
 * - The id must end at a boundary (end of text, whitespace, or closing
 *   punctuation), so `@kiosk-1` does not match inside `@kiosk-12`.
 * - Code spans and fenced blocks are skipped: PowerShell `@(...)`, `@splat` and
 *   a pasted script are text, not targeting.
 *
 * Pure and free of firebase imports — the client builds the request body with
 * it and the server re-parses the final user message to agree with that body
 * (D-I: the body alone never narrows a turn).
 */

/** Machine-id charset: Windows hostname characters, never `/`. */
const ID_CHAR = /[A-Za-z0-9._-]/;

/** Punctuation allowed to close a mention, so "@kiosk-01." still resolves. */
const MENTION_TERMINATORS = '.,;:!?)]';

/**
 * Longest run of id characters we scan back over when completing at the caret.
 * Nothing that long is a machine id, and it bounds the work on a big paste.
 */
const MAX_MENTION_TOKEN = 64;

/** A fence opens (or closes) a block: three or more backticks/tildes, barely indented. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

type Range = [start: number, end: number];

interface KnownId {
  /** Lowercased, for case-insensitive comparison. */
  lower: string;
  /** The site's own casing — what a mention resolves to. */
  canonical: string;
}

export interface MentionToken {
  /** Index of the `@`. */
  start: number;
  /**
   * Exclusive end of the text a completion replaces: the caret, extended over
   * any id characters it sits inside, so completing a half-edited token
   * ("@kio|sk") leaves no tail behind.
   */
  end: number;
  /** What has been typed between the `@` and the caret. */
  query: string;
}

/** The shape the picker and composer share; callers pass richer rows through. */
export interface MentionOption {
  id: string;
}

/**
 * Inline code spans within [from, to): a backtick run closed by one of equal
 * length. The runs are collected and indexed by length in one pass rather than
 * rescanned per run — searching ahead for each run's closer is quadratic when
 * the closers aren't there, and this parse runs on text a client supplies, both
 * in the composer and again server-side (D-I).
 */
function inlineCodeRanges(text: string, from: number, to: number): Range[] {
  const starts: number[] = [];
  const ends: number[] = [];
  /** Run indices bucketed by run length: a run's closer is the next one in its bucket. */
  const sameLength = new Map<number, number[]>();

  for (let i = from; i < to; i++) {
    if (text[i] !== '`') continue;
    let runEnd = i;
    while (runEnd < to && text[runEnd] === '`') runEnd++;
    const bucket = sameLength.get(runEnd - i);
    if (bucket) bucket.push(starts.length);
    else sameLength.set(runEnd - i, [starts.length]);
    starts.push(i);
    ends.push(runEnd);
    i = runEnd - 1; // the loop's own step lands past the run
  }

  const ranges: Range[] = [];
  // One cursor per length, only ever advanced, so every run is looked at once.
  const cursors = new Map<number, number>();

  for (let run = 0; run < starts.length; ) {
    const runLength = ends[run] - starts[run];
    const bucket = sameLength.get(runLength) ?? [];
    let cursor = cursors.get(runLength) ?? 0;
    while (cursor < bucket.length && bucket[cursor] <= run) cursor++;
    cursors.set(runLength, cursor);

    if (cursor >= bucket.length) {
      // An unmatched run is literal text, not a span — keep scanning past it.
      run++;
      continue;
    }

    const closer = bucket[cursor];
    ranges.push([starts[run], ends[closer]]);
    run = closer + 1;
  }

  return ranges;
}

/** `into.push(...spans)` throws past ~100k arguments, which a code-heavy paste reaches. */
function pushRanges(into: Range[], spans: readonly Range[]): void {
  for (const span of spans) into.push(span);
}

/** Every region a mention must be ignored in: fenced blocks and inline spans, in order. */
function codeRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let fence: { char: string; length: number; start: number } | null = null;
  let plainStart = 0;
  let offset = 0;

  for (const line of text.split('\n')) {
    const lineStart = offset;
    const lineEnd = lineStart + line.length;
    offset = lineEnd + 1; // past the '\n'
    const marker = FENCE_RE.exec(line);

    if (!fence) {
      if (marker) {
        pushRanges(ranges, inlineCodeRanges(text, plainStart, lineStart));
        fence = { char: marker[1][0], length: marker[1].length, start: lineStart };
      }
      continue;
    }

    // A closer is the same character, at least as long, alone on its line.
    if (
      marker &&
      marker[1][0] === fence.char &&
      marker[1].length >= fence.length &&
      line.slice(marker[0].length).trim() === ''
    ) {
      ranges.push([fence.start, lineEnd]);
      fence = null;
      plainStart = lineEnd;
    }
  }

  if (fence) {
    // A half-typed block runs to the end of the text — still code.
    ranges.push([fence.start, text.length]);
  } else {
    pushRanges(ranges, inlineCodeRanges(text, plainStart, text.length));
  }

  return ranges;
}

/**
 * Binary search, not a scan: `codeRanges` emits sorted, non-overlapping ranges,
 * and this is asked once per `@`, so a scan is quadratic on a paste that is
 * mostly code spans.
 */
function isInCode(ranges: readonly Range[], index: number): boolean {
  let low = 0;
  let high = ranges.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const [start, end] = ranges[middle];
    if (index < start) high = middle - 1;
    else if (index >= end) low = middle + 1;
    else return true;
  }

  return false;
}

/** `@` opens a mention only at the start of the text, or after whitespace or `(`. */
function opensMention(text: string, at: number): boolean {
  if (at === 0) return true;
  const previous = text[at - 1];
  return previous === '(' || /\s/.test(previous);
}

function isBoundary(char: string): boolean {
  return /\s/.test(char) || MENTION_TERMINATORS.includes(char);
}

/** Site ids indexed longest-first, so `kiosk-10` is tried before `kiosk-1`. */
function indexIds(siteMachineIds: readonly string[]): KnownId[] {
  const byLower = new Map<string, string>();
  for (const id of siteMachineIds) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, trimmed);
  }
  return [...byLower.entries()]
    .map(([lower, canonical]) => ({ lower, canonical }))
    .sort((a, b) => b.lower.length - a.lower.length);
}

/**
 * The id starting at `at`, or null. Compares slice by slice rather than
 * lowercasing the whole text: some characters change length when lowercased,
 * which would shift every index after them.
 */
function matchIdAt(text: string, at: number, ids: readonly KnownId[]): KnownId | null {
  for (const id of ids) {
    const end = at + id.lower.length;
    if (text.slice(at, end).toLowerCase() !== id.lower) continue;
    if (end < text.length && !isBoundary(text[end])) continue;
    return id;
  }
  return null;
}

/**
 * Canonical ids mentioned in `text`, deduped, in order of first appearance.
 * Unknown ids are plain text (D-H), so this never widens a turn.
 */
export function parseMentions(text: string, siteMachineIds: readonly string[]): string[] {
  if (!text) return [];
  const ids = indexIds(siteMachineIds);
  if (ids.length === 0) return [];

  const code = codeRanges(text);
  const seen = new Set<string>();
  const mentioned: string[] = [];

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@' || !opensMention(text, i) || isInCode(code, i)) continue;
    const match = matchIdAt(text, i + 1, ids);
    if (!match) continue;
    if (!seen.has(match.canonical)) {
      seen.add(match.canonical);
      mentioned.push(match.canonical);
    }
    i += match.lower.length; // the loop's own step lands on the boundary char
  }

  return mentioned;
}

/**
 * The mention being typed at the caret, for the composer's popover — null when
 * the caret isn't inside one (including inside code, where a mention wouldn't
 * parse anyway).
 */
export function findActiveMentionToken(text: string, caret: number): MentionToken | null {
  const at = Math.max(0, Math.min(caret, text.length));

  let queryStart = at;
  while (
    queryStart > 0 &&
    at - queryStart < MAX_MENTION_TOKEN &&
    ID_CHAR.test(text[queryStart - 1])
  ) {
    queryStart--;
  }

  const sign = queryStart - 1;
  if (sign < 0 || text[sign] !== '@') return null;
  if (!opensMention(text, sign)) return null;
  if (isInCode(codeRanges(text), sign)) return null;

  let end = at;
  while (end < text.length && ID_CHAR.test(text[end])) end++;

  return { start: sign, end, query: text.slice(queryStart, at) };
}

/** Options for the popover: prefix matches first, then substring matches. */
export function filterMentionOptions<T extends MentionOption>(
  query: string,
  options: readonly T[],
  limit = 8,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options.slice(0, limit);

  const prefix: T[] = [];
  const substring: T[] = [];
  for (const option of options) {
    const id = option.id.toLowerCase();
    if (id.startsWith(needle)) prefix.push(option);
    else if (id.includes(needle)) substring.push(option);
  }

  return [...prefix, ...substring].slice(0, limit);
}

/** Replace the active token with `@<id> `, and say where the caret lands. */
export function applyMention(
  text: string,
  token: MentionToken,
  id: string,
): { text: string; caret: number } {
  const before = text.slice(0, token.start);
  const after = text.slice(token.end);
  const mention = `@${id}`;
  // One space after the id so the next word isn't glued to it — but never a
  // second one when completing in the middle of a sentence.
  const spacer = after.startsWith(' ') ? '' : ' ';

  return {
    text: `${before}${mention}${spacer}${after}`,
    caret: before.length + mention.length + 1,
  };
}
