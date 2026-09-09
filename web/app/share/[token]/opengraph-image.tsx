/**
 * The unfurl card for a share link — Next's `opengraph-image` file convention.
 *
 * Colocated with the page, so Next injects it into BOTH og:image and
 * twitter:image without page.tsx naming a URL (see the note on `openGraph` in
 * generateMetadata). It renders per request — see the `dynamic` export below.
 *
 * NEVER 500s. A dead token and a Firestore outage both fall through to the same
 * generic card — a broken image in a Slack unfurl is worse than a plain one, and
 * an error card that said "expired" would leak what the page itself refuses to.
 *
 * Colors are literals rather than theme tokens because satori has no CSS
 * variables to resolve; they mirror app/docs-og/[...slug]/route.tsx, which is
 * where the house OG look is set. Fonts likewise: no custom face is loaded, so
 * this uses the same bundled default the docs cards do.
 */

import { ImageResponse } from 'next/og';
import { getPublicChatShare } from '@/lib/hoot/shareStore.server';
import type { ChatShareView } from '@/lib/hoot/shareTypes';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * Same reason as the page: a revoked share must stop rendering its title on the
 * NEXT request. These generated images are otherwise "cached by default"
 * (Next's opengraph-image docs), and the card is the one surface that would
 * keep serving a withdrawn conversation's title out of the full route cache.
 */
export const dynamic = 'force-dynamic';

export const size = { width: 1200, height: 630 };

export const contentType = 'image/png';

export const alt = 'a hoot conversation shared from owlette';

const BACKGROUND = '#0c0c0c';
const TEXT = 'rgb(255, 255, 255)';
const MUTED = 'rgba(240, 240, 240, 0.7)';
/** The docs cards' accent — `--accent-cyan`, resolved. */
const ACCENT = 'rgb(34, 211, 238)';
const ACCENT_EDGE = 'rgba(34, 211, 238, 0.35)';

const UNAVAILABLE_TITLE = "this shared conversation isn't available";

/** Matches page.tsx: a site-wide chat stores no machine name. */
const SITE_WIDE_TARGET_LABEL = 'all machines';

async function loadShare(token: string): Promise<ChatShareView | null> {
  try {
    return await getPublicChatShare(token);
  } catch (error) {
    logger.error('share og image lookup failed', {
      context: 'share-og-image',
      data: { error: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await loadShare(token);

  const title = share ? share.title : UNAVAILABLE_TITLE;
  const subject = share ? (share.targetLabel ?? SITE_WIDE_TARGET_LABEL) : 'owlette.app';

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          padding: '80px',
          backgroundColor: BACKGROUND,
          color: TEXT,
          borderBottom: `18px solid ${ACCENT_EDGE}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '20px' }}>
          <span style={{ fontSize: 48, fontWeight: 700, color: ACCENT }}>hoot</span>
          <span style={{ fontSize: 32, color: MUTED }}>shared from owlette</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
          <div
            style={{
              // Satori's two-line clamp: it reads exactly this combination
              // (textOverflow + -webkit-box + vertical orient + line clamp) and
              // appends the ellipsis itself.
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              // A pasted url or a long unspaced token would otherwise run off
              // the card instead of wrapping into the second line.
              wordBreak: 'break-word',
              fontSize: 72,
              fontWeight: 800,
              lineHeight: 1.15,
            }}
          >
            {title}
          </div>

          <div style={{ display: 'flex', marginTop: 28, fontSize: 30, color: MUTED }}>
            {subject}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
