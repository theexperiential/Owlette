import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { InteractiveBackground } from './InteractiveBackground';
import { TypewriterText } from './TypewriterText';

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center pt-16 overflow-hidden">
      {/* Interactive mouse-reactive background */}
      <InteractiveBackground />

      {/* Corner accents - technical drawing style */}
      <div className="absolute top-20 left-6 w-24 h-24 border-l-2 border-t-2 border-accent-cyan/30 hidden md:block" />
      <div className="absolute top-20 right-6 w-24 h-24 border-r-2 border-t-2 border-accent-cyan/30 hidden md:block" />
      <div className="absolute bottom-6 left-6 w-24 h-24 border-l-2 border-b-2 border-accent-cyan/30 hidden md:block" />
      <div className="absolute bottom-6 right-6 w-24 h-24 border-r-2 border-b-2 border-accent-cyan/30 hidden md:block" />

      {/* Content */}
      <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-accent-cyan/30 bg-accent-cyan/5 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="w-2 h-2 rounded-full bg-accent-cyan animate-pulse" />
          <span className="text-accent-cyan text-sm font-medium">Mission Control for Your Installations</span>
        </div>

        {/* Headline */}
        <h1 className="hero-headline text-foreground mb-6">
          <TypewriterText
            lines={[
              { text: 'Control Everything.' },
              { text: 'Always Online', className: 'text-accent-cyan' },
            ]}
            typingSpeed={60}
            delayBetweenLines={300}
            startDelay={700}
          />
        </h1>

        {/* Subheadline */}
        <p className="hero-subheadline max-w-2xl mx-auto mb-10 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-200">
          Remote process management for your entire fleet—theme parks,
          digital signage, galleries, live events. Deploy, control, monitor.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center animate-in fade-in slide-in-from-bottom-6 duration-700 delay-300">
          <Button asChild size="lg" className="bg-accent-cyan hover:bg-accent-cyan-hover text-slate-950 font-semibold px-8 h-12 text-base">
            <Link href="/register">Create Free Account</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="border-accent-cyan/30 hover:bg-accent-cyan/10 h-12 text-base">
            <Link href="/login">Sign In</Link>
          </Button>
        </div>

        {/* Stats */}
        <div className="flex flex-wrap justify-center gap-8 md:gap-16 mt-16 pt-16 border-t border-border/50 animate-in fade-in duration-700 delay-500">
          <div className="text-center">
            <div className="text-3xl md:text-4xl font-bold text-foreground font-heading">24/7</div>
            <div className="text-sm text-muted-foreground mt-1">Uptime Monitoring</div>
          </div>
          <div className="text-center">
            <div className="text-3xl md:text-4xl font-bold text-foreground font-heading">Unlimited</div>
            <div className="text-sm text-muted-foreground mt-1">Machines & Sites</div>
          </div>
          <div className="text-center">
            <div className="text-3xl md:text-4xl font-bold text-accent-cyan font-heading">Real-time</div>
            <div className="text-sm text-muted-foreground mt-1">Cloud Sync</div>
          </div>
        </div>
      </div>
    </section>
  );
}
