/**
 * Turn a hoot conversation into the text-only snapshot a share publishes.
 *
 * Pure and client-safe on purpose: the share dialog runs it on the messages in
 * the browser to render the preview, and the API runs it on the persisted chat
 * doc to build what is stored — the same function, so the preview IS the page.
 *
 * What survives: user and assistant text, and tool calls collapsed to a name and
 * an outcome. What never does: tool inputs and outputs (hostnames, paths, log
 * lines, screenshots live there), attachments, system messages, reasoning and
 * step/source/data parts. Assistant TEXT can still quote machine details — that
 * is why the dialog shows the preview before anything is created.
 */

import type { UIMessage } from 'ai';
import { UNTITLED_CHAT_TITLE } from '@/lib/hoot/untitledChat';
import type { SharedMessage, SharedPart, SharedToolOutcome, ShareSnapshot } from './shareTypes';

type UIMessagePart = UIMessage['parts'][number];

/** The subset of a v6 tool part this module reads. Mirrors repairMessages.ts. */
interface ToolLikePart {
  type: string;
  state?: string;
  toolName?: string;
  approval?: { approved?: boolean };
}

export interface BuildShareSnapshotInput {
  title: string;
  targetLabel: string | null;
  messages: UIMessage[];
}

function isToolPart(part: UIMessagePart): part is UIMessagePart & ToolLikePart {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))
  );
}

/** `tool-{name}` for static tools, `toolName` for dynamic ones. */
export function toolNameOf(part: ToolLikePart): string {
  if (part.type === 'dynamic-tool') {
    return typeof part.toolName === 'string' && part.toolName ? part.toolName : 'tool';
  }
  return part.type.slice('tool-'.length) || 'tool';
}

/**
 * Collapse a v6 tool state to an outcome. A granted approval whose output has not
 * landed is still `incomplete`; a refused one is `denied` (the tool never ran).
 */
export function toolOutcomeOf(part: ToolLikePart): SharedToolOutcome {
  switch (part.state) {
    case 'output-available':
    case 'result':
      return 'completed';
    case 'output-error':
      return 'failed';
    case 'output-denied':
      return 'denied';
    case 'approval-responded':
      return part.approval?.approved === false ? 'denied' : 'incomplete';
    default:
      return 'incomplete';
  }
}

export function buildShareSnapshot(input: BuildShareSnapshotInput): ShareSnapshot {
  let images = 0;
  let systemMessages = 0;
  let collapsedToolCalls = 0;
  const messages: SharedMessage[] = [];

  for (const message of input.messages) {
    if (message.role === 'system') {
      systemMessages += 1;
      continue;
    }
    if (message.role !== 'user' && message.role !== 'assistant') continue;

    const parts: SharedPart[] = [];
    for (const part of message.parts ?? []) {
      if (part.type === 'text') {
        const text = (part as { text?: unknown }).text;
        if (typeof text === 'string' && text.trim()) parts.push({ type: 'text', text });
        continue;
      }
      if (part.type === 'file') {
        images += 1;
        continue;
      }
      if (isToolPart(part)) {
        collapsedToolCalls += 1;
        parts.push({ type: 'tool', toolName: toolNameOf(part), outcome: toolOutcomeOf(part) });
        continue;
      }
      // reasoning, step-start, source-*, data-* — never part of what a reader sees.
    }

    if (parts.length > 0) messages.push({ id: message.id, role: message.role, parts });
  }

  const title = input.title.trim() || UNTITLED_CHAT_TITLE;

  return {
    version: 1,
    title,
    targetLabel: input.targetLabel,
    messages,
    omitted: { images, systemMessages },
    collapsedToolCalls,
  };
}

/**
 * UTF-8 length without TextEncoder, which the browser and Node have but the
 * jsdom test environment does not. Surrogate pairs count as one 4-byte scalar.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** UTF-8 size of the stored snapshot, for the Firestore document cap. */
export function snapshotByteLength(snapshot: ShareSnapshot): number {
  return utf8ByteLength(JSON.stringify(snapshot));
}
