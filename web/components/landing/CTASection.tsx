import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

export function CTASection() {
  return (
    <section className="py-24 md:py-32 px-6 relative overflow-hidden">
      {/* Blueprint grid background */}
      <div className="absolute inset-0 blueprint-grid-accent opacity-10" />

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-accent-cyan/5 via-transparent to-transparent" />

      <div className="relative z-10 max-w-3xl mx-auto text-center">
        {/* Beta Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-accent-cyan/30 bg-accent-cyan/5 mb-6">
          <div className="w-2 h-2 rounded-full bg-accent-cyan animate-pulse" />
          <span className="text-accent-cyan text-sm font-medium">Public Beta</span>
        </div>

        {/* Headline */}
        <h2 className="section-headline text-foreground mb-4">
          Ready to take control?
        </h2>
        <p className="section-subheadline max-w-xl mx-auto mb-10">
          Owlette is currently in public beta and free to use.
          We&apos;re building turnkey infrastructure for AV professionals—pricing will be announced when we launch.
        </p>

        {/* CTA Button */}
        <Button
          asChild
          size="lg"
          className="bg-accent-cyan hover:bg-accent-cyan-hover text-slate-950 font-semibold px-10 h-14 text-lg group"
        >
          <Link href="/register" className="flex items-center gap-2">
            Join the Beta
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </Link>
        </Button>

        {/* Trust signals */}
        <div className="flex flex-wrap justify-center gap-6 mt-12 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent-cyan" />
            <span>Free during beta</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent-cyan" />
            <span>No credit card</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent-cyan" />
            <span>Open source</span>
          </div>
        </div>
      </div>
    </section>
  );
}
