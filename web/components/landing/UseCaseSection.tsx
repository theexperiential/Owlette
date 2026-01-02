import { Building2, Monitor, Sparkles, Zap } from 'lucide-react';

const useCases = [
  {
    icon: Building2,
    title: 'Museums & Exhibitions',
    description: 'Keep interactive exhibits running 24/7. Auto-restart crashed applications before visitors notice. Monitor video walls and projection mapping across your entire venue.',
    highlight: 'Zero downtime',
  },
  {
    icon: Monitor,
    title: 'Digital Signage',
    description: 'Manage hundreds of screens across locations. Deploy content updates simultaneously. Know instantly when a display goes offline, from anywhere.',
    highlight: 'Fleet-wide control',
  },
  {
    icon: Sparkles,
    title: 'Themed Entertainment',
    description: 'Ensure show-critical systems never fail. Real-time monitoring for immersive experiences. From theme parks to escape rooms, every moment matters.',
    highlight: 'Mission critical',
  },
  {
    icon: Zap,
    title: 'Live Events',
    description: 'Mission-critical reliability for concerts, festivals, and productions. When the show must go on, Owlette ensures your systems keep running.',
    highlight: 'Real-time response',
  },
];

export function UseCaseSection() {
  return (
    <section id="use-cases" className="py-24 md:py-32 px-6">
      <div className="max-w-7xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="section-headline text-foreground mb-4">
            Built for critical installations
          </h2>
          <p className="section-subheadline max-w-2xl mx-auto">
            Owlette was designed for environments where downtime isn&apos;t an option.
            From museums to live events, we keep your installations running.
          </p>
        </div>

        {/* Use Case Grid */}
        <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
          {useCases.map((useCase, index) => (
            <div
              key={useCase.title}
              className="group relative p-8 rounded-lg border border-border/50 bg-card/50 hover:bg-card hover:border-accent-cyan/30 transition-all duration-300"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {/* Icon */}
              <div className="w-12 h-12 rounded-lg bg-accent-cyan/10 flex items-center justify-center mb-6 group-hover:bg-accent-cyan/20 transition-colors">
                <useCase.icon className="w-6 h-6 text-accent-cyan" />
              </div>

              {/* Content */}
              <h3 className="text-xl font-semibold text-foreground mb-3">
                {useCase.title}
              </h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                {useCase.description}
              </p>

              {/* Highlight Badge */}
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-cyan/5 border border-accent-cyan/20">
                <div className="w-1.5 h-1.5 rounded-full bg-accent-cyan" />
                <span className="text-xs font-medium text-accent-cyan uppercase tracking-wider">
                  {useCase.highlight}
                </span>
              </div>

              {/* Corner accent on hover */}
              <div className="absolute top-0 right-0 w-16 h-16 border-t-2 border-r-2 border-transparent group-hover:border-accent-cyan/20 rounded-tr-lg transition-colors" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
