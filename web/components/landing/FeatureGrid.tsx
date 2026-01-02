import {
  Activity,
  RefreshCw,
  Cloud,
  Globe,
  Cpu,
  Settings,
  Bell,
  Shield,
} from 'lucide-react';

const features = [
  {
    icon: Activity,
    title: 'Real-time Monitoring',
    description: 'Live CPU, memory, GPU, and disk metrics. Know the health of every machine at a glance.',
  },
  {
    icon: RefreshCw,
    title: 'Auto-Restart & Recovery',
    description: 'Crashed process? Owlette restarts it automatically. Configure startup sequences and dependencies.',
  },
  {
    icon: Cloud,
    title: 'Remote Deployments',
    description: 'Push updates to any machine, anywhere. Deploy software, configurations, and content remotely.',
  },
  {
    icon: Globe,
    title: 'Multi-Site Management',
    description: 'Organize machines by site or project. Manage distributed installations from a single dashboard.',
  },
  {
    icon: Cpu,
    title: 'Process Control',
    description: 'Start, stop, and restart processes remotely. Full control over your Windows applications.',
  },
  {
    icon: Bell,
    title: 'Instant Alerts',
    description: 'Get notified when things go wrong. Email alerts for offline machines and failed processes.',
  },
  {
    icon: Shield,
    title: 'Secure by Design',
    description: 'End-to-end encryption. OAuth authentication. Your machines, your data, protected.',
  },
  {
    icon: Settings,
    title: 'Easy Configuration',
    description: 'Simple agent installer. Intuitive dashboard. Get up and running in minutes, not hours.',
  },
];

export function FeatureGrid() {
  return (
    <section id="features" className="py-24 md:py-32 px-6 bg-gradient-to-b from-background via-card/30 to-background">
      <div className="max-w-7xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="section-headline text-foreground mb-4">
            Everything you need to stay in control
          </h2>
          <p className="section-subheadline max-w-2xl mx-auto">
            Powerful features designed for IT professionals and integrators
            who demand reliability.
          </p>
        </div>

        {/* Feature Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className="group p-6 rounded-lg border border-border/30 bg-background/50 hover:border-accent-cyan/30 hover:bg-card/50 transition-all duration-300"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              {/* Icon */}
              <div className="w-10 h-10 rounded-md bg-accent-cyan/10 flex items-center justify-center mb-4 group-hover:bg-accent-cyan/20 transition-colors">
                <feature.icon className="w-5 h-5 text-accent-cyan" />
              </div>

              {/* Content */}
              <h3 className="text-base font-semibold text-foreground mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
