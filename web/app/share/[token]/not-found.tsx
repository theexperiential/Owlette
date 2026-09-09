/**
 * The 404 every dead share link lands on.
 *
 * Missing, expired and revoked are ONE state here on purpose: `getPublicChatShare`
 * collapses all three to null, and this page is the only thing any of them render.
 * Wording that distinguishes them — "this link expired", "the owner revoked it" —
 * would turn the URL into an oracle for whether a token ever existed. Don't add it.
 *
 * Segment-local rather than the app's root 404: that one is a full-bleed animated
 * canvas ("lost in time... like tears in rain") aimed at someone who mistyped a
 * dashboard URL. A reader who followed a colleague's link needs the plain answer.
 */

import Link from 'next/link';
import { HootIcon } from '@/components/icons/HootIcon';

export default function ShareNotFound() {
  return (
    // pb-32 clears the app-wide fixed Footer, which renders on this route.
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col items-center justify-center px-6 pb-32 text-center">
      <HootIcon className="h-10 w-10 text-muted-foreground" />

      <h1 className="mt-6 text-xl font-bold text-foreground">
        this shared conversation isn&apos;t available
      </h1>

      <p className="mt-3 max-w-sm text-sm text-muted-foreground">
        it may have expired, or the person who shared it removed the link.
      </p>

      <Link
        href="https://owlette.app"
        className="mt-8 text-sm font-medium text-accent-cyan transition-colors hover:text-accent-cyan-hover"
      >
        owlette.app
      </Link>
    </div>
  );
}
