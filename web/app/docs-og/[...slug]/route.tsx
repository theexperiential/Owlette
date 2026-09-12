import { notFound } from "next/navigation";
import { generateOGImage } from "fumadocs-ui/og";
import { source } from "@/lib/source";

/**
 * Per-page OG images for /docs.
 *
 * A separate route rather than a colocated `opengraph-image.tsx`, and with NO
 * `generateStaticParams`: the docs pages are statically generated, so either of
 * those would render all 81 images during every build — slower, and a new way
 * for a build to fail. These render on request instead and are cacheable.
 *
 * The last slug segment carries a `.png` suffix so the URL looks like an image
 * to crawlers and to anything that sniffs by extension.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params;
  // Drop the trailing "image.png" the URL carries for the crawler's benefit.
  const page = source.getPage(slug.slice(0, -1));

  if (!page) notFound();

  return generateOGImage({
    title: page.data.title,
    description: page.data.description,
    site: "owlette docs",
    primaryColor: "rgba(34, 211, 238, 0.35)",
    primaryTextColor: "rgb(34, 211, 238)",
  });
}
