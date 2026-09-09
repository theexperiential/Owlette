/**
 * The share snapshot is the whole privacy boundary of a public share: what this
 * builder drops can never reach a reader. The negative controls below assert
 * that tool inputs and outputs are absent from the SERIALIZED snapshot, not
 * merely that a collapsed part exists — a builder that copied the whole tool
 * part through would still produce a `tool` entry.
 */

import type { UIMessage } from 'ai';
import {
  buildShareSnapshot,
  snapshotByteLength,
  toolOutcomeOf,
  utf8ByteLength,
} from '@/lib/hoot/shareSnapshot';
import {
  DEFAULT_SHARE_EXPIRY_DAYS,
  SHARE_EXPIRY_OPTIONS_DAYS,
  isShareExpiry,
  isShareToken,
  shareUrl,
} from '@/lib/hoot/shareTypes';

type Part = UIMessage['parts'][number];

function msg(id: string, role: UIMessage['role'], parts: unknown[]): UIMessage {
  return { id, role, parts: parts as Part[] } as UIMessage;
}

const TOOL_INPUT_SECRET = 'C:\\shows\\secret-client-project.toe';
const TOOL_OUTPUT_SECRET = 'STUDIO-01 10.0.4.17 Access violation at 0x7ffd';

const conversation: UIMessage[] = [
  msg('sys', 'system', [{ type: 'text', text: 'You are hoot.' }]),
  msg('u1', 'user', [
    { type: 'text', text: 'Why did deployment fail?' },
    { type: 'file', mediaType: 'image/jpeg', url: 'https://storage.example/chat-images/u/c/1.jpg' },
  ]),
  msg('a1', 'assistant', [
    { type: 'step-start' },
    { type: 'reasoning', text: 'The user is asking about the deployment.' },
    {
      type: 'tool-checkLogs',
      toolCallId: 'tool-1',
      state: 'output-available',
      input: { path: TOOL_INPUT_SECRET },
      output: { status: 'warning', detail: TOOL_OUTPUT_SECRET },
    },
    { type: 'text', text: 'The installer exited with a retryable warning.' },
  ]),
  msg('u2', 'user', [{ type: 'text', text: '   ' }]),
  msg('a2', 'assistant', [
    {
      type: 'dynamic-tool',
      toolName: 'run_powershell',
      toolCallId: 'tool-2',
      state: 'output-error',
      input: { script: 'Get-Process' },
      errorText: TOOL_OUTPUT_SECRET,
    },
    { type: 'text', text: 'That command failed; nothing else to do.' },
  ]),
];

describe('buildShareSnapshot', () => {
  const snapshot = buildShareSnapshot({
    title: '  Deployment triage ',
    targetLabel: 'STUDIO-01',
    messages: conversation,
  });

  it('keeps user and assistant text, drops system messages and empty turns', () => {
    expect(snapshot.version).toBe(1);
    expect(snapshot.title).toBe('Deployment triage');
    expect(snapshot.targetLabel).toBe('STUDIO-01');
    expect(snapshot.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'a2']);
    expect(snapshot.omitted.systemMessages).toBe(1);
    expect(snapshot.messages[0].parts).toEqual([{ type: 'text', text: 'Why did deployment fail?' }]);
  });

  it('collapses tool calls to a name and an outcome', () => {
    expect(snapshot.messages[1].parts).toEqual([
      { type: 'tool', toolName: 'checkLogs', outcome: 'completed' },
      { type: 'text', text: 'The installer exited with a retryable warning.' },
    ]);
    expect(snapshot.messages[2].parts[0]).toEqual({
      type: 'tool',
      toolName: 'run_powershell',
      outcome: 'failed',
    });
    expect(snapshot.collapsedToolCalls).toBe(2);
  });

  it('never serializes tool inputs, outputs or error text (negative control)', () => {
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('secret-client-project');
    expect(serialized).not.toContain('10.0.4.17');
    expect(serialized).not.toContain('Access violation');
    expect(serialized).not.toContain('Get-Process');
    expect(serialized).not.toContain('"input"');
    expect(serialized).not.toContain('"output"');
    expect(serialized).not.toContain('"errorText"');
    expect(serialized).not.toContain('toolCallId');
  });

  it('omits attachments and never carries their URLs, counting them for the dialog', () => {
    expect(snapshot.omitted.images).toBe(1);
    expect(JSON.stringify(snapshot)).not.toContain('chat-images');
  });

  it('drops reasoning and step parts without counting them as content', () => {
    expect(JSON.stringify(snapshot)).not.toContain('asking about the deployment');
    expect(snapshot.messages[1].parts).toHaveLength(2);
  });

  it('falls back to the untitled placeholder for a blank title', () => {
    const blank = buildShareSnapshot({ title: '   ', targetLabel: null, messages: conversation });
    expect(blank.title.length).toBeGreaterThan(0);
    expect(blank.title.trim()).toBe(blank.title);
  });

  it('yields no messages for a conversation with nothing to show', () => {
    const empty = buildShareSnapshot({
      title: 't',
      targetLabel: null,
      messages: [msg('u', 'user', [{ type: 'file', mediaType: 'image/png', url: 'x' }])],
    });
    expect(empty.messages).toEqual([]);
    expect(empty.omitted.images).toBe(1);
  });

  it('measures the serialized size in UTF-8 bytes', () => {
    const tiny = buildShareSnapshot({
      title: 'é',
      targetLabel: null,
      messages: [msg('u', 'user', [{ type: 'text', text: 'ü 😀 日本' }])],
    });
    expect(snapshotByteLength(tiny)).toBe(Buffer.byteLength(JSON.stringify(tiny), 'utf8'));
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('日')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
  });
});

describe('toolOutcomeOf', () => {
  it.each([
    ['output-available', undefined, 'completed'],
    ['result', undefined, 'completed'],
    ['output-error', undefined, 'failed'],
    ['output-denied', undefined, 'denied'],
    ['approval-responded', false, 'denied'],
    ['approval-responded', true, 'incomplete'],
    ['approval-requested', undefined, 'incomplete'],
    ['input-available', undefined, 'incomplete'],
    ['input-streaming', undefined, 'incomplete'],
    [undefined, undefined, 'incomplete'],
  ])('state %s (approved=%s) → %s', (state, approved, expected) => {
    const part = {
      type: 'tool-x',
      state: state as string | undefined,
      approval: approved === undefined ? undefined : { approved },
    };
    expect(toolOutcomeOf(part)).toBe(expected);
  });
});

describe('share token and expiry helpers', () => {
  it('accepts only shr_ plus 24 url-safe characters', () => {
    expect(isShareToken('shr_' + 'a'.repeat(24))).toBe(true);
    expect(isShareToken('shr_' + 'A1-_'.repeat(6))).toBe(true);
    expect(isShareToken('shr_' + 'a'.repeat(23))).toBe(false);
    expect(isShareToken('shr_' + 'a'.repeat(25))).toBe(false);
    expect(isShareToken('shr_' + 'a'.repeat(23) + '/')).toBe(false);
    expect(isShareToken('conv_' + 'a'.repeat(24))).toBe(false);
    expect(isShareToken(undefined)).toBe(false);
    expect(isShareToken(42)).toBe(false);
  });

  it('accepts the offered expiries and null, nothing else', () => {
    for (const days of SHARE_EXPIRY_OPTIONS_DAYS) expect(isShareExpiry(days)).toBe(true);
    expect(isShareExpiry(null)).toBe(true);
    expect(isShareExpiry(1)).toBe(false);
    expect(isShareExpiry('30')).toBe(false);
    expect(isShareExpiry(undefined)).toBe(false);
    expect(SHARE_EXPIRY_OPTIONS_DAYS).toContain(DEFAULT_SHARE_EXPIRY_DAYS);
  });

  it('builds the permalink without doubling slashes', () => {
    expect(shareUrl('https://owlette.app/', 'shr_x')).toBe('https://owlette.app/share/shr_x');
    expect(shareUrl('https://owlette.app', 'shr_x')).toBe('https://owlette.app/share/shr_x');
  });
});
