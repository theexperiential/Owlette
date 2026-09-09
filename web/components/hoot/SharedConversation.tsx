'use client';

/**
 * Read-only rendering of a share snapshot's messages.
 *
 * The share dialog's preview and the public `/share/{token}` page both render
 * THIS component, so what the owner previews is exactly what a reader sees.
 * No auth context, no hooks that need a session: it must work on a page with
 * no signed-in user. Visual language mirrors ChatWindow (markdown classes, user
 * turns right-aligned) minus everything interactive.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Ban, CircleCheck, CircleDashed, CircleX, Wrench } from 'lucide-react';
import { HootIcon } from '@/components/icons/HootIcon';
import type { SharedMessage, SharedToolOutcome } from '@/lib/hoot/shareTypes';

const OUTCOME: Record<SharedToolOutcome, { label: string; icon: typeof CircleCheck; className: string }> = {
  completed: { label: 'completed', icon: CircleCheck, className: 'text-emerald-400' },
  failed: { label: 'failed', icon: CircleX, className: 'text-red-400' },
  denied: { label: 'denied', icon: Ban, className: 'text-muted-foreground' },
  incomplete: { label: 'not completed', icon: CircleDashed, className: 'text-muted-foreground' },
};

interface SharedConversationProps {
  messages: SharedMessage[];
  /** `preview` tightens spacing for the dialog's scroll box. */
  variant?: 'page' | 'preview';
}

export function SharedConversation({ messages, variant = 'page' }: SharedConversationProps) {
  const gap = variant === 'preview' ? 'space-y-4' : 'space-y-6';

  return (
    <div className={gap} data-testid="shared-conversation">
      {messages.map((message) => {
        const isUser = message.role === 'user';
        return (
          <div
            key={message.id}
            data-testid="shared-message"
            data-role={message.role}
            className={isUser ? 'flex flex-col items-end' : ''}
          >
            <div className="flex items-center gap-1.5 mb-1 text-xs text-muted-foreground">
              {isUser ? (
                <span>user</span>
              ) : (
                <>
                  <HootIcon className="h-3.5 w-3.5" />
                  <span>hoot</span>
                </>
              )}
            </div>

            <div className={isUser ? 'opacity-80 text-right max-w-[85%]' : ''}>
              {message.parts.map((part, i) => {
                if (part.type === 'text') {
                  return (
                    <div
                      key={i}
                      className="hoot-markdown text-sm text-foreground prose prose-invert prose-sm max-w-none prose-code:before:content-none prose-code:after:content-none"
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                    </div>
                  );
                }

                const outcome = OUTCOME[part.outcome];
                const OutcomeIcon = outcome.icon;
                return (
                  <div
                    key={i}
                    data-testid="shared-tool"
                    className="my-1.5 inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    <span>
                      ran <code className="text-foreground">{part.toolName}</code>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className={`inline-flex items-center gap-1 ${outcome.className}`}>
                      <OutcomeIcon className="h-3.5 w-3.5" />
                      {outcome.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
