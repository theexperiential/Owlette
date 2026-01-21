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
    <section id="use-cases" className="py-16 sm:py-24 md:py-32 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-10 sm:mb-16">
          <h2 className="section-headline text-foreground mb-3 sm:mb-4">
            Built for critical installations
          </h2>
          <p className="section-subheadline max-w-2xl mx-auto px-4 sm:px-0">
            Owlette was designed for environments where downtime isn&apos;t an option.
            From museums to live events, we keep your installations running.
          </p>
        </div>

        {/* Use Case Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 lg:gap-8">
          {useCases.map((useCase, index) => (
            <div
              key={useCase.title}
              className="group relative p-5 sm:p-6 md:p-8 rounded-lg border border-border/50 bg-card/50 hover:bg-card hover:border-accent-cyan/30 transition-all duration-300"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {/* Icon */}
              <div className="w-10 sm:w-12 h-10 sm:h-12 rounded-lg bg-accent-cyan/10 flex items-center justify-center mb-4 sm:mb-6 group-hover:bg-accent-cyan/20 transition-colors">
                <useCase.icon className="w-5 sm:w-6 h-5 sm:h-6 text-accent-cyan" />
              </div>

              {/* Content */}
              <h3 className="text-lg sm:text-xl font-semibold text-foreground mb-2 sm:mb-3">
                {useCase.title}
              </h3>
              <p className="text-sm sm:text-base text-muted-foreground leading-relaxed mb-3 sm:mb-4">
                {useCase.description}
              </p>

              {/* Highlight Badge */}
              <div className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 rounded-full bg-accent-cyan/5 border border-accent-cyan/20">
                <div className="w-1 sm:w-1.5 h-1 sm:h-1.5 rounded-full bg-accent-cyan" />
                <span className="text-[10px] sm:text-xs font-medium text-accent-cyan uppercase tracking-wider">
                  {useCase.highlight}
                </span>
              </div>

              {/* Corner accent on hover */}
              <div className="absolute top-0 right-0 w-12 sm:w-16 h-12 sm:h-16 border-t-2 border-r-2 border-transparent group-hover:border-accent-cyan/20 rounded-tr-lg transition-colors" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
