'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

export function LandingHeader() {
  const { user, loading } = useAuth();

  const scrollToTop = (e: React.MouseEvent) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <header className="fixed top-0 inset-x-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
      <div className="w-full px-6 h-16 flex items-center justify-between">
        {/* Logo - left */}
        <a href="#" onClick={scrollToTop} className="flex items-center gap-3 group cursor-pointer">
          <Image
            src="/owlette-icon.png"
            alt="Owlette"
            width={32}
            height={32}
            className="group-hover:scale-105 transition-transform"
          />
          <span className="text-xl font-semibold tracking-tight">Owlette</span>
        </a>

        {/* Navigation - centered (absolute for true center) */}
        <nav className="hidden md:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
          <a href="#use-cases" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Use Cases
          </a>
          <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Features
          </a>
        </nav>

        {/* Auth Buttons - right */}
        <div className="flex items-center gap-3">
          {loading ? (
            <div className="w-20 h-9 bg-muted animate-pulse rounded-md" />
          ) : user ? (
            <Button asChild variant="default" className="bg-accent-cyan hover:bg-accent-cyan-hover text-slate-950 font-medium">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" className="text-muted-foreground hover:text-foreground">
                <Link href="/login">Sign In</Link>
              </Button>
              <Button asChild className="bg-accent-cyan hover:bg-accent-cyan-hover text-slate-950 font-medium">
                <Link href="/register">Get Started</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
